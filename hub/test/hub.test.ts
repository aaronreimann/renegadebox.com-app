import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createHub } from "../src/server.js";
import { createDb, hashToken, runMigrations } from "../src/db.js";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  AuthInitMessage,
  AuthOkMessage,
  AuthErrorMessage,
  JournalAppendedMessage,
  SyncRequiredMessage,
  PingMessage,
  PongMessage,
} from "@renegadebox/protocol";

const DB_URL =
  process.env.DATABASE_URL ||
  "postgres://renegadebox:renegadebox@localhost:5432/renegadebox";

describe("RenegadeBox Hub (WebSocket Relay)", () => {
  const sql = createDb(DB_URL);
  let hub1: Awaited<ReturnType<typeof createHub>>;
  let hub2: Awaited<ReturnType<typeof createHub>>;

  // Test account & devices
  const accountId1 = randomUUID();
  const accountId2 = randomUUID();

  const deviceId1A = randomUUID();
  const rawToken1A = randomBytes(32).toString("hex");

  const deviceId1B = randomUUID();
  const rawToken1B = randomBytes(32).toString("hex");

  const deviceId2 = randomUUID();
  const rawToken2 = randomBytes(32).toString("hex");

  const revokedDeviceId = randomUUID();
  const rawRevokedToken = randomBytes(32).toString("hex");

  beforeAll(async () => {
    await runMigrations(sql);

    // Insert test accounts
    await sql`
      INSERT INTO accounts (id, email, password_hash)
      VALUES (${accountId1}, ${`user1_${Date.now()}@test.local`}, 'hash_dummy'),
             (${accountId2}, ${`user2_${Date.now()}@test.local`}, 'hash_dummy')
    `;

    // Insert test devices
    await sql`
      INSERT INTO devices (id, account_id, name, token_hash, client_version)
      VALUES 
        (${deviceId1A}, ${accountId1}, 'Laptop 1A', ${hashToken(rawToken1A)}, 'rbox 0.1.0'),
        (${deviceId1B}, ${accountId1}, 'Desktop 1B', ${hashToken(rawToken1B)}, 'rbox 0.1.0'),
        (${deviceId2}, ${accountId2}, 'Device 2', ${hashToken(rawToken2)}, 'rbox 0.1.0'),
        (${revokedDeviceId}, ${accountId1}, 'Revoked Device', ${hashToken(rawRevokedToken)}, 'rbox 0.1.0')
    `;

    // Mark revoked device
    await sql`
      UPDATE devices SET revoked_at = NOW() WHERE id = ${revokedDeviceId}
    `;

    // Start two Hub instances on random ports to test multi-instance fan-out
    hub1 = await createHub({ port: 0, dbUrl: DB_URL });
    hub2 = await createHub({ port: 0, dbUrl: DB_URL });
  });

  afterAll(async () => {
    await hub1.stop();
    await hub2.stop();
    // Clean up test data
    await sql`DELETE FROM accounts WHERE id IN (${accountId1}, ${accountId2})`;
    await sql.end();
  });

  // Helper to connect a WebSocket client and wait for open
  function connectWs(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.onopen = () => resolve(ws);
      ws.onerror = (err) => reject(err);
    });
  }

  // Helper to wait for the next message
  function nextMessage<T = unknown>(ws: WebSocket, timeoutMs = 4000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.addEventListener(
        "message",
        (event) => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(event.data.toString()) as T);
          } catch (e) {
            reject(e);
          }
        },
        { once: true }
      );
    });
  }

  it("ISC-76: authenticates valid device with auth_ok", async () => {
    const ws = await connectWs(hub1.port);
    const authInit: AuthInitMessage = {
      type: "auth_init",
      payload: {
        device_token: rawToken1A,
        device_id: deviceId1A,
        device_name: "Laptop 1A",
        client_version: "rbox 0.1.0",
      },
    };

    ws.send(JSON.stringify(authInit));
    const msg = await nextMessage<AuthOkMessage>(ws);

    expect(msg.type).toBe("auth_ok");
    expect(msg.payload.device_id).toBe(deviceId1A);
    expect(msg.payload.account_id).toBe(accountId1);
    expect(typeof msg.payload.server_time).toBe("number");

    ws.close();
  });

  it("ISC-76: rejects invalid token with auth_error (invalid_token)", async () => {
    const ws = await connectWs(hub1.port);
    const authInit: AuthInitMessage = {
      type: "auth_init",
      payload: {
        device_token: "wrong_token_that_does_not_exist",
        device_id: deviceId1A,
        device_name: "Laptop 1A",
        client_version: "rbox 0.1.0",
      },
    };

    ws.send(JSON.stringify(authInit));
    const msg = await nextMessage<AuthErrorMessage>(ws);

    expect(msg.type).toBe("auth_error");
    expect(msg.payload.code).toBe("invalid_token");

    // Wait for connection to close
    await new Promise((resolve) => {
      ws.onclose = resolve;
    });
  });

  it("ISC-77: rejects revoked device with auth_error (revoked)", async () => {
    const ws = await connectWs(hub1.port);
    const authInit: AuthInitMessage = {
      type: "auth_init",
      payload: {
        device_token: rawRevokedToken,
        device_id: revokedDeviceId,
        device_name: "Revoked Device",
        client_version: "rbox 0.1.0",
      },
    };

    ws.send(JSON.stringify(authInit));
    const msg = await nextMessage<AuthErrorMessage>(ws);

    expect(msg.type).toBe("auth_error");
    expect(msg.payload.code).toBe("revoked");

    await new Promise((resolve) => {
      ws.onclose = resolve;
    });
  });

  it("ISC-84: responds to ping with pong preserving nonce", async () => {
    const ws = await connectWs(hub1.port);
    const ping: PingMessage = {
      type: "ping",
      payload: { nonce: "nonce-12345" },
    };

    ws.send(JSON.stringify(ping));
    const msg = await nextMessage<PongMessage>(ws);

    expect(msg.type).toBe("pong");
    expect(msg.payload.nonce).toBe("nonce-12345");

    ws.close();
  });

  it("ISC-80, ISC-81: relays journal_appended to other devices on same account, not to origin, and not to other accounts", async () => {
    // Connect Device 1A on Hub 1
    const ws1A = await connectWs(hub1.port);
    ws1A.send(
      JSON.stringify({
        type: "auth_init",
        payload: {
          device_token: rawToken1A,
          device_id: deviceId1A,
          device_name: "Laptop 1A",
          client_version: "rbox 0.1.0",
        },
      })
    );
    await nextMessage(ws1A);

    // Connect Device 1B on Hub 1
    const ws1B = await connectWs(hub1.port);
    ws1B.send(
      JSON.stringify({
        type: "auth_init",
        payload: {
          device_token: rawToken1B,
          device_id: deviceId1B,
          device_name: "Desktop 1B",
          client_version: "rbox 0.1.0",
        },
      })
    );
    await nextMessage(ws1B);

    // Connect Device 2 (different account) on Hub 1
    const ws2 = await connectWs(hub1.port);
    ws2.send(
      JSON.stringify({
        type: "auth_init",
        payload: {
          device_token: rawToken2,
          device_id: deviceId2,
          device_name: "Device 2",
          client_version: "rbox 0.1.0",
        },
      })
    );
    await nextMessage(ws2);

    // Device 1A appends a journal entry
    const journalAppended: JournalAppendedMessage = {
      type: "journal_appended",
      payload: {
        seq: 42,
        object_key: `rb/journal/${deviceId1A}/00000000000000000042`,
        sealed_entry: Buffer.from("sealed-ciphertext-test").toString("base64"),
      },
    };

    let device2Received = false;
    ws2.onmessage = () => {
      device2Received = true;
    };

    let device1AReceived = false;
    ws1A.onmessage = () => {
      device1AReceived = true;
    };

    const wait1B = nextMessage<SyncRequiredMessage>(ws1B);
    ws1A.send(JSON.stringify(journalAppended));

    const syncMsg = await wait1B;
    expect(syncMsg.type).toBe("sync_required");
    expect(syncMsg.payload.origin_device_id).toBe(deviceId1A);
    expect(syncMsg.payload.seq).toBe(42);
    expect(syncMsg.payload.object_key).toBe(`rb/journal/${deviceId1A}/00000000000000000042`);
    expect(syncMsg.payload.sealed_entry).toBe(Buffer.from("sealed-ciphertext-test").toString("base64"));

    // Wait a brief tick to verify neither 1A nor 2 received anything
    await Bun.sleep(200);
    expect(device1AReceived).toBe(false);
    expect(device2Received).toBe(false);

    ws1A.close();
    ws1B.close();
    ws2.close();
  });

  it("ISC-83: multi-instance Hub fan-out via Postgres LISTEN/NOTIFY", async () => {
    // Device 1A connects to Hub 1
    const ws1A = await connectWs(hub1.port);
    ws1A.send(
      JSON.stringify({
        type: "auth_init",
        payload: {
          device_token: rawToken1A,
          device_id: deviceId1A,
          device_name: "Laptop 1A",
          client_version: "rbox 0.1.0",
        },
      })
    );
    await nextMessage(ws1A);

    // Device 1B connects to Hub 2 (completely different server port!)
    const ws1B = await connectWs(hub2.port);
    ws1B.send(
      JSON.stringify({
        type: "auth_init",
        payload: {
          device_token: rawToken1B,
          device_id: deviceId1B,
          device_name: "Desktop 1B",
          client_version: "rbox 0.1.0",
        },
      })
    );
    await nextMessage(ws1B);

    const wait1B = nextMessage<SyncRequiredMessage>(ws1B);

    // Device 1A publishes on Hub 1
    ws1A.send(
      JSON.stringify({
        type: "journal_appended",
        payload: {
          seq: 43,
          object_key: `rb/journal/${deviceId1A}/00000000000000000043`,
        },
      })
    );

    // Device 1B on Hub 2 receives sync_required via Postgres NOTIFY!
    const syncMsg = await wait1B;
    expect(syncMsg.type).toBe("sync_required");
    expect(syncMsg.payload.origin_device_id).toBe(deviceId1A);
    expect(syncMsg.payload.seq).toBe(43);

    ws1A.close();
    ws1B.close();
  });

  it("ISC-82: drops sealed_entry if payload exceeds Postgres NOTIFY limit", async () => {
    const ws1A = await connectWs(hub1.port);
    ws1A.send(
      JSON.stringify({
        type: "auth_init",
        payload: {
          device_token: rawToken1A,
          device_id: deviceId1A,
          device_name: "Laptop 1A",
          client_version: "rbox 0.1.0",
        },
      })
    );
    await nextMessage(ws1A);

    const ws1B = await connectWs(hub1.port);
    ws1B.send(
      JSON.stringify({
        type: "auth_init",
        payload: {
          device_token: rawToken1B,
          device_id: deviceId1B,
          device_name: "Desktop 1B",
          client_version: "rbox 0.1.0",
        },
      })
    );
    await nextMessage(ws1B);

    // 8000 bytes base64 payload (larger than safe 7500 limit)
    const largeSealed = Buffer.alloc(6000, 0x41).toString("base64"); // 8000 base64 chars

    const wait1B = nextMessage<SyncRequiredMessage>(ws1B);
    ws1A.send(
      JSON.stringify({
        type: "journal_appended",
        payload: {
          seq: 44,
          object_key: `rb/journal/${deviceId1A}/00000000000000000044`,
          sealed_entry: largeSealed,
        },
      })
    );

    const syncMsg = await wait1B;
    expect(syncMsg.type).toBe("sync_required");
    expect(syncMsg.payload.seq).toBe(44);
    // sealed_entry should have been safely omitted so receiver fetches from S3
    expect(syncMsg.payload.sealed_entry).toBeUndefined();

    ws1A.close();
    ws1B.close();
  });

  it("ISC-88: disconnects active device when revoked via Postgres notification", async () => {
    const ws1A = await connectWs(hub1.port);
    ws1A.send(
      JSON.stringify({
        type: "auth_init",
        payload: {
          device_token: rawToken1A,
          device_id: deviceId1A,
          device_name: "Laptop 1A",
          client_version: "rbox 0.1.0",
        },
      })
    );
    await nextMessage(ws1A);

    // Now emit revocation event via Postgres
    await sql.notify(
      "account_events",
      JSON.stringify({
        action: "device_revoked",
        device_id: deviceId1A,
      })
    );

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws1A.onclose = (event) => {
        resolve({ code: event.code, reason: event.reason });
      };
    });

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(4002);
    expect(closeEvent.reason).toBe("revoked");
  });

  it("ISC-89: tokens in database are stored only as SHA-256 hashes", async () => {
    const rows = await sql`
      SELECT id, token_hash FROM devices WHERE id = ${deviceId1A}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].token_hash).toBe(hashToken(rawToken1A));
    expect(rows[0].token_hash).not.toBe(rawToken1A);
  });
});
