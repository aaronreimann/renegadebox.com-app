#!/usr/bin/env bun
// Build and install RenegadeBox on this Mac, signed with the local identity so the
// Keychain's "Always Allow" survives rebuilds.
//
//   bun scripts/install.ts            # CLI only  -> ~/.local/bin/rbox
//   bun scripts/install.ts --desktop  # CLI + desktop app -> ~/Applications/RenegadeBox.app
//
// Run scripts/setup-signing.ts once first (it asks for your login password).

import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const LOCAL_IDENTITY = "RenegadeBox Local Signing";
const rustup = "/opt/homebrew/opt/rustup/bin";
const env = { ...process.env, PATH: `${rustup}:${process.env.PATH}` };
// Bun's shell resolves commands against *this* process's PATH, not the .env() it is given,
// so call cargo by absolute path when Rust is installed via Homebrew rustup.
const CARGO = existsSync(join(rustup, "cargo")) ? join(rustup, "cargo") : (Bun.which("cargo") ?? "cargo");

// Prefer an Apple Development certificate: it carries a Team ID, so macOS remembers
// Keychain approvals by identity across rebuilds. A self-signed identity has no Team ID,
// so macOS pins approvals to each build's cdhash and asks again after every rebuild.
const identities = await $`security find-identity -v -p codesigning`.nothrow().text();
const appleDev = identities.match(/"(Apple Development: [^"]+)"/)?.[1];
const IDENTITY = appleDev ?? (identities.includes(LOCAL_IDENTITY) ? LOCAL_IDENTITY : undefined);
const canSign = IDENTITY !== undefined;
if (!appleDev) {
  console.warn("! No Apple Development certificate: macOS will ask for Keychain access again after every rebuild.");
  console.warn("  Fix (free): Xcode → Settings → Apple Accounts → click your name → Manage Certificates… → + → Apple Development.");
}
if (canSign) console.log(`Signing as: ${IDENTITY}`);

// --- CLI
console.log("Building rbox…");
await $`${CARGO} install --path engine --root ${join(homedir(), ".local")} --locked --force --quiet`.cwd(ROOT).env(env);
const rbox = join(homedir(), ".local/bin/rbox");
if (canSign) {
  await $`codesign --force --sign ${IDENTITY!} --identifier com.renegadebox.rbox ${rbox}`.quiet();
  console.log(`✓ ${rbox} (signed)`);
} else {
  console.log(`✓ ${rbox} (unsigned)`);
}

// --- Desktop app
if (process.argv.includes("--desktop")) {
  console.log("Building the desktop app (this takes a few minutes)…");
  const desktopEnv = canSign ? { ...env, APPLE_SIGNING_IDENTITY: IDENTITY! } : env;
  await $`bun install --silent`.cwd(join(ROOT, "desktop")).env(env);
  await $`bun run build -- --bundles app`.cwd(join(ROOT, "desktop")).env(desktopEnv);
  const target = JSON.parse(await $`${CARGO} metadata --format-version 1 --no-deps`.cwd(ROOT).env(env).text()).target_directory;
  const bundleDir = join(target, "release/bundle/macos");
  const app = readdirSync(bundleDir).find((f) => f.endsWith(".app"));
  if (!app) throw new Error(`no .app found in ${bundleDir}`);
  const dest = join(homedir(), "Applications", app);
  mkdirSync(join(homedir(), "Applications"), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(join(bundleDir, app), dest, { recursive: true });

  // --- Finder Sync Extension
  console.log("Building Finder Sync extension…");
  const pluginsDir = join(dest, "Contents/PlugIns");
  mkdirSync(pluginsDir, { recursive: true });
  const appexDest = join(pluginsDir, "RenegadeBoxFinderSync.appex");
  await $`bun ${join(ROOT, "desktop/finder-sync/build.ts")} ${appexDest}`.env(desktopEnv);

  // build.ts signed the extension with its sandbox entitlements; re-seal the app around it.
  if (canSign) await $`codesign --force --sign ${IDENTITY!} ${dest}`.quiet();

  // Register with macOS pluginkit, then check it actually took.
  await $`pluginkit -a ${appexDest}`.nothrow().quiet();
  await $`pluginkit -e use -i com.renegadebox.desktop.findersync`.nothrow().quiet();
  const registered = (await $`pluginkit -m -i com.renegadebox.desktop.findersync`.nothrow().quiet()).stdout.toString().trim();
  if (registered) console.log(`✓ Finder Sync extension registered: ${registered}`);
  else console.warn("! Finder Sync extension did not register. Enable it in System Settings → General → Login Items & Extensions → File Providers / Finder.");

  const sig = await $`codesign -dv --verbose=2 ${dest}`.nothrow().quiet();
  const authority = sig.stderr.toString().match(/Authority=(.*)/)?.[1] ?? "ad-hoc / unsigned";
  console.log(`✓ ${dest} (signed by: ${authority})`);
}
