import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  api,
  bigRandomB64,
  createAccount,
  device,
  kdf,
  loginDevice,
  randomBytesB64,
  randomEmail,
  randomIp,
  startServer,
  TEST_PEPPER,
  type Server,
} from "./harness";

let server: Server;

beforeAll(async () => {
  server = await startServer();
}, 90_000);

afterAll(async () => {
  await server?.stop();
});

function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    email: randomEmail(),
    account_id: crypto.randomUUID(),
    kdf: kdf(),
    auth_key: randomBytesB64(32),
    wrapped_account_key: randomBytesB64(64),
    setup_blob: randomBytesB64(200),
    device: device(),
    ...overrides,
  };
}

describe("pages", () => {
  test("GET / is a plain HTML page", async () => {
    const res = await fetch(`${server.base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>RenegadeBox</title>");
    expect(html).toContain("RenegadeBox app on your Mac");
  });

  test("unknown paths are a JSON 404", async () => {
    const res = await fetch(`${server.base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
  });

  test("health", async () => {
    const res = await api(server, "GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
  });
});

describe("signup and login", () => {
  test("signup returns a token and setup version", async () => {
    const body = signupBody();
    const res = await api(server, "POST", "/signup", { body });
    expect(res.status).toBe(201);
    expect(res.body.account_id).toBe(body.account_id);
    expect(res.body.setup_version).toBe(1);
    expect(res.body.device_token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const none = await api(server, "POST", "/signup", { body: signupBody({ setup_blob: null }) });
    expect(none.status).toBe(201);
    expect(none.body.setup_version).toBe(0);
  });

  test("email_taken conflict, case-insensitive", async () => {
    const body = signupBody();
    expect((await api(server, "POST", "/signup", { body })).status).toBe(201);
    const again = await api(server, "POST", "/signup", {
      body: signupBody({ email: body.email.toUpperCase() }),
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("email_taken");
  });

  test("prelogin: known email returns stored kdf", async () => {
    const acct = await createAccount(server);
    const res = await api(server, "POST", "/prelogin", { body: { email: acct.email } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kdf: acct.kdf });
  });

  test("prelogin: unknown email returns a stable fake salt with default params", async () => {
    const email = randomEmail();
    const a = await api(server, "POST", "/prelogin", { body: { email } });
    const b = await api(server, "POST", "/prelogin", { body: { email: `  ${email.toUpperCase()} ` } });
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
    const expected = createHmac("sha256", TEST_PEPPER).update(`salt|${email}`).digest().subarray(0, 16);
    expect(a.body.kdf).toEqual({ alg: "argon2id", m_kib: 65536, t: 3, p: 1, salt: expected.toString("base64") });
    const other = await api(server, "POST", "/prelogin", { body: { email: randomEmail() } });
    expect(other.body.kdf.salt).not.toBe(a.body.kdf.salt);
  });

  test("login success and failure", async () => {
    const setup = randomBytesB64(500);
    const acct = await createAccount(server, { setupBlob: setup });
    const ok = await api(server, "POST", "/login", {
      body: { email: acct.email, auth_key: acct.authKey, device: device() },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      account_id: acct.accountId,
      kdf: acct.kdf,
      wrapped_account_key: acct.wrapped,
      setup_blob: setup,
      setup_version: 1,
    });
    expect(typeof ok.body.device_token).toBe("string");

    const bad = await api(server, "POST", "/login", {
      body: { email: acct.email, auth_key: randomBytesB64(32), device: device() },
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_credentials");

    const unknown = await api(server, "POST", "/login", {
      body: { email: randomEmail(), auth_key: randomBytesB64(32), device: device() },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("invalid_credentials");
  });

  test("login rate limit: 429 with Retry-After after 10 failures per email", async () => {
    const acct = await createAccount(server);
    for (let i = 0; i < 10; i++) {
      const res = await api(server, "POST", "/login", {
        body: { email: acct.email, auth_key: randomBytesB64(32), device: device() },
      });
      expect(res.status).toBe(401);
    }
    const limited = await api(server, "POST", "/login", {
      body: { email: acct.email, auth_key: acct.authKey, device: device() },
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    const retry = Number(limited.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(15 * 60);
  });

  test("login rate limit: 50 failures per IP", async () => {
    const ip = randomIp();
    for (let i = 0; i < 50; i++) {
      const res = await api(server, "POST", "/login", {
        ip,
        body: { email: randomEmail(), auth_key: randomBytesB64(32), device: device() },
      });
      expect(res.status).toBe(401);
    }
    const limited = await api(server, "POST", "/login", {
      ip,
      body: { email: randomEmail(), auth_key: randomBytesB64(32), device: device() },
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("signup rate limit: 10 per IP per hour", async () => {
    const ip = randomIp();
    for (let i = 0; i < 10; i++) {
      expect((await api(server, "POST", "/signup", { ip, body: signupBody() })).status).toBe(201);
    }
    const limited = await api(server, "POST", "/signup", { ip, body: signupBody() });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("validation", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["bad email", { email: "not-an-email" }],
    ["too long email", { email: `${"a".repeat(250)}@example.com` }],
    ["m_kib too small", { kdf: { ...kdf(), m_kib: 1024 } }],
    ["t too large", { kdf: { ...kdf(), t: 11 } }],
    ["p zero", { kdf: { ...kdf(), p: 0 } }],
    ["wrong alg", { kdf: { ...kdf(), alg: "scrypt" } }],
    ["salt too short", { kdf: kdf(randomBytesB64(8)) }],
    ["salt not base64", { kdf: kdf("!!!!!!!!!!!!!!!!!!!!!!!!") }],
    ["auth key wrong length", { auth_key: randomBytesB64(16) }],
    ["device id not uuid", { device: { ...device(), id: "abc" } }],
    ["device name empty", { device: { ...device(), name: "" } }],
    ["device name too long", { device: { ...device(), name: "x".repeat(129) } }],
  ];
  for (const [name, override] of cases) {
    test(`signup rejects ${name}`, async () => {
      const res = await api(server, "POST", "/signup", { body: signupBody(override) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_request");
    });
  }

  test("malformed JSON is invalid_request", async () => {
    const res = await api(server, "POST", "/login", { rawBody: "{nope" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  test("oversize setup blob is 413 too_large", async () => {
    const res = await api(server, "POST", "/signup", { body: signupBody({ setup_blob: bigRandomB64(256 * 1024 + 1) }) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("too_large");
  });

  test("setup blob of exactly 256 KiB is accepted", async () => {
    const res = await api(server, "POST", "/signup", { body: signupBody({ setup_blob: bigRandomB64(256 * 1024) }) });
    expect(res.status).toBe(201);
  });

  test("oversize request body is 413 too_large", async () => {
    const res = await api(server, "POST", "/signup", {
      body: signupBody({ padding: "x".repeat(600 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("too_large");
  });

  test("missing or bad token is 401 unauthorized", async () => {
    const none = await api(server, "GET", "/account");
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("unauthorized");
    const bad = await api(server, "GET", "/account", { token: "A".repeat(43) });
    expect(bad.status).toBe(401);
  });
});

describe("account and setup", () => {
  test("GET /account", async () => {
    const acct = await createAccount(server);
    const res = await api(server, "GET", "/account", { token: acct.token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      account_id: acct.accountId,
      email: acct.email,
      device_id: acct.deviceId,
      setup_version: 0,
    });
    expect(Number.isNaN(Date.parse(res.body.created_at))).toBe(false);
  });

  test("GET and PUT setup with version conflict", async () => {
    const acct = await createAccount(server);
    const empty = await api(server, "GET", "/setup", { token: acct.token });
    expect(empty.body).toEqual({ setup_blob: null, setup_version: 0 });

    const blob1 = randomBytesB64(300);
    const put1 = await api(server, "PUT", "/setup", { token: acct.token, body: { setup_blob: blob1, base_version: 0 } });
    expect(put1.status).toBe(200);
    expect(put1.body).toEqual({ setup_version: 1 });

    const stale = await api(server, "PUT", "/setup", {
      token: acct.token,
      body: { setup_blob: randomBytesB64(300), base_version: 0 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("version_conflict");
    expect(stale.body.setup_version).toBe(1);

    const got = await api(server, "GET", "/setup", { token: acct.token });
    expect(got.body).toEqual({ setup_blob: blob1, setup_version: 1 });

    const blob2 = randomBytesB64(300);
    const put2 = await api(server, "PUT", "/setup", { token: acct.token, body: { setup_blob: blob2, base_version: 1 } });
    expect(put2.body).toEqual({ setup_version: 2 });

    const tooBig = await api(server, "PUT", "/setup", {
      token: acct.token,
      body: { setup_blob: bigRandomB64(256 * 1024 + 3), base_version: 2 },
    });
    expect(tooBig.status).toBe(413);
  });
});

describe("devices", () => {
  test("list, revoke another device, logout, re-login", async () => {
    const acct = await createAccount(server);
    const second = await loginDevice(server, acct);

    const list = await api(server, "GET", "/devices", { token: acct.token });
    expect(list.status).toBe(200);
    expect(list.body.devices).toHaveLength(2);
    const mine = list.body.devices.find((d: any) => d.id === acct.deviceId);
    const other = list.body.devices.find((d: any) => d.id === second.deviceId);
    expect(mine).toMatchObject({ current: true, name: "Test Mac", platform: "macos", client_version: "0.1.0" });
    expect(other.current).toBe(false);
    expect(Number.isNaN(Date.parse(mine.last_seen_at))).toBe(false);
    expect(Number.isNaN(Date.parse(mine.created_at))).toBe(false);

    // Revoke the second device: its token dies and it leaves the list.
    const del = await api(server, "DELETE", `/devices/${second.deviceId}`, { token: acct.token });
    expect(del.status).toBe(204);
    expect((await api(server, "GET", "/account", { token: second.token })).status).toBe(401);
    const after = await api(server, "GET", "/devices", { token: acct.token });
    expect(after.body.devices.map((d: any) => d.id)).toEqual([acct.deviceId]);
    expect((await api(server, "DELETE", `/devices/${second.deviceId}`, { token: acct.token })).status).toBe(404);
    expect((await api(server, "DELETE", `/devices/${crypto.randomUUID()}`, { token: acct.token })).status).toBe(404);

    // Re-login with the revoked device id signs it back in with a new token.
    const back = await loginDevice(server, acct, second.deviceId);
    expect(back.token).not.toBe(second.token);
    expect((await api(server, "GET", "/account", { token: back.token })).status).toBe(200);
    expect((await api(server, "GET", "/account", { token: second.token })).status).toBe(401);

    // Re-login with an active device id replaces its token.
    const replaced = await loginDevice(server, acct, second.deviceId);
    expect((await api(server, "GET", "/account", { token: back.token })).status).toBe(401);
    expect((await api(server, "GET", "/account", { token: replaced.token })).status).toBe(200);
    expect((await api(server, "GET", "/devices", { token: acct.token })).body.devices).toHaveLength(2);

    // Logout signs this device out.
    expect((await api(server, "POST", "/logout", { token: acct.token })).status).toBe(204);
    expect((await api(server, "GET", "/account", { token: acct.token })).status).toBe(401);
    const remaining = await api(server, "GET", "/devices", { token: replaced.token });
    expect(remaining.body.devices.map((d: any) => d.id)).toEqual([second.deviceId]);
  });

  test("device_conflict when the device is signed in to another account", async () => {
    const a = await createAccount(server);
    const b = await createAccount(server);
    const res = await api(server, "POST", "/login", {
      body: { email: b.email, auth_key: b.authKey, device: device(a.deviceId) },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("device_conflict");

    const signup = await api(server, "POST", "/signup", { body: signupBody({ device: device(a.deviceId) }) });
    expect(signup.status).toBe(409);
    expect(signup.body.error.code).toBe("device_conflict");

    // Once signed out of account A, the Mac can sign in to account B.
    expect((await api(server, "POST", "/logout", { token: a.token })).status).toBe(204);
    const moved = await api(server, "POST", "/login", {
      body: { email: b.email, auth_key: b.authKey, device: device(a.deviceId) },
    });
    expect(moved.status).toBe(200);
  });
});

describe("password and deletion", () => {
  test("password change", async () => {
    const acct = await createAccount(server);
    const newKdf = kdf();
    const newAuth = randomBytesB64(32);
    const newWrapped = randomBytesB64(64);
    const res = await api(server, "POST", "/password", {
      token: acct.token,
      body: { kdf: newKdf, auth_key: newAuth, wrapped_account_key: newWrapped },
    });
    expect(res.status).toBe(204);

    const old = await api(server, "POST", "/login", {
      body: { email: acct.email, auth_key: acct.authKey, device: device() },
    });
    expect(old.status).toBe(401);

    const fresh = await api(server, "POST", "/login", {
      body: { email: acct.email, auth_key: newAuth, device: device() },
    });
    expect(fresh.status).toBe(200);
    expect(fresh.body.wrapped_account_key).toBe(newWrapped);
    expect(fresh.body.kdf).toEqual(newKdf);
    expect((await api(server, "POST", "/prelogin", { body: { email: acct.email } })).body.kdf).toEqual(newKdf);

    // Other signed-in devices stay signed in.
    expect((await api(server, "GET", "/account", { token: acct.token })).status).toBe(200);
  });

  test("account delete", async () => {
    const acct = await createAccount(server, { setupBlob: randomBytesB64(100) });
    const second = await loginDevice(server, acct);

    const wrong = await api(server, "DELETE", "/account", { token: acct.token, body: { auth_key: randomBytesB64(32) } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("invalid_credentials");

    const res = await api(server, "DELETE", "/account", { token: acct.token, body: { auth_key: acct.authKey } });
    expect(res.status).toBe(204);
    expect((await api(server, "GET", "/account", { token: acct.token })).status).toBe(401);
    expect((await api(server, "GET", "/account", { token: second.token })).status).toBe(401);
    const login = await api(server, "POST", "/login", {
      body: { email: acct.email, auth_key: acct.authKey, device: device() },
    });
    expect(login.status).toBe(401);

    // The email and device ids are free again.
    const again = await api(server, "POST", "/signup", {
      body: signupBody({ email: acct.email, device: device(acct.deviceId) }),
    });
    expect(again.status).toBe(201);
  });
});
