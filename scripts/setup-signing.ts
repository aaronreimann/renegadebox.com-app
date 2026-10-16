#!/usr/bin/env bun
// One-time setup: create a local code-signing identity for RenegadeBox builds.
//
// Why: macOS remembers "Always Allow" for a Keychain item per *code signature*. Unsigned
// development builds get a new ad-hoc signature on every rebuild, so macOS keeps asking.
// Signing every build with the same identity makes "Always Allow" stick, and secrets can
// stay in the Keychain where they belong.
//
// This identity is only trusted on this Mac. Public releases need an Apple Developer ID.
//
// Usage: bun scripts/setup-signing.ts     (macOS asks for your login password once)

import { $ } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";

export const IDENTITY = "RenegadeBox Local Signing";
const KEYCHAIN = join(homedir(), "Library/Keychains/login.keychain-db");

if (process.platform !== "darwin") {
  console.log("Code signing setup is only needed on macOS.");
  process.exit(0);
}

const existing = await $`security find-identity -v -p codesigning`.nothrow().text();
if (existing.includes(IDENTITY)) {
  console.log(`✓ "${IDENTITY}" already exists and is trusted. Nothing to do.`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "rbox-signing-"));
try {
  const conf = join(dir, "cert.cnf");
  writeFileSync(
    conf,
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = ext",
      "prompt = no",
      "[dn]",
      `CN = ${IDENTITY}`,
      "[ext]",
      "basicConstraints = critical, CA:false",
      "keyUsage = critical, digitalSignature",
      "extendedKeyUsage = critical, codeSigning",
      "",
    ].join("\n"),
  );
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  const p12 = join(dir, "identity.p12");
  const pass = randomBytes(18).toString("base64url");

  console.log("Creating a local signing certificate…");
  await $`openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout ${key} -out ${cert} -config ${conf}`.quiet();
  // -legacy keeps the PKCS#12 readable by macOS's `security import`.
  await $`openssl pkcs12 -export -legacy -inkey ${key} -in ${cert} -name ${IDENTITY} -out ${p12} -passout pass:${pass}`.quiet();

  console.log("Adding it to your login keychain…");
  await $`security import ${p12} -k ${KEYCHAIN} -P ${pass} -T /usr/bin/codesign`.quiet();

  console.log("Trusting it for code signing — macOS will ask for your login password now.");
  await $`security add-trusted-cert -p codeSign -k ${KEYCHAIN} ${cert}`;

  const check = await $`security find-identity -v -p codesigning`.text();
  if (!check.includes(IDENTITY)) throw new Error("the identity was imported but macOS does not list it as valid");
  console.log(`\n✓ Done. Builds made with scripts/install.ts are now signed as "${IDENTITY}".`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
