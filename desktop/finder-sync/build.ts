#!/usr/bin/env bun
// Build the RenegadeBox Finder Sync extension (.appex)
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const OUT_DIR = process.argv[2] ?? join(DIR, "RenegadeBoxFinderSync.appex");
const SWIFT_SRC = join(DIR, "FinderSync.swift");
const PLIST_SRC = join(DIR, "Info.plist");

console.log(`Building Finder Sync extension -> ${OUT_DIR}…`);

if (existsSync(OUT_DIR)) {
  rmSync(OUT_DIR, { recursive: true, force: true });
}

const macosDir = join(OUT_DIR, "Contents/MacOS");
const resourcesDir = join(OUT_DIR, "Contents/Resources");
mkdirSync(macosDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });

// Copy Info.plist
cpSync(PLIST_SRC, join(OUT_DIR, "Contents/Info.plist"));

// Compile Swift source into executable
const outBin = join(macosDir, "RenegadeBoxFinderSync");
// An app extension has no main of its own: it must enter through NSExtensionMain, which
// loads NSExtensionPrincipalClass. Without it swiftc emits an empty main and the process
// exits the moment Finder launches it.
await $`swiftc -target arm64-apple-macos13.0 -O -application-extension -framework Cocoa -framework FinderSync -lsqlite3 -emit-executable -module-name RenegadeBoxFinderSync -Xlinker -e -Xlinker _NSExtensionMain ${SWIFT_SRC} -o ${outBin}`;

// Always sign with the sandbox entitlements: macOS will not load an unsandboxed extension.
// Without a signing identity this is an ad-hoc signature, enough for local use.
const identity = process.env.APPLE_SIGNING_IDENTITY ?? "-";
const entitlements = join(DIR, "FinderSync.entitlements");
await $`codesign --force --sign ${identity} --entitlements ${entitlements} --identifier com.renegadebox.desktop.findersync ${OUT_DIR}`.quiet();
console.log(`✓ Finder Sync extension built and signed (${identity === "-" ? "ad-hoc" : identity})`);
