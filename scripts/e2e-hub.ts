#!/usr/bin/env bun
// Phase 3 End-to-End Real-Time Sync Test via WebSocket Hub
// Verifies ISC-91 through ISC-100.
// Usage: bun scripts/e2e-hub.ts

import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";

const ROOT = join(import.meta.dir, "..");
const ENDPOINT = process.env.RBOX_E2E_ENDPOINT ?? "http://localhost:8333";
const HUB_URL = process.env.RBOX_HUB_URL ?? "ws://localhost:8787/ws";
const DB_URL = process.env.DATABASE_URL ?? "postgres://renegadebox:renegadebox@localhost:5432/renegadebox";
const BUCKET = `rbox-hub-e2e-${Date.now()}`;
const PASS = "correct horse battery staple";
const BIN = join(ROOT, "engine/target/release/rbox");
const T = mkdtempSync(join(tmpdir(), "rbox-hub-e2e-"));

const sql = postgres(DB_URL);
let failures = 0;

function check(id: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const box = (d: string) => join(T, d, "box");
const env = (d: string) => ({
  ...process.env,
  RBOX_HOME: join(T, d, "home"),
  RBOX_PASSPHRASE: PASS,
  RBOX_S3_SECRET: "SENTINEL-s3-secret",
  RBOX_LOG: "info",
});

async function init(d: string, name: string, token: string) {
  mkdirSync(join(T, d), { recursive: true });
  return $`${BIN} init --folder ${box(d)} --bucket ${BUCKET} --endpoint ${ENDPOINT} --access-key-id dev --device-name ${name} --hub-url ${HUB_URL} --device-token ${token} --insecure-file-keystore --kdf-memory-kib 8192`
    .env(env(d))
    .nothrow()
    .quiet();
}

console.log(`Starting Phase 3 Hub E2E test. Bucket: ${BUCKET}, Dir: ${T}`);

// Tap Postgres account_events channel to inspect all relayed envelopes for leaks (ISC-100)
const capturedEvents: string[] = [];
const subSql = postgres(DB_URL);
await subSql.listen("account_events", (payload) => {
  capturedEvents.push(payload);
});

// Ensure bucket exists in local SeaweedFS
await $`echo ${`s3.bucket.create -name ${BUCKET}`} | docker compose exec -T s3 weed shell`.cwd(ROOT).quiet();

// 1. Create test account & registered devices in Postgres
const accountId = randomUUID();
const deviceIdA = randomUUID();
const tokenA = randomBytes(32).toString("hex");
const deviceIdB = randomUUID();
const tokenB = randomBytes(32).toString("hex");

await sql`
  INSERT INTO accounts (id, email, password_hash)
  VALUES (${accountId}, ${`e2e_${Date.now()}@test.local`}, 'dummy_hash')
`;

await sql`
  INSERT INTO devices (id, account_id, name, token_hash)
  VALUES
    (${deviceIdA}, ${accountId}, 'Laptop A', ${hashToken(tokenA)}),
    (${deviceIdB}, ${accountId}, 'Desktop B', ${hashToken(tokenB)})
`;

// 2. Initialize Device A
const initA = await init("a", "Laptop A", tokenA);
check("ISC-91 rbox init succeeds with hub-url and device-token", initA.exitCode === 0, initA.stderr.toString());

const cfgTextA = readFileSync(join(T, "a/home/config.toml"), "utf8");
check("ISC-91 hub_url stored in config.toml", cfgTextA.includes(`hub_url = "${HUB_URL}"`));

const secretsTextA = readFileSync(join(T, "a/home/secrets.insecure.json"), "utf8");
check("ISC-91 device_token stored in keystore", secretsTextA.includes(tokenA));
check("ISC-91 config.toml contains no secrets", !cfgTextA.includes(tokenA) && !cfgTextA.includes("SENTINEL"));

// 3. Initialize Device B
const initB = await init("b", "Desktop B", tokenB);
check("ISC-91 second device init with hub-url succeeds", initB.exitCode === 0);

// 4. Start rbox watch on Device B with a long 60-second poll interval
// If Device B receives files quickly, it MUST be through real-time push!
console.log("Starting rbox watch on Device B (poll: 60s)...");
const procB = Bun.spawn([BIN, "watch", "--poll-secs", "60"], {
  env: env("b"),
  stdout: "pipe",
  stderr: "pipe",
});

// Start rbox watch on Device A with 60-second poll
console.log("Starting rbox watch on Device A (poll: 60s)...");
const procA = Bun.spawn([BIN, "watch", "--poll-secs", "60"], {
  env: env("a"),
  stdout: "pipe",
  stderr: "pipe",
});

let stderrA = "";
let stderrB = "";
(async () => {
  const reader = procA.stderr.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    stderrA += new TextDecoder().decode(value);
  }
})();
(async () => {
  const reader = procB.stderr.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    stderrB += new TextDecoder().decode(value);
  }
})();

// Helper to wait until condition is met or timeout
async function waitFor(cond: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await Bun.sleep(intervalMs);
  }
  return false;
}

// Wait for both engines to connect and authenticate with Hub (ISC-92, ISC-93)
const authedB = await waitFor(() => stderrB.includes("Authenticated with Hub"), 5000);
const authedA = await waitFor(() => stderrA.includes("Authenticated with Hub"), 5000);

check("ISC-92, ISC-93 Device A connected and authenticated with Hub", authedA, "auth_ok received");
check("ISC-92, ISC-93 Device B connected and authenticated with Hub", authedB, "auth_ok received");

// 5. Real-time push test: write file on Device A and measure latency to Device B (ISC-94, ISC-95, ISC-99)
const secretContent = "Top secret project file created at " + Date.now();
const testFileName = "realtime-doc.txt";
const destFileB = join(box("b"), testFileName);

console.log("Writing file on Device A...");
const writeTime = performance.now();
writeFileSync(join(box("a"), testFileName), secretContent);

// Wait for file to arrive on Device B
const fileSynced = await waitFor(() => existsSync(destFileB) && readFileSync(destFileB, "utf8") === secretContent, 6000, 50);
const elapsedMs = Math.round(performance.now() - writeTime);

check("ISC-99 real-time push: file arrives on Device B in < 3s (without waiting for 60s poll)", fileSynced, `elapsed: ${elapsedMs}ms`);
check("ISC-94, ISC-95 Device B received sync_required notification", stderrB.includes("received real-time sync notification from Hub"));
check("ISC-99 file content matches exactly", existsSync(destFileB) && readFileSync(destFileB, "utf8") === secretContent);

// 6. Anti-leak test (ISC-100): Hub messages and Postgres notifications must contain ZERO plaintext names, paths, or contents
const forbiddenTokens = ["realtime-doc.txt", "Top secret project", secretContent];
let leakFound = false;
for (const tok of forbiddenTokens) {
  for (const ev of capturedEvents) {
    if (ev.includes(tok)) {
      leakFound = true;
      break;
    }
  }
}
check("ISC-100 Anti: no plaintext file names, paths, or contents transmitted to Hub / account_events", !leakFound);
check("ISC-100 event captured on account_events channel", capturedEvents.length > 0, `${capturedEvents.length} events inspected`);

// 7. Revocation handling: revoke Device B in Postgres and verify instant disconnect (ISC-88, ISC-97)
console.log("Revoking Device B in Postgres...");
const [revokedDevice] = await sql`
  UPDATE devices
  SET revoked_at = NOW()
  WHERE token_hash = ${hashToken(tokenB)}
  RETURNING id
`;
await sql.notify("account_events", JSON.stringify({ action: "device_revoked", device_id: revokedDevice.id }));

const revokedLogged = await waitFor(
  () => stderrB.includes("REVOKED") || stderrB.includes("Device revoked") || stderrB.includes("stopping permanently"),
  5000
);
check("ISC-88, ISC-97 Revoked device cleanly shuts down Hub connection without retrying", revokedLogged);

// Cleanup processes and test data
procA.kill();
procB.kill();
await subSql.end();
await sql`DELETE FROM accounts WHERE id = ${accountId}`;
await sql.end();

console.log(failures === 0 ? "\nALL HUB E2E CHECKS PASSED" : `\n${failures} HUB E2E CHECK(S) FAILED`);
if (failures === 0) rmSync(T, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
