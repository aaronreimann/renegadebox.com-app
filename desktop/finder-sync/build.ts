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
await $`swiftc -target arm64-apple-macos13.0 -O -framework Cocoa -framework FinderSync -lsqlite3 -emit-executable -module-name RenegadeBoxFinderSync ${SWIFT_SRC} -o ${outBin}`;

// Optional signing
const identity = process.env.APPLE_SIGNING_IDENTITY;
if (identity) {
  await $`codesign --force --sign ${identity} --identifier com.renegadebox.desktop.findersync ${OUT_DIR}`.quiet();
  console.log(`✓ Finder Sync extension built and signed (${identity})`);
} else {
  console.log(`✓ Finder Sync extension built (unsigned)`);
}
