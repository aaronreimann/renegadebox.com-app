import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { api, createAccount, device, randomBytesB64, randomEmail, startServer, type Server } from "./harness";

let server: Server;

beforeAll(async () => {
  server = await startServer();
}, 90_000);

afterAll(async () => {
  await server?.stop();
});

/** Starts a sign-in and plays Google's part: the browser comes back with a (fake) code. */
async function googleSignIn(sub: string, email: string, dev = device(), opts: { cancel?: boolean } = {}) {
  const start = await api(server, "POST", "/auth/google/start", { body: { device: dev } });
  expect(start.status).toBe(200);
  const url = new URL(start.body.url);
  expect(url.origin).toBe("https://accounts.google.com");
  expect(url.searchParams.get("redirect_uri")).toBe(`${server.base}/api/v1/auth/google/callback`);
  const pending = await api(server, "POST", "/auth/google/poll", { body: { session_id: start.body.session_id, poll_secret: start.body.poll_secret } });
  expect(pending.status).toBe(202);
  const cb = new URL(`${server.base}/api/v1/auth/google/callback`);
  cb.searchParams.set("state", url.searchParams.get("state")!);
  if (opts.cancel) cb.searchParams.set("error", "access_denied");
  else cb.searchParams.set("code", `fake:${sub}:${email}`);
  const page = await fetch(cb);
  const html = await page.text();
  const poll = await api(server, "POST", "/auth/google/poll", { body: { session_id: start.body.session_id, poll_secret: start.body.poll_secret } });
  return { start, page, html, poll };
}

describe("Google sign-in", () => {
  test("first sign-in creates an account with a key; later sign-ins get the same key", async () => {
    const sub = crypto.randomUUID();
    const email = randomEmail();
    const first = await googleSignIn(sub, email);
    expect(first.page.status).toBe(200);
    expect(first.html).toContain("You're signed in");
    expect(first.poll.status).toBe(200);
    expect(first.poll.body.is_new).toBe(true);
    expect(first.poll.body.email).toBe(email);
    expect(first.poll.body.setup_blob).toBeNull();
    expect(Buffer.from(first.poll.body.account_key, "base64").length).toBe(32);

    // The first Mac saves its setup.
    const blob = randomBytesB64(300);
    const put = await api(server, "PUT", "/setup", { token: first.poll.body.device_token, body: { setup_blob: blob, base_version: 0 } });
    expect(put.status).toBe(200);

    const second = await googleSignIn(sub, email);
    expect(second.poll.status).toBe(200);
    expect(second.poll.body.is_new).toBe(false);
    expect(second.poll.body.account_id).toBe(first.poll.body.account_id);
    expect(second.poll.body.account_key).toBe(first.poll.body.account_key);
    expect(second.poll.body.setup_blob).toBe(blob);
    expect(second.poll.body.setup_version).toBe(1);

    const devices = await api(server, "GET", "/devices", { token: second.poll.body.device_token });
    expect(devices.body.devices).toHaveLength(2);
    const account = await api(server, "GET", "/account", { token: second.poll.body.device_token });
    expect(account.body.provider).toBe("google");
  });

  test("a session gives its result once, and a wrong poll secret gets nothing", async () => {
    const r = await googleSignIn(crypto.randomUUID(), randomEmail());
    expect(r.poll.status).toBe(200);
    const again = await api(server, "POST", "/auth/google/poll", { body: { session_id: r.start.body.session_id, poll_secret: r.start.body.poll_secret } });
    expect(again.status).toBe(410);

    const start = await api(server, "POST", "/auth/google/start", { body: { device: device() } });
    const wrong = await api(server, "POST", "/auth/google/poll", { body: { session_id: start.body.session_id, poll_secret: "nope" } });
    expect(wrong.status).toBe(410);
  });

  test("a tampered state is refused and the session stays pending", async () => {
    const start = await api(server, "POST", "/auth/google/start", { body: { device: device() } });
    const cb = new URL(`${server.base}/api/v1/auth/google/callback`);
    cb.searchParams.set("state", `${start.body.session_id}.0000`);
    cb.searchParams.set("code", "fake:attacker:attacker@example.com");
    const page = await fetch(cb);
    expect(page.status).toBe(400);
    const poll = await api(server, "POST", "/auth/google/poll", { body: { session_id: start.body.session_id, poll_secret: start.body.poll_secret } });
    expect(poll.status).toBe(202);
  });

  test("cancelling at Google is reported as cancelled", async () => {
    const r = await googleSignIn(crypto.randomUUID(), randomEmail(), device(), { cancel: true });
    expect(r.html).toContain("cancelled");
    expect(r.poll.status).toBe(409);
    expect(r.poll.body.error.code).toBe("cancelled");
  });

  test("an email that already has a password account is not taken over", async () => {
    const acct = await createAccount(server);
    const r = await googleSignIn(crypto.randomUUID(), acct.email);
    expect(r.poll.status).toBe(409);
    expect(r.poll.body.error.code).toBe("email_taken");
  });

  test("Google accounts cannot use password login, change password, and delete with confirm", async () => {
    const email = randomEmail();
    const r = await googleSignIn(crypto.randomUUID(), email);
    const token = r.poll.body.device_token;
    const login = await api(server, "POST", "/login", { body: { email, auth_key: randomBytesB64(32), device: device() } });
    expect(login.status).toBe(401);
    const pw = await api(server, "POST", "/password", {
      token,
      body: { kdf: { alg: "argon2id", m_kib: 65536, t: 3, p: 1, salt: randomBytesB64(16) }, auth_key: randomBytesB64(32), wrapped_account_key: randomBytesB64(64) },
    });
    expect(pw.status).toBe(400);
    expect((await api(server, "DELETE", "/account", { token, body: {} })).status).toBe(400);
    expect((await api(server, "DELETE", "/account", { token, body: { confirm: "delete" } })).status).toBe(204);
    expect((await api(server, "GET", "/account", { token })).status).toBe(401);
  });

  test("start validates the device", async () => {
    const bad = await api(server, "POST", "/auth/google/start", { body: { device: { id: "x" } } });
    expect(bad.status).toBe(400);
  });
});
