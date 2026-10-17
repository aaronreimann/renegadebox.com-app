#!/usr/bin/env bun
// Deploys the RenegadeBox account service to Cloudflare (free plan).
//
//   bun run deploy
//
// 1. Checks `wrangler whoami` (run `bunx wrangler login` first if needed).
// 2. Creates the D1 database `renegadebox` if missing and writes its id into wrangler.toml.
// 3. Applies D1 migrations remotely.
// 4. Generates PEPPER and SETUP_KEK and uploads them with the deploy, only if the Worker does
//    not have them yet. GOOGLE_CLIENT_SECRET is uploaded too when it is set in the environment.
// 5. Deploys the Worker; wrangler.toml routes app.renegadebox.com to it.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLOUD_DIR = resolve(import.meta.dir, "..");
const TOML = join(CLOUD_DIR, "wrangler.toml");
const WORKER = "renegadebox-cloud";
const DATABASE = "renegadebox";
const DOMAIN = "app.renegadebox.com";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function wrangler(args: string[], opts: { inherit?: boolean } = {}): Promise<RunResult> {
  const proc = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: CLOUD_DIR,
    stdin: "ignore",
    stdout: opts.inherit ? "inherit" : "pipe",
    stderr: opts.inherit ? "inherit" : "pipe",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  const code = await proc.exited;
  const stdout = opts.inherit ? "" : await new Response(proc.stdout as ReadableStream).text();
  const stderr = opts.inherit ? "" : await new Response(proc.stderr as ReadableStream).text();
  return { code, stdout, stderr };
}

function fail(message: string): never {
  console.error(`\nDeploy stopped: ${message}`);
  process.exit(1);
}

function step(message: string) {
  console.log(`\n==> ${message}`);
}

async function checkLogin() {
  step("Checking Cloudflare login");
  const res = await wrangler(["whoami"]);
  const out = res.stdout + res.stderr;
  if (res.code !== 0 || /not authenticated|not logged in/i.test(out)) {
    fail("wrangler is not logged in. Run `bunx wrangler login` and try again.");
  }
  const email = /associated with the email ([^\s.]+@[^\s]+?)\.?\s/i.exec(out)?.[1];
  console.log(email ? `Logged in as ${email}` : "Logged in.");
}

async function findDatabaseId(): Promise<string | null> {
  const res = await wrangler(["d1", "list", "--json"]);
  if (res.code !== 0) fail(`could not list D1 databases:\n${res.stderr || res.stdout}`);
  let list: Array<{ name: string; uuid: string }>;
  try {
    list = JSON.parse(res.stdout);
  } catch {
    fail(`unexpected output from \`wrangler d1 list --json\`:\n${res.stdout}`);
  }
  return list.find((db) => db.name === DATABASE)?.uuid ?? null;
}

async function ensureDatabase() {
  step(`Ensuring D1 database "${DATABASE}"`);
  let id = await findDatabaseId();
  if (!id) {
    console.log("Creating it.");
    const res = await wrangler(["d1", "create", DATABASE]);
    if (res.code !== 0) fail(`could not create the D1 database:\n${res.stderr || res.stdout}`);
    id = await findDatabaseId();
    if (!id) fail("the D1 database was created but does not appear in `wrangler d1 list`.");
  }
  const toml = readFileSync(TOML, "utf8");
  const updated = toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`);
  if (!/^database_id = /m.test(toml)) fail("wrangler.toml has no database_id line to fill in.");
  if (updated !== toml) {
    writeFileSync(TOML, updated);
    console.log(`Wrote database_id ${id} to wrangler.toml.`);
  } else {
    console.log(`Using database ${id}.`);
  }
}

async function applyMigrations() {
  step("Applying D1 migrations (remote)");
  const res = await wrangler(["d1", "migrations", "apply", DATABASE, "--remote"], { inherit: true });
  if (res.code !== 0) fail("D1 migrations failed.");
}

async function existingSecrets(): Promise<Set<string>> {
  const res = await wrangler(["secret", "list", "--name", WORKER, "--format", "json"]);
  if (res.code !== 0) return new Set(); // The Worker does not exist yet.
  try {
    return new Set((JSON.parse(res.stdout) as Array<{ name: string }>).map((s) => s.name));
  } catch {
    fail(`unexpected output from \`wrangler secret list\`:\n${res.stdout}`);
  }
}

async function deploy() {
  step("Checking secrets");
  const args = ["deploy"]; // the custom domain is in wrangler.toml
  let secretsDir: string | null = null;
  const have = await existingSecrets();
  const upload: Record<string, string> = {};
  // Uploaded with the deploy so the Worker never runs without them. Never printed.
  for (const name of ["PEPPER", "SETUP_KEK"]) {
    if (have.has(name)) {
      console.log(`${name} is already set; leaving it unchanged.`);
    } else {
      upload[name] = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
      console.log(`Generated a new ${name}; it will be uploaded with this deploy.`);
    }
  }
  if (process.env.GOOGLE_CLIENT_SECRET) {
    upload.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    console.log("Uploading GOOGLE_CLIENT_SECRET from the environment.");
  } else if (!have.has("GOOGLE_CLIENT_SECRET")) {
    console.log("GOOGLE_CLIENT_SECRET is not set: Google sign-in stays off until it is.");
  }
  if (Object.keys(upload).length > 0) {
    // Changing PEPPER invalidates password hashes; changing SETUP_KEK locks Google accounts out.
    // Existing values are therefore never replaced here.
    secretsDir = mkdtempSync(join(tmpdir(), "rb-deploy-"));
    const file = join(secretsDir, "secrets.json");
    writeFileSync(file, JSON.stringify(upload), { mode: 0o600 });
    args.push("--secrets-file", file);
  }

  step(`Deploying ${WORKER} to ${DOMAIN}`);
  try {
    const res = await wrangler(args, { inherit: true });
    if (res.code !== 0) fail("wrangler deploy failed.");
  } finally {
    if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
  }
}

await checkLogin();
await ensureDatabase();
await applyMigrations();
await deploy();
console.log(`\nDone. Check https://${DOMAIN}/api/v1/health`);
