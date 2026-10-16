import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "../src/lib/db.js";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionAccount,
  destroySession,
} from "../src/lib/auth.js";
import {
  createDevice,
  listDevices,
  revokeDevice,
  hashDeviceToken,
} from "../src/lib/devices.js";
import { randomUUID } from "node:crypto";
import type { AstroCookies } from "astro";

describe("RenegadeBox Dashboard & Control Plane Data Layer", () => {
  const testEmail = `test_${Date.now()}@example.com`;
  const testPassword = "SuperSecretPassword123!";
  let accountId: string;

  // Mock AstroCookies
  class MockCookies implements Partial<AstroCookies> {
    private store = new Map<string, string>();

    get(name: string) {
      const val = this.store.get(name);
      return val ? { value: val, json: () => JSON.parse(val), number: () => Number(val), boolean: () => Boolean(val) } : undefined;
    }
    set(name: string, value: string) {
      this.store.set(name, value);
    }
    delete(name: string) {
      this.store.delete(name);
    }
    has(name: string) {
      return this.store.has(name);
    }
  }

  beforeAll(async () => {
    // Clean any prior state
  });

  afterAll(async () => {
    if (accountId) {
      await sql`DELETE FROM accounts WHERE id = ${accountId}`;
    }
    await sql.end();
  });

  it("ISC-85: hashes passwords with Argon2id and verifies correctly", async () => {
    const hash = await hashPassword(testPassword);
    expect(hash).toContain("$argon2id$");

    const match = await verifyPassword(testPassword, hash);
    expect(match).toBe(true);

    const wrongMatch = await verifyPassword("WrongPassword!", hash);
    expect(wrongMatch).toBe(false);

    // Save test account
    const [row] = await sql`
      INSERT INTO accounts (email, password_hash)
      VALUES (${testEmail}, ${hash})
      RETURNING id
    `;
    accountId = row.id;
    expect(accountId).toBeDefined();
  });

  it("ISC-89: passwords in database are never stored in plaintext", async () => {
    const [row] = await sql`
      SELECT password_hash FROM accounts WHERE id = ${accountId}
    `;
    expect(row.password_hash).not.toBe(testPassword);
    expect(row.password_hash).toContain("$argon2id$");
  });

  it("ISC-85: manages sessions via secure cookies", async () => {
    const cookies = new MockCookies() as unknown as AstroCookies;

    const token = await createSession(accountId, cookies);
    expect(token.length).toBe(64); // 32 bytes hex = 64 chars

    const account = await getSessionAccount(cookies);
    expect(account).not.toBeNull();
    expect(account?.id).toBe(accountId);
    expect(account?.email).toBe(testEmail);

    await destroySession(cookies);
    const afterDestroy = await getSessionAccount(cookies);
    expect(afterDestroy).toBeNull();
  });

  it("ISC-87: registers a new device, returning raw token once and storing only SHA-256 hash", async () => {
    const device = await createDevice(accountId, "My Work Laptop");
    expect(device.id).toBeDefined();
    expect(device.name).toBe("My Work Laptop");
    expect(device.rawToken.length).toBe(64);

    // Verify DB stores only the hash
    const [row] = await sql`
      SELECT token_hash FROM devices WHERE id = ${device.id}
    `;
    expect(row.token_hash).toBe(hashDeviceToken(device.rawToken));
    expect(row.token_hash).not.toBe(device.rawToken);
  });

  it("ISC-86: lists registered devices with timestamps and status", async () => {
    const devices = await listDevices(accountId);
    expect(devices.length).toBeGreaterThanOrEqual(1);

    const dev = devices.find((d) => d.name === "My Work Laptop");
    expect(dev).toBeDefined();
    expect(dev?.revoked_at).toBeNull();
    expect(dev?.last_seen_at).toBeDefined();
  });

  it("ISC-88: revokes a device token and notifies account_events", async () => {
    const devices = await listDevices(accountId);
    const target = devices[0];

    // Setup listener to verify Postgres NOTIFY
    let notifyReceived: any = null;
    const sub = await sql.listen("account_events", (payload) => {
      try {
        notifyReceived = JSON.parse(payload);
      } catch {}
    });

    const revoked = await revokeDevice(accountId, target.id);
    expect(revoked).toBe(true);

    // Wait a tick for notify
    await Bun.sleep(150);
    expect(notifyReceived).not.toBeNull();
    expect(notifyReceived.action).toBe("device_revoked");
    expect(notifyReceived.device_id).toBe(target.id);

    // Verify DB updated
    const [row] = await sql`
      SELECT revoked_at FROM devices WHERE id = ${target.id}
    `;
    expect(row.revoked_at).not.toBeNull();
    await sub.unlisten();
  });
});
