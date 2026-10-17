import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { api, authInit, connect, createAccount, loginDevice, randomBytesB64, startServer, type Server } from "./harness";

let server: Server;

beforeAll(async () => {
  server = await startServer();
}, 90_000);

afterAll(async () => {
  await server?.stop();
});

function objectKey(deviceId: string, seq: number) {
  return `rb/journal/${deviceId}/${String(seq).padStart(20, "0")}`;
}

async function authed(token: string, deviceId: string, accountId: string) {
  const s = connect(server, token);
  expect(await s.opened).toBe(true);
  s.send(authInit(token, deviceId));
  const ok = await s.next();
  expect(ok.type).toBe("auth_ok");
  expect(ok.payload.device_id).toBe(deviceId);
  expect(ok.payload.account_id).toBe(accountId);
  expect(typeof ok.payload.server_time).toBe("number");
  return s;
}

describe("relay", () => {
  test("journal_appended fans out as sync_required to other devices only", async () => {
    const acct = await createAccount(server);
    const b = await loginDevice(server, acct);
    const other = await createAccount(server); // a different account must not hear anything

    const sa = await authed(acct.token, acct.deviceId, acct.accountId);
    const sb = await authed(b.token, b.deviceId, acct.accountId);
    const so = await authed(other.token, other.deviceId, other.accountId);

    const sealed = randomBytesB64(120);
    sa.send({
      type: "journal_appended",
      payload: { seq: 7, object_key: objectKey(acct.deviceId, 7), sealed_entry: sealed },
    });
    const msg = await sb.next();
    expect(msg).toEqual({
      type: "sync_required",
      payload: { origin_device_id: acct.deviceId, seq: 7, object_key: objectKey(acct.deviceId, 7), sealed_entry: sealed },
    });

    // The Rust client sends sealed_entry: null when there is none; it is dropped, not relayed.
    sb.send({ type: "journal_appended", payload: { seq: 3, object_key: objectKey(b.deviceId, 3), sealed_entry: null } });
    const back = await sa.next();
    expect(back).toEqual({
      type: "sync_required",
      payload: { origin_device_id: b.deviceId, seq: 3, object_key: objectKey(b.deviceId, 3) },
    });

    expect(await sb.quiet(500)).toBe(true); // B never hears its own append
    expect(await so.quiet(200)).toBe(true);

    // Sender got nothing for its own first append either (only B's append above).
    sa.send({ type: "ping", payload: { nonce: "abc" } });
    expect(await sa.next()).toEqual({ type: "pong", payload: { nonce: "abc" } });

    sa.close();
    sb.close();
    so.close();
  });

  test("ping gets pong", async () => {
    const acct = await createAccount(server);
    const s = await authed(acct.token, acct.deviceId, acct.accountId);
    s.send({ type: "ping", payload: { nonce: "n-1" } });
    expect(await s.next()).toEqual({ type: "pong", payload: { nonce: "n-1" } });
    s.send({ type: "ping", payload: {} });
    expect(await s.next()).toEqual({ type: "pong", payload: {} });
    s.close();
  });

  test("missing or invalid bearer token is refused", async () => {
    const noToken = await fetch(`${server.base}/api/v1/hub`, {
      headers: { upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
    });
    expect(noToken.status).toBe(401);
    expect(((await noToken.json()) as any).error.code).toBe("unauthorized");

    const s1 = connect(server);
    expect(await s1.opened).toBe(false);
    const s2 = connect(server, "x".repeat(43));
    expect(await s2.opened).toBe(false);
  });

  test("auth_init with a different token than the upgrade is refused", async () => {
    const acct = await createAccount(server);
    const other = await loginDevice(server, acct);
    const s = connect(server, acct.token);
    expect(await s.opened).toBe(true);
    s.send(authInit(other.token, acct.deviceId));
    const err = await s.next();
    expect(err).toMatchObject({ type: "auth_error", payload: { code: "invalid_token" } });
    expect((await s.closed).code).toBe(4001);
  });

  test("journal_appended before auth_init is refused", async () => {
    const acct = await createAccount(server);
    const b = await loginDevice(server, acct);
    const sb = await authed(b.token, b.deviceId, acct.accountId);

    const s = connect(server, acct.token);
    expect(await s.opened).toBe(true);
    s.send({ type: "journal_appended", payload: { seq: 1, object_key: objectKey(acct.deviceId, 1) } });
    const err = await s.next();
    expect(err).toMatchObject({ type: "auth_error", payload: { code: "invalid_token" } });
    expect((await s.closed).code).toBe(4001);
    expect(await sb.quiet(300)).toBe(true);
    sb.close();
  });

  test("revoking a device closes its socket with auth_error revoked", async () => {
    const acct = await createAccount(server);
    const b = await loginDevice(server, acct);
    const sa = await authed(acct.token, acct.deviceId, acct.accountId);
    const sb = await authed(b.token, b.deviceId, acct.accountId);

    const res = await api(server, "DELETE", `/devices/${b.deviceId}`, { token: acct.token });
    expect(res.status).toBe(204);
    const msg = await sb.next();
    expect(msg.type).toBe("auth_error");
    expect(msg.payload.code).toBe("revoked");
    expect(typeof msg.payload.message).toBe("string");
    expect((await sb.closed).code).toBe(4002);

    // A keeps working, and B can no longer connect.
    expect(await sa.quiet(200)).toBe(true);
    sa.send({ type: "ping", payload: {} });
    expect((await sa.next()).type).toBe("pong");
    expect(await connect(server, b.token).opened).toBe(false);

    // Deleting the account drops the remaining socket too.
    expect((await api(server, "DELETE", "/account", { token: acct.token, body: { auth_key: acct.authKey } })).status).toBe(204);
    expect((await sa.next()).payload.code).toBe("revoked");
    expect((await sa.closed).code).toBe(4002);
  });

  test("logout closes this device's socket", async () => {
    const acct = await createAccount(server);
    const s = await authed(acct.token, acct.deviceId, acct.accountId);
    expect((await api(server, "POST", "/logout", { token: acct.token })).status).toBe(204);
    expect((await s.next()).payload.code).toBe("revoked");
    await s.closed;
  });

  test("unauthenticated sockets time out after 10 seconds", async () => {
    const acct = await createAccount(server);
    const s = connect(server, acct.token);
    expect(await s.opened).toBe(true);
    const started = Date.now();
    const err = await s.next(15_000);
    expect(err).toMatchObject({ type: "auth_error", payload: { code: "invalid_token" } });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect((await s.closed).code).toBe(4001);
  }, 20_000);
});
