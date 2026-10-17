#!/usr/bin/env bun
// End-to-end test of RenegadeBox accounts: a set-up Mac creates an account, a second Mac
// signs in with only email and password and syncs, settings flow between them, the relay
// delivers changes instantly, and signing a Mac out cuts it off.
//
// Needs local S3 (docker compose up -d s3). Starts the account service locally with
// `wrangler dev`; touches no real Cloudflare account.
// Usage: bun scripts/e2e-account.ts   (builds rbox in release mode first)

import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLOUD = join(ROOT, "cloud");
const ENDPOINT = process.env.RBOX_E2E_ENDPOINT ?? "http://localhost:8333";
const BUCKET = `rbox-acct-e2e-${Date.now()}`;
const PASS = "correct horse battery staple";
const ACCOUNT_PASSWORD = "a long account password 42";
const EMAIL = `e2e-${Date.now()}@example.com`;
const TARGET_DIR: string = JSON.parse(await $`cargo metadata --format-version 1 --no-deps`.cwd(ROOT).text()).target_directory;
const BIN = join(TARGET_DIR, "release/rbox");
const T = mkdtempSync(join(tmpdir(), "rbox-acct-e2e-"));
const PORT = 18_000 + Math.floor(Math.random() * 2000);
const SERVER = `http://localhost:${PORT}`;

let failures = 0;
function check(id: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const box = (d: string) => join(T, d, "box");
const env = (d: string, extra: Record<string, string> = {}) => ({
  ...process.env,
  RBOX_HOME: join(T, d, "home"),
  RBOX_PASSPHRASE: PASS,
  RBOX_S3_SECRET: "SENTINEL-s3-secret",
  RBOX_SERVER: SERVER,
  RBOX_ACCOUNT_PASSWORD: ACCOUNT_PASSWORD,
  RBOX_LOG: "warn",
  ...extra,
});

async function rbox(d: string, args: string[], extra: Record<string, string> = {}) {
  const r = await $`${BIN} ${args}`.env(env(d, extra)).nothrow().quiet();
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
}

async function ok(d: string, args: string[], extra: Record<string, string> = {}) {
  const r = await rbox(d, args, extra);
  if (r.code !== 0) throw new Error(`rbox ${args.join(" ")} on ${d} failed:\n${r.err}`);
  return r.out;
}

const write = (d: string, rel: string, data: string) => {
  mkdirSync(join(box(d), rel, ".."), { recursive: true });
  writeFileSync(join(box(d), rel), data);
};
const config = (d: string) => readFileSync(join(T, d, "home", "config.toml"), "utf8");

async function waitFor(what: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (what()) return true;
    await Bun.sleep(200);
  }
  return what();
}

// ---------------------------------------------------------------------------- setup

console.log("Building rbox (release)…");
await $`cargo build --release -p renegadebox-engine --bin rbox --quiet`.cwd(ROOT);

await $`echo ${`s3.bucket.create -name ${BUCKET}`} | docker compose exec -T s3 weed shell`.cwd(ROOT).quiet();

console.log(`Starting the account service on ${SERVER}…`);
const persist = join(T, "wrangler");
await $`bunx wrangler d1 migrations apply renegadebox --local --persist-to ${persist}`.cwd(CLOUD).quiet();
const devVars = join(CLOUD, ".dev.vars");
if (!existsSync(devVars)) writeFileSync(devVars, "PEPPER=e2e-only-pepper-not-secret\n");
const worker = Bun.spawn([
  "bunx", "wrangler", "dev", "--local", "--port", String(PORT), "--persist-to", persist,
  // Google sign-in in test mode: the callback accepts fake codes because PUBLIC_URL is localhost.
  "--var", "SETUP_KEK:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  "--var", "GOOGLE_CLIENT_ID:e2e.apps.googleusercontent.com",
  "--var", "GOOGLE_FAKE:1",
  "--var", `PUBLIC_URL:${SERVER}`,
], {
  cwd: CLOUD,
  stdout: "pipe",
  stderr: "pipe",
});
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try {
    up = (await fetch(`${SERVER}/api/v1/health`)).ok;
  } catch {
    await Bun.sleep(500);
  }
}
if (!up) {
  worker.kill();
  throw new Error("the account service did not start");
}

const watchers: ReturnType<typeof Bun.spawn>[] = [];

/** Runs `rbox account google` and plays the browser and Google's part with a fake identity. */
async function googleLogin(d: string, sub: string, email: string, extraArgs: string[] = [], extra: Record<string, string> = {}) {
  const proc = Bun.spawn([BIN, "account", "google", ...extraArgs], { env: env(d, { RBOX_NO_BROWSER: "1", ...extra }), stdout: "pipe", stderr: "pipe" });
  const reader = proc.stdout.getReader();
  let out = "";
  while (!/https:\/\/accounts\.google\.com\S+/.test(out)) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  const url = /https:\/\/accounts\.google\.com\S+/.exec(out)?.[0];
  if (url) {
    const state = new URL(url).searchParams.get("state")!;
    await fetch(`${SERVER}/api/v1/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`fake:${sub}:${email}`)}`);
  }
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  const code = await proc.exited;
  return { code, out, err: await new Response(proc.stderr).text() };
}
try {
  // ------------------------------------------------------------------------ Mac A
  mkdirSync(join(T, "a"), { recursive: true });
  await ok("a", ["init", "--folder", box("a"), "--bucket", BUCKET, "--endpoint", ENDPOINT, "--access-key-id", "dev", "--device-name", "MacBook", "--insecure-file-keystore", "--kdf-memory-kib", "8192"]);
  write("a", "docs/hello.txt", "hello from A");
  await ok("a", ["sync"]);

  const short = await rbox("a", ["account", "create", "--email", EMAIL], { RBOX_ACCOUNT_PASSWORD: "too short" });
  check("A1 short password refused", short.code !== 0 && /12 characters/.test(short.err), short.err.split("\n").pop());

  await ok("a", ["account", "create", "--email", EMAIL]);
  check("A2 account created and linked", /\[account\]/.test(config("a")) && config("a").includes(EMAIL));
  check("A3 hub url set from server", config("a").includes(`ws://localhost:${PORT}/api/v1/hub`));
  const dup = await rbox("a", ["account", "create", "--email", EMAIL]);
  check("A4 second create refused", dup.code !== 0);

  // ------------------------------------------------------------------------ Mac B
  mkdirSync(join(T, "b"), { recursive: true });
  const wrong = await rbox("b", ["account", "login", "--email", EMAIL, "--folder", box("b"), "--insecure-file-keystore"], { RBOX_ACCOUNT_PASSWORD: "not the right password" });
  check("B1 wrong password refused plainly", wrong.code !== 0 && /don't match/.test(wrong.err), wrong.err.split("\n").pop());
  check("B2 failed login leaves no setup", !existsSync(join(T, "b", "home", "config.toml")));

  // No passphrase and no S3 secret in B's environment: everything must come from the account.
  await ok("b", ["account", "login", "--email", EMAIL, "--folder", box("b"), "--device-name", "Studio", "--insecure-file-keystore"], { RBOX_PASSPHRASE: "", RBOX_S3_SECRET: "" });
  const secretsB = readFileSync(join(T, "b", "home", "secrets.insecure.json"), "utf8");
  check("B3 storage key arrived", secretsB.includes("SENTINEL-s3-secret"));
  check("B4 vault key arrived", secretsB.includes("master-key") && secretsB.includes("account-key") && secretsB.includes("device-token"));
  check("B5 storage settings match A", config("b").includes(`bucket = "${BUCKET}"`) && config("b").includes(ENDPOINT));

  await ok("b", ["sync"], { RBOX_PASSPHRASE: "" });
  check("B6 B synced A's file with no passphrase", existsSync(join(box("b"), "docs/hello.txt")) && readFileSync(join(box("b"), "docs/hello.txt"), "utf8") === "hello from A");

  const devices = await ok("a", ["account", "devices"]);
  check("B7 both Macs listed", devices.includes("MacBook (this device)") && devices.includes("Studio"), devices.replace(/\n/g, " | "));

  // ------------------------------------------------------------------------ settings flow
  check("C1 nothing to send when unchanged", (await ok("b", ["account", "sync"])).includes("already up to date"));
  writeFileSync(join(T, "a", "home", "config.toml"), config("a").replace(/\[ai\]/, '[ai]\nmodel = "e2e/test-model"').replace(/^model = "(?!e2e)[^"]*"\n/m, ""));
  check("C2 A sends its change", (await ok("a", ["account", "sync"])).includes("Sent"));
  check("C3 B receives it", (await ok("b", ["account", "sync"])).includes("Applied"));
  check("C4 B's config has A's change", config("b").includes('model = "e2e/test-model"'));
  check("C5 then both are in step", (await ok("a", ["account", "sync"])).includes("already up to date"));

  // ------------------------------------------------------------------------ relay
  // Long poll intervals, so only the relay can make B notice A's change quickly.
  for (const d of ["a", "b"]) {
    watchers.push(Bun.spawn([BIN, "watch", "--poll-secs", "600"], { env: env(d), stdout: "ignore", stderr: "ignore" }));
  }
  await Bun.sleep(3000);
  write("a", "instant.txt", "relayed");
  const started = Date.now();
  const relayed = await waitFor(() => existsSync(join(box("b"), "instant.txt")), 15_000);
  check("D1 change reached B through the relay", relayed, relayed ? `${Date.now() - started} ms` : "not within 15 s");

  // ------------------------------------------------------------------------ sign out
  const studioId = devices.split("\n").find((l) => l.startsWith("Studio"))?.split(/\s+/)[1] ?? "";
  await ok("a", ["account", "remove", studioId]);
  const after = await ok("a", ["account", "devices"]);
  check("E1 removed Mac no longer listed", !after.includes("Studio"));
  const bSync = await rbox("b", ["account", "sync"]);
  check("E2 removed Mac is refused", bSync.code !== 0 && /signed out/.test(bSync.err), bSync.err.split("\n").pop());

  await ok("a", ["account", "password"], { RBOX_ACCOUNT_PASSWORD: "a brand new password 2026" });
  mkdirSync(join(T, "c"), { recursive: true });
  const oldPw = await rbox("c", ["account", "login", "--email", EMAIL, "--folder", box("c"), "--insecure-file-keystore"]);
  check("E3 old password stops working", oldPw.code !== 0);
  const newPw = await rbox("c", ["account", "login", "--email", EMAIL, "--folder", box("c"), "--insecure-file-keystore"], { RBOX_ACCOUNT_PASSWORD: "a brand new password 2026" });
  check("E4 new password sets up another Mac", newPw.code === 0, newPw.err.split("\n").pop());

  await ok("a", ["account", "logout"]);
  check("E5 sign out keeps sync settings", !config("a").includes("[account]") && config("a").includes(BUCKET));

  // ------------------------------------------------------------------------ Google
  const sub = `google-${Date.now()}`;
  const gmail = `g-${Date.now()}@gmail.com`;
  mkdirSync(join(T, "gnew"), { recursive: true });
  const early = await googleLogin("gnew", `other-${sub}`, `other-${gmail}`, ["--folder", box("gnew"), "--insecure-file-keystore"]);
  check("G1 a new Mac can't start a Google account with nothing to save", early.code !== 0 && /saved setup yet/.test(early.err), early.err.trim().split("\n").pop());
  check("G2 and is left unset", !existsSync(join(T, "gnew", "home", "config.toml")));

  // Mac A (already set up, now signed out) starts the Google account.
  const ga = await googleLogin("a", sub, gmail);
  check("G3 set-up Mac creates the Google account and saves its setup", ga.code === 0 && config("a").includes('provider = "google"') && /setup_version = 1/.test(config("a")), ga.err.trim().split("\n").pop());

  // A brand-new Mac: no passphrase, no storage secret, no password. Just Google.
  mkdirSync(join(T, "g2"), { recursive: true });
  const g2 = await googleLogin("g2", sub, gmail, ["--folder", box("g2"), "--device-name", "Studio", "--insecure-file-keystore"], { RBOX_PASSPHRASE: "", RBOX_S3_SECRET: "", RBOX_ACCOUNT_PASSWORD: "" });
  check("G4 new Mac signs in with Google alone", g2.code === 0, g2.err.trim().split("\n").pop());
  await ok("g2", ["sync"], { RBOX_PASSPHRASE: "" });
  check("G5 and syncs your files", existsSync(join(box("g2"), "docs/hello.txt")) && existsSync(join(box("g2"), "instant.txt")));
  const gdev = await ok("g2", ["account", "devices"]);
  check("G6 both Macs on the Google account", gdev.includes("MacBook") && gdev.includes("Studio (this device)"), gdev.replace(/\n/g, " | "));
  const gpw = await rbox("g2", ["account", "password"], { RBOX_ACCOUNT_PASSWORD: "some new password 123" });
  check("G7 Google accounts have no password to change", gpw.code !== 0 && /Google/.test(gpw.err));
  const plogin = await rbox("gnew", ["account", "login", "--email", gmail, "--folder", box("gnew"), "--insecure-file-keystore"], { RBOX_ACCOUNT_PASSWORD: "guessing a password 1" });
  check("G8 nobody can sign in to it with a password", plogin.code !== 0);
} finally {
  for (const w of watchers) w.kill();
  worker.kill();
}

console.log(failures === 0 ? "\nALL ACCOUNT E2E CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
