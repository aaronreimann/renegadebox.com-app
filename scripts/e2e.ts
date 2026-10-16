#!/usr/bin/env bun
// Two/three-device end-to-end test of the rbox engine against local S3 (docker compose up -d s3).
// Usage: bun scripts/e2e.ts   (builds engine in release mode first)

import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync, readdirSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..");
const ENDPOINT = process.env.RBOX_E2E_ENDPOINT ?? "http://localhost:8333";
const BUCKET = `rbox-e2e-${Date.now()}`;
const PASS = "correct horse battery staple";
const BIN = join(ROOT, "engine/target/release/rbox");
const T = mkdtempSync(join(tmpdir(), "rbox-e2e-"));

const s3 = new Bun.S3Client({ accessKeyId: "dev", secretAccessKey: "dev", endpoint: ENDPOINT, bucket: BUCKET });
let failures = 0;

function check(id: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function listAll(prefix: string): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.list({ prefix, ...(token ? { continuationToken: token } : {}) });
    for (const c of page.contents ?? []) out.push({ key: c.key, size: c.size ?? 0 });
    token = page.isTruncated ? page.nextContinuationToken : undefined;
  } while (token);
  return out;
}

const box = (d: string) => join(T, d, "box");
const env = (d: string) => ({ ...process.env, RBOX_HOME: join(T, d, "home"), RBOX_PASSPHRASE: PASS, RBOX_S3_SECRET: "SENTINEL-s3-secret", RBOX_LOG: "warn" });

async function rbox(d: string, ...args: string[]) {
  const r = await $`${BIN} ${args}`.env(env(d)).nothrow().quiet();
  if (r.exitCode !== 0) throw new Error(`rbox ${args.join(" ")} on ${d} failed:\n${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

async function init(d: string, name: string, passphrase = PASS) {
  mkdirSync(join(T, d), { recursive: true });
  return $`${BIN} init --folder ${box(d)} --bucket ${BUCKET} --endpoint ${ENDPOINT} --access-key-id dev --device-name ${name} --insecure-file-keystore --kdf-memory-kib 8192`
    .env({ ...env(d), RBOX_PASSPHRASE: passphrase })
    .nothrow()
    .quiet();
}

function tree(d: string): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === ".DS_Store") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else m.set(relative(box(d), p).normalize("NFC"), createHash("sha256").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(box(d));
  return m;
}

const sameTree = (a: string, b: string) => JSON.stringify([...tree(a)].sort()) === JSON.stringify([...tree(b)].sort());
const write = (d: string, rel: string, data: string | Uint8Array) => {
  mkdirSync(join(box(d), rel, ".."), { recursive: true });
  writeFileSync(join(box(d), rel), data);
};
const read = (d: string, rel: string) => readFileSync(join(box(d), rel), "utf8");
const journalCount = async () => (await listAll("rb/journal/")).length;
const blobCount = async () => (await listAll("rb/blobs/")).length;
const contents = (d: string) => new Set(tree(d).values());

// ------------------------------------------------------------------------------------------
console.log(`bucket ${BUCKET}, workdir ${T}`);
await $`cargo build --release --quiet`.cwd(join(ROOT, "engine"));
await $`echo ${`s3.bucket.create -name ${BUCKET}`} | docker compose exec -T s3 weed shell`.cwd(ROOT).quiet();

// --- init
check("ISC-60 init creates vault", (await init("a", "Laptop")).stdout.toString().includes("Created a new encrypted vault"));
const wrong = await init("x", "Intruder", "not the passphrase at all");
check("ISC-19 wrong passphrase rejected", wrong.exitCode !== 0 && wrong.stderr.toString().includes("wrong passphrase"));
rmSync(join(T, "x"), { recursive: true, force: true });
check("ISC-60 init unlocks existing vault", (await init("b", "Desktop")).stdout.toString().includes("Unlocked the existing vault"));
const cfgText = readFileSync(join(T, "a/home/config.toml"), "utf8");
check("ISC-65 no secrets in config.toml", !cfgText.includes("SENTINEL") && !/master/i.test(cfgText));

// --- basic propagation
const big = randomBytes(70 * 1024 * 1024); // > multipart threshold
write("a", "Documents/finances.pdf", "Q3 numbers: very secret");
write("a", "Documents/Taxes/2026/receipt-café.txt", "coffee 4.50");
write("a", "empty.txt", "");
write("a", "Videos/holiday.mp4", big);
write("a", ".DS_Store", "junk");
await rbox("a", "sync");
await rbox("b", "sync");
check("ISC-47 add propagates A→B", sameTree("a", "b"), `${tree("b").size} files`);
check("ISC-38 70 MB file synced via multipart", tree("b").get("Videos/holiday.mp4") === createHash("sha256").update(big).digest("hex"));
check("ISC-35 .DS_Store not synced", !existsSync(join(box("b"), ".DS_Store")));
check("ISC-33 NFC path round-trips", tree("b").has("Documents/Taxes/2026/receipt-café".normalize("NFC") + ".txt"));

// --- echo suppression: B syncing again must publish nothing
let before = await journalCount();
await rbox("b", "sync");
await rbox("a", "sync");
check("ISC-59 no echo entries after download", (await journalCount()) === before, `journal ${before} → ${await journalCount()}`);

// --- modify
write("b", "Documents/finances.pdf", "Q3 numbers: revised by desktop");
await rbox("b", "sync");
await rbox("a", "sync");
check("ISC-47 modify propagates B→A", read("a", "Documents/finances.pdf") === "Q3 numbers: revised by desktop");

// --- rename (no re-upload)
const blobsBefore = await blobCount();
before = await journalCount();
renameSync(join(box("a"), "Videos/holiday.mp4"), join(box("a"), "Videos/2026 Lisbon.mp4"));
const out = await rbox("a", "sync");
check("ISC-50 local rename published as one entry", (await journalCount()) === before + 1 && out.includes("1 mv"), out);
check("ISC-50 rename uploads no blob", (await blobCount()) === blobsBefore);
const bOut = await rbox("b", "sync");
check("ISC-49 remote rename moves without download", bOut.includes("0 down") && bOut.includes("1 mv") && sameTree("a", "b"), bOut);

// --- delete
rmSync(join(box("b"), "empty.txt"));
await rbox("b", "sync");
await rbox("a", "sync");
check("ISC-48 delete propagates B→A", !existsSync(join(box("a"), "empty.txt")) && sameTree("a", "b"));

// --- concurrent offline edits (both edit the same file, neither has synced)
write("a", "notes.md", "base");
await rbox("a", "sync");
await rbox("b", "sync");
write("a", "notes.md", "edit from LAPTOP");
write("b", "notes.md", "edit from DESKTOP");
await rbox("a", "sync");
await rbox("b", "sync");
await rbox("a", "sync");
await rbox("b", "sync");
const ca = contents("a");
check("ISC-52 concurrent edits converge", sameTree("a", "b"), [...tree("a").keys()].filter((k) => k.startsWith("notes")).join(", "));
const hashOf = (s: string) => createHash("sha256").update(s).digest("hex");
check("ISC-56 both versions survive", ca.has(hashOf("edit from LAPTOP")) && ca.has(hashOf("edit from DESKTOP")));
check("ISC-53 conflicted copy named", [...tree("a").keys()].some((k) => /^notes \(conflicted copy from (Laptop|Desktop) \d{4}-\d{2}-\d{2} [0-9a-f]{8}\)\.md$/.test(k)));

// --- modify vs delete
write("a", "plan.txt", "v1");
await rbox("a", "sync");
await rbox("b", "sync");
rmSync(join(box("a"), "plan.txt"));
write("b", "plan.txt", "v2 important edits");
await rbox("a", "sync");
await rbox("b", "sync");
await rbox("a", "sync");
await rbox("b", "sync");
check("ISC-55 modify-vs-delete keeps modified content", contents("a").has(hashOf("v2 important edits")) && sameTree("a", "b"));

// --- true race: three devices edit the same files and push simultaneously
await init("c", "Phone");
await rbox("c", "sync");
const raceFiles = ["race-1.txt", "race-2.txt", "race-3.txt"];
for (const f of raceFiles) write("a", f, "race base");
await rbox("a", "sync");
await rbox("b", "sync");
await rbox("c", "sync");
for (const f of raceFiles) for (const d of ["a", "b", "c"]) write(d, f, `${f} edited on ${d}`);
const raced = await Promise.all(["a", "b", "c"].map((d) => rbox(d, "sync")));
for (let round = 0; round < 2; round++) for (const d of ["a", "b", "c"]) await rbox(d, "sync");
const rc = contents("a");
check("ISC-52 3-way simultaneous race converges", sameTree("a", "b") && sameTree("b", "c"), raced.map((r) => r.split("|")[2]?.trim()).join(" / "));
check("ISC-56 3-way race keeps every version", raceFiles.every((f) => ["a", "b", "c"].every((d) => rc.has(hashOf(`${f} edited on ${d}`)))));
const copies = [...tree("a").keys()].filter((k) => k.startsWith("race-") && k.includes("conflicted copy"));
check("ISC-53 exactly two copies per raced file", copies.length === 6, `${copies.length} copies`);

// --- fresh fourth device reconstructs everything
await init("d", "Tablet");
await rbox("d", "sync");
check("ISC-46 fresh device reconstructs full tree", sameTree("a", "d"), `${tree("d").size} files`);

// --- watch mode: local change published within 3 s, remote change pulled by poll
const watcher = Bun.spawn([BIN, "watch", "--poll-secs", "2"], { env: env("a"), stdout: "ignore", stderr: "ignore" });
await Bun.sleep(1500);
before = await journalCount();
write("a", "watched.txt", "hello from watch");
let seen = false;
for (let i = 0; i < 30 && !seen; i++) {
  await Bun.sleep(100);
  seen = (await journalCount()) > before;
}
check("ISC-62 watch publishes local change within 3 s", seen);
write("b", "from-b.txt", "pulled by poll");
await rbox("b", "sync");
let pulled = false;
for (let i = 0; i < 60 && !pulled; i++) {
  await Bun.sleep(100);
  pulled = existsSync(join(box("a"), "from-b.txt"));
}
check("ISC-62 watch pulls remote change by poll", pulled);
await Bun.sleep(3000);
const settled = await journalCount();
await Bun.sleep(3000);
check("ISC-59 watch loop is quiescent (no echo loop)", (await journalCount()) === settled);
watcher.kill("SIGINT");
await watcher.exited;

// --- regression (review #2): an unreadable folder must not turn into remote deletes
const rboxRaw = (d: string, ...args: string[]) => $`${BIN} ${args}`.env(env(d)).nothrow().quiet();
write("a", "Private/one.txt", "one");
write("a", "Private/two.txt", "two");
await rbox("a", "sync");
await rbox("b", "sync");
await $`chmod 000 ${join(box("a"), "Private")}`;
const locked = await rboxRaw("a", "sync");
await $`chmod 755 ${join(box("a"), "Private")}`;
await rbox("b", "sync");
check("Review#2 unreadable folder: sync reports failure", locked.exitCode === 2, locked.stdout.toString().trim());
check("Review#2 unreadable folder: no remote deletes", existsSync(join(box("b"), "Private/one.txt")) && existsSync(join(box("b"), "Private/two.txt")));

// --- regression (review #2): an emptied sync folder (unmounted drive) must not wipe other devices
const aside = join(T, "aside");
mkdirSync(aside);
for (const name of readdirSync(box("a"))) renameSync(join(box("a"), name), join(aside, name));
const emptied = await rboxRaw("a", "sync");
check("Review#2 mass-delete guard refuses", emptied.exitCode !== 0 && emptied.stderr.toString().includes("Refusing to delete"));
for (const name of readdirSync(aside)) renameSync(join(aside, name), join(box("a"), name));
await rbox("b", "sync");
check("Review#2 mass-delete guard: other device untouched", sameTree("a", "b"));

// --- regression (review #3): file on one device vs folder of the same name on another
write("b", "Reports", "a plain file called Reports");
write("a", "Reports/q1.txt", "q1 numbers");
await rbox("a", "sync");
const collide = await rboxRaw("b", "sync");
for (let round = 0; round < 2; round++) for (const d of ["a", "b"]) await rbox(d, "sync");
check("Review#3 file-vs-folder: sync does not stall", collide.exitCode === 0, collide.stderr.toString().split("\n")[0] ?? "");
check("Review#3 file-vs-folder: both contents survive and converge",
  sameTree("a", "b") && contents("a").has(hashOf("a plain file called Reports")) && read("a", "Reports/q1.txt") === "q1 numbers");

// --- regression (Cato critical): crash after journal PUT, then the user reverts the file
write("a", "ledger.txt", "H0");
await rbox("a", "sync");
await rbox("b", "sync");
write("a", "ledger.txt", "H1 committed then crashed");
const crashed = await $`${BIN} sync`.env({ ...env("a"), RBOX_FAULT_CRASH_AFTER_JOURNAL_PUT: "1" }).nothrow().quiet();
check("Cato#1 fault injection crashed after PUT", crashed.exitCode === 99);
write("a", "ledger.txt", "H0"); // user reverts before the next run
await rbox("a", "sync");
await rbox("b", "sync");
await rbox("a", "sync");
check("Cato#1 committed entry recovered: devices converge", sameTree("a", "b") && read("b", "ledger.txt") === "H1 committed then crashed", `A=${read("a", "ledger.txt")} B=${read("b", "ledger.txt")}`);

// --- regression (Cato warning): a relative RBOX_HOME inside the sync folder is refused
const nested = await $`${BIN} init --folder box --bucket ${BUCKET} --endpoint ${ENDPOINT} --access-key-id dev --device-name Nested --insecure-file-keystore --kdf-memory-kib 8192`
  .cwd(join(T, "a"))
  .env({ ...env("a"), RBOX_HOME: "box/.profile" })
  .nothrow()
  .quiet();
check("Cato#2 profile inside sync folder refused", nested.exitCode !== 0 && nested.stderr.toString().includes("must not contain each other"));
rmSync(join(box("a"), ".profile"), { recursive: true, force: true });

// --- leak probe: nothing in the bucket may contain a plaintext name or content
const names = ["Private", "Reports", "finances", "Documents", "Taxes", "receipt", "holiday", "Lisbon", "notes", "plan", "watched", "Laptop", "Desktop", "Q3 numbers", "coffee"];
const objects = await listAll("");
let leaks: string[] = [];
for (const o of objects) {
  for (const n of names) if (o.key.includes(n)) leaks.push(`key ${o.key} contains ${n}`);
  if (o.size < 5_000_000) {
    const body = Buffer.from(await s3.file(o.key).arrayBuffer()).toString("latin1");
    for (const n of names) if (body.includes(n)) leaks.push(`object ${o.key} contains ${n}`);
  }
}
check("ISC-29 no plaintext names or content in bucket", leaks.length === 0, leaks.length ? leaks.slice(0, 5).join("; ") : `${objects.length} objects scanned`);
check("ISC-4 bucket layout", objects.every((o) => o.key === "rb/vault.json" || /^rb\/blobs\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(o.key) || /^rb\/journal\/[0-9a-f-]{36}\/\d{20}$/.test(o.key)));

// --- cloned device id must not overwrite journal
await $`cp -R ${join(T, "a/home")} ${join(T, "clone-home")}`;
mkdirSync(join(T, "clone"), { recursive: true });
const cloneEnv = { ...env("a"), RBOX_HOME: join(T, "clone-home") };
write("a", "after-clone.txt", "x");
await rbox("a", "sync");
writeFileSync(join(box("a"), "clone-collision.txt"), "y"); // same folder, stale seq in cloned profile
const clone = await $`${BIN} sync`.env(cloneEnv).nothrow().quiet();
check("Advisor#3 cloned device cannot overwrite journal slot", clone.exitCode !== 0 && clone.stderr.toString().includes("already taken"), clone.stderr.toString().split("\n").find((l) => l.includes("taken")) ?? "");

console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} E2E CHECK(S) FAILED`);
if (failures === 0) rmSync(T, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
