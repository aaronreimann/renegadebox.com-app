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
const IDENTITY = "RenegadeBox Local Signing";
const rustup = "/opt/homebrew/opt/rustup/bin";
const env = { ...process.env, PATH: `${rustup}:${process.env.PATH}` };

const identities = await $`security find-identity -v -p codesigning`.nothrow().text();
const canSign = identities.includes(IDENTITY);
if (!canSign) {
  console.warn(`! No "${IDENTITY}" identity — builds will be unsigned and macOS will keep asking for Keychain access.`);
  console.warn("  Run: bun scripts/setup-signing.ts");
}

// --- CLI
console.log("Building rbox…");
await $`cargo install --path engine --root ${join(homedir(), ".local")} --locked --force --quiet`.cwd(ROOT).env(env);
const rbox = join(homedir(), ".local/bin/rbox");
if (canSign) {
  await $`codesign --force --sign ${IDENTITY} --identifier com.renegadebox.rbox ${rbox}`.quiet();
  console.log(`✓ ${rbox} (signed)`);
} else {
  console.log(`✓ ${rbox} (unsigned)`);
}

// --- Desktop app
if (process.argv.includes("--desktop")) {
  console.log("Building the desktop app (this takes a few minutes)…");
  const desktopEnv = canSign ? { ...env, APPLE_SIGNING_IDENTITY: IDENTITY } : env;
  await $`bun install --silent`.cwd(join(ROOT, "desktop")).env(env);
  await $`bun run build -- --bundles app`.cwd(join(ROOT, "desktop")).env(desktopEnv);
  const target = JSON.parse(await $`cargo metadata --format-version 1 --no-deps`.cwd(ROOT).env(env).text()).target_directory;
  const bundleDir = join(target, "release/bundle/macos");
  const app = readdirSync(bundleDir).find((f) => f.endsWith(".app"));
  if (!app) throw new Error(`no .app found in ${bundleDir}`);
  const dest = join(homedir(), "Applications", app);
  mkdirSync(join(homedir(), "Applications"), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(join(bundleDir, app), dest, { recursive: true });
  const sig = await $`codesign -dv ${dest}`.nothrow().quiet();
  const authority = sig.stderr.toString().match(/Authority=(.*)/)?.[1] ?? "ad-hoc / unsigned";
  console.log(`✓ ${dest} (signed by: ${authority})`);
}
