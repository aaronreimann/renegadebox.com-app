// RenegadeBox account service. Contract: docs/ACCOUNTS.md.
//
// One Worker serves the JSON API under /api/v1, D1 holds accounts and devices, and the
// AccountHub Durable Object (one per account) runs the instant-sync relay.

import { googleCallback, googlePoll, googleStart } from "./google";
import { AccountHub, INTERNAL_ACCOUNT_ID, INTERNAL_DEVICE_ID, INTERNAL_TOKEN_HASH } from "./hub";
import {
  ApiError,
  DEFAULT_KDF,
  LIMITS,
  bytesToBase64,
  errorResponse,
  hmac,
  iso,
  isObject,
  isUuid,
  json,
  newDeviceToken,
  noContent,
  parseAccountId,
  parseAuthKey,
  parseDevice,
  parseEmail,
  parseKdf,
  parseSetupBlob,
  parseWrappedKey,
  safeEqual,
  sha256Hex,
  toHex,
  type DeviceInput,
  type Kdf,
} from "./util";

export { AccountHub };

export interface Env {
  DB: D1Database;
  HUB: DurableObjectNamespace<AccountHub>;
  PEPPER: string;
  /** 64 hex chars. Encrypts Google accounts' account keys at rest. */
  SETUP_KEK?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PUBLIC_URL?: string;
  /** Tests only; honoured only when PUBLIC_URL is localhost. */
  GOOGLE_FAKE?: string;
}

const API = "/api/v1";
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

const RATE = {
  loginEmail: { kind: "login_email", limit: 10, windowMs: 15 * 60 * 1000 },
  loginIp: { kind: "login_ip", limit: 50, windowMs: 15 * 60 * 1000 },
  signupIp: { kind: "signup_ip", limit: 10, windowMs: 60 * 60 * 1000 },
  googleIp: { kind: "google_ip", limit: 30, windowMs: 15 * 60 * 1000 },
} as const;
type RateRule = (typeof RATE)[keyof typeof RATE];

interface AccountRow {
  id: string;
  email: string;
  auth_hash: string;
  kdf_alg: string;
  kdf_m_kib: number;
  kdf_t: number;
  kdf_p: number;
  kdf_salt: string;
  wrapped_account_key: string;
  setup_blob: string | null;
  setup_version: number;
  created_at: number;
}

interface DeviceRow {
  id: string;
  account_id: string;
  name: string;
  platform: string;
  client_version: string;
  created_at: number;
  last_seen_at: number;
  revoked_at: number | null;
}

interface AuthContext {
  deviceId: string;
  accountId: string;
  tokenHash: string;
  email: string;
  createdAt: number;
  setupVersion: number;
  /** Signs in with Google rather than a password. */
  google: boolean;
}

interface Req {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: string[];
}

type Handler = (r: Req) => Promise<Response>;

// ---------------------------------------------------------------------------
// Router

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  { method: "GET", pattern: /^\/$/, handler: async () => homePage() },
  { method: "GET", pattern: /^\/api\/v1\/health$/, handler: async () => new Response("ok", { headers: { "content-type": "text/plain" } }) },
  { method: "POST", pattern: /^\/api\/v1\/prelogin$/, handler: prelogin },
  { method: "POST", pattern: /^\/api\/v1\/signup$/, handler: signup },
  { method: "POST", pattern: /^\/api\/v1\/login$/, handler: login },
  { method: "GET", pattern: /^\/api\/v1\/account$/, handler: getAccount },
  { method: "DELETE", pattern: /^\/api\/v1\/account$/, handler: deleteAccount },
  { method: "GET", pattern: /^\/api\/v1\/setup$/, handler: getSetup },
  { method: "PUT", pattern: /^\/api\/v1\/setup$/, handler: putSetup },
  { method: "GET", pattern: /^\/api\/v1\/devices$/, handler: listDevices },
  { method: "DELETE", pattern: /^\/api\/v1\/devices\/([^/]+)$/, handler: deleteDevice },
  { method: "POST", pattern: /^\/api\/v1\/logout$/, handler: logout },
  { method: "POST", pattern: /^\/api\/v1\/password$/, handler: changePassword },
  { method: "GET", pattern: /^\/api\/v1\/hub$/, handler: hubUpgrade },
  { method: "POST", pattern: /^\/api\/v1\/auth\/google\/start$/, handler: startGoogle },
  { method: "GET", pattern: /^\/api\/v1\/auth\/google\/callback$/, handler: async (r) => googleCallback(r.request, r.env) },
  { method: "POST", pattern: /^\/api\/v1\/auth\/google\/poll$/, handler: pollGoogle },
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      for (const route of routes) {
        if (route.method !== request.method && !(route.method === "GET" && request.method === "HEAD")) continue;
        const m = route.pattern.exec(path);
        if (!m) continue;
        if (path.startsWith(API) && path !== `${API}/health` && !env.PEPPER) {
          throw new ApiError("internal", "Server is not configured");
        }
        return await route.handler({ request, env, ctx, params: m.slice(1).map((p) => decodeURIComponent(p)) });
      }
      throw new ApiError("not_found", "Not found");
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err);
      console.error("unhandled error", err);
      return errorResponse(new ApiError("internal", "Internal error"));
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// Request helpers

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LIMITS.bodyBytes) throw new ApiError("too_large", "Request body is larger than 512 KiB");
  const buf = await request.arrayBuffer();
  if (buf.byteLength > LIMITS.bodyBytes) throw new ApiError("too_large", "Request body is larger than 512 KiB");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new ApiError("invalid_request", "Request body must be JSON");
  }
  if (!isObject(body)) throw new ApiError("invalid_request", "Request body must be a JSON object");
  return body;
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

async function authHash(env: Env, authKey: Uint8Array): Promise<string> {
  return toHex(await hmac(env.PEPPER, authKey));
}

function kdfOf(row: AccountRow): Kdf {
  return { alg: "argon2id", m_kib: row.kdf_m_kib, t: row.kdf_t, p: row.kdf_p, salt: row.kdf_salt };
}

async function authenticate(r: Req): Promise<AuthContext> {
  const header = r.request.headers.get("authorization") ?? "";
  const m = /^Bearer ([A-Za-z0-9_-]{16,512})$/.exec(header.trim());
  if (!m) throw new ApiError("unauthorized", "Missing or invalid device token");
  const tokenHash = await sha256Hex(m[1]!);
  const row = await r.env.DB.prepare(
    `SELECT d.id AS device_id, d.account_id, d.last_seen_at, a.email, a.created_at, a.setup_version, a.google_sub
       FROM devices d JOIN accounts a ON a.id = d.account_id
      WHERE d.token_hash = ? AND d.revoked_at IS NULL`,
  )
    .bind(tokenHash)
    .first<{
      device_id: string;
      account_id: string;
      last_seen_at: number;
      email: string;
      created_at: number;
      setup_version: number;
      google_sub: string | null;
    }>();
  if (!row) throw new ApiError("unauthorized", "Missing or invalid device token");

  const now = Date.now();
  if (now - row.last_seen_at >= LAST_SEEN_INTERVAL_MS) {
    r.ctx.waitUntil(
      r.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?")
        .bind(now, row.device_id, now - LAST_SEEN_INTERVAL_MS)
        .run()
        .catch((e) => console.error("last_seen_at update failed", e)),
    );
  }
  return {
    deviceId: row.device_id,
    accountId: row.account_id,
    tokenHash,
    email: row.email,
    createdAt: row.created_at,
    setupVersion: row.setup_version,
    google: row.google_sub !== null,
  };
}

function hubFor(env: Env, accountId: string) {
  return env.HUB.get(env.HUB.idFromName(accountId));
}

/** Marks devices signed out in D1, then drops their relay sockets. */
async function revokeDevices(env: Env, accountId: string, deviceIds: string[], message: string): Promise<void> {
  if (deviceIds.length === 0) return;
  const now = Date.now();
  const placeholders = deviceIds.map(() => "?").join(", ");
  await env.DB.prepare(
    `UPDATE devices SET revoked_at = ?, token_hash = NULL
      WHERE account_id = ? AND revoked_at IS NULL AND id IN (${placeholders})`,
  )
    .bind(now, accountId, ...deviceIds)
    .run();
  await notifyHub(env, accountId, deviceIds, message);
}

async function notifyHub(env: Env, accountId: string, deviceIds: string[] | null, message: string): Promise<void> {
  try {
    await hubFor(env, accountId).revoke(deviceIds, message);
  } catch (e) {
    // D1 is the source of truth: the token is already dead, so a reconnect fails at the Worker.
    console.error("relay revoke failed", e);
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (D1-backed sliding window)

async function rateSubject(env: Env, rule: RateRule, value: string): Promise<string> {
  return toHex(await hmac(env.PEPPER, `rl|${rule.kind}|${value}`)).slice(0, 32);
}

/** Throws 429 with Retry-After when any rule is at its limit. */
async function enforceLimits(env: Env, checks: Array<{ rule: RateRule; subject: string }>): Promise<void> {
  const now = Date.now();
  const results = await env.DB.batch<{ c: number; oldest: number | null }>(
    checks.map(({ rule, subject }) =>
      env.DB.prepare(
        "SELECT COUNT(*) AS c, MIN(created_at) AS oldest FROM auth_attempts WHERE kind = ? AND subject = ? AND created_at > ?",
      ).bind(rule.kind, subject, now - rule.windowMs),
    ),
  );
  let retryAfter = 0;
  checks.forEach(({ rule }, i) => {
    const row = results[i]?.results[0];
    if (row && row.c >= rule.limit && row.oldest !== null) {
      // Find the moment enough attempts have aged out to fall below the limit. Approximated by
      // the oldest attempt in the window expiring, which frees exactly one slot.
      const wait = Math.ceil((row.oldest + rule.windowMs - now) / 1000);
      retryAfter = Math.max(retryAfter, wait, 1);
    }
  });
  if (retryAfter > 0) {
    throw new ApiError("rate_limited", "Too many attempts. Try again later.", {}, { "Retry-After": String(retryAfter) });
  }
}

async function recordAttempts(env: Env, checks: Array<{ rule: RateRule; subject: string }>): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    ...checks.map(({ rule, subject }) =>
      env.DB.prepare("INSERT INTO auth_attempts (kind, subject, created_at) VALUES (?, ?, ?)").bind(
        rule.kind,
        subject,
        now,
      ),
    ),
    // Housekeeping: nothing older than the longest window is ever read.
    env.DB.prepare("DELETE FROM auth_attempts WHERE created_at < ?").bind(now - RATE.signupIp.windowMs),
  ]);
}

async function loginChecks(env: Env, email: string, ip: string) {
  return [
    { rule: RATE.loginEmail, subject: await rateSubject(env, RATE.loginEmail, email) },
    { rule: RATE.loginIp, subject: await rateSubject(env, RATE.loginIp, ip) },
  ];
}

// ---------------------------------------------------------------------------
// Device registration (shared by sign-up and login)

/**
 * Builds the statements that sign `device` in to `accountId` with a new token hash.
 * A device id that is signed in on another account is a conflict; one that was signed out of
 * another account is moved over.
 */
async function deviceStatements(
  env: Env,
  accountId: string,
  device: DeviceInput,
  tokenHash: string,
  now: number,
): Promise<D1PreparedStatement[]> {
  const existing = await env.DB.prepare("SELECT account_id, revoked_at FROM devices WHERE id = ?")
    .bind(device.id)
    .first<{ account_id: string; revoked_at: number | null }>();
  const insert = env.DB.prepare(
    `INSERT INTO devices (id, account_id, name, platform, client_version, token_hash, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(device.id, accountId, device.name, device.platform, device.client_version, tokenHash, now, now);

  if (!existing) return [insert];
  if (existing.account_id === accountId) {
    return [
      env.DB.prepare(
        `UPDATE devices SET name = ?, platform = ?, client_version = ?, token_hash = ?, last_seen_at = ?, revoked_at = NULL
          WHERE id = ?`,
      ).bind(device.name, device.platform, device.client_version, tokenHash, now, device.id),
    ];
  }
  if (existing.revoked_at === null) {
    throw new ApiError("device_conflict", "This device is signed in to another account");
  }
  return [
    env.DB.prepare("DELETE FROM devices WHERE id = ? AND revoked_at IS NOT NULL").bind(device.id),
    insert,
  ];
}

// ---------------------------------------------------------------------------
// Handlers

async function prelogin(r: Req): Promise<Response> {
  const body = await readJson(r.request);
  const email = parseEmail(body.email);
  const row = await r.env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first<AccountRow>();
  if (row) return json({ kdf: kdfOf(row) });
  const fake = (await hmac(r.env.PEPPER, `salt|${email}`)).slice(0, 16);
  return json({ kdf: { ...DEFAULT_KDF, salt: bytesToBase64(fake) } });
}

async function signup(r: Req): Promise<Response> {
  const body = await readJson(r.request);
  const email = parseEmail(body.email);
  const accountId = parseAccountId(body.account_id);
  const kdf = parseKdf(body.kdf);
  const authKey = parseAuthKey(body.auth_key);
  const wrapped = parseWrappedKey(body.wrapped_account_key);
  const setupBlob = parseSetupBlob(body.setup_blob, true);
  const device = parseDevice(body.device);

  const ip = clientIp(r.request);
  const checks = [{ rule: RATE.signupIp, subject: await rateSubject(r.env, RATE.signupIp, ip) }];
  await enforceLimits(r.env, checks);
  await recordAttempts(r.env, checks);

  const taken = await r.env.DB.prepare("SELECT email = ? AS same_email FROM accounts WHERE email = ? OR id = ? LIMIT 1")
    .bind(email, email, accountId)
    .first<{ same_email: number }>();
  if (taken) {
    if (taken.same_email) throw new ApiError("email_taken", "An account with this email already exists");
    throw new ApiError("invalid_request", "account_id is already in use");
  }

  const now = Date.now();
  const token = newDeviceToken();
  const tokenHash = await sha256Hex(token);
  const setupVersion = setupBlob === null ? 0 : 1;
  const deviceStmts = await deviceStatements(r.env, accountId, device, tokenHash, now);

  try {
    await r.env.DB.batch([
      r.env.DB.prepare(
        `INSERT INTO accounts (id, email, auth_hash, kdf_alg, kdf_m_kib, kdf_t, kdf_p, kdf_salt,
                               wrapped_account_key, setup_blob, setup_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        accountId,
        email,
        await authHash(r.env, authKey),
        kdf.alg,
        kdf.m_kib,
        kdf.t,
        kdf.p,
        kdf.salt,
        wrapped,
        setupBlob,
        setupVersion,
        now,
        now,
      ),
      ...deviceStmts,
    ]);
  } catch (e) {
    const msg = String(e);
    if (msg.includes("accounts.email")) throw new ApiError("email_taken", "An account with this email already exists");
    if (msg.includes("UNIQUE")) throw new ApiError("invalid_request", "account_id or device is already in use");
    throw e;
  }

  return json({ account_id: accountId, device_token: token, setup_version: setupVersion }, 201);
}

async function login(r: Req): Promise<Response> {
  const body = await readJson(r.request);
  const email = parseEmail(body.email);
  const authKey = parseAuthKey(body.auth_key);
  const device = parseDevice(body.device);

  const checks = await loginChecks(r.env, email, clientIp(r.request));
  await enforceLimits(r.env, checks);

  const row = await r.env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first<AccountRow>();
  const presented = await authHash(r.env, authKey);
  // Compare against a dummy when the account does not exist, so both paths do the same work.
  const ok = safeEqual(presented, row?.auth_hash ?? "0".repeat(64)) && row !== null;
  if (!ok || !row) {
    await recordAttempts(r.env, checks);
    throw new ApiError("invalid_credentials", "Email or password is incorrect");
  }

  const now = Date.now();
  const token = newDeviceToken();
  const stmts = await deviceStatements(r.env, row.id, device, await sha256Hex(token), now);
  await r.env.DB.batch(stmts);

  return json({
    account_id: row.id,
    device_token: token,
    kdf: kdfOf(row),
    wrapped_account_key: row.wrapped_account_key,
    setup_blob: row.setup_blob,
    setup_version: row.setup_version,
  });
}

async function getAccount(r: Req): Promise<Response> {
  const a = await authenticate(r);
  return json({
    account_id: a.accountId,
    email: a.email,
    created_at: iso(a.createdAt),
    device_id: a.deviceId,
    setup_version: a.setupVersion,
    provider: a.google ? "google" : "password",
  });
}

async function getSetup(r: Req): Promise<Response> {
  const a = await authenticate(r);
  const row = await r.env.DB.prepare("SELECT setup_blob, setup_version FROM accounts WHERE id = ?")
    .bind(a.accountId)
    .first<{ setup_blob: string | null; setup_version: number }>();
  if (!row) throw new ApiError("unauthorized", "Missing or invalid device token");
  return json({ setup_blob: row.setup_blob, setup_version: row.setup_version });
}

async function putSetup(r: Req): Promise<Response> {
  const a = await authenticate(r);
  const body = await readJson(r.request);
  const blob = parseSetupBlob(body.setup_blob, false);
  const base = body.base_version;
  if (typeof base !== "number" || !Number.isSafeInteger(base) || base < 0) {
    throw new ApiError("invalid_request", "base_version must be a non-negative integer");
  }
  const row = await r.env.DB.prepare(
    `UPDATE accounts SET setup_blob = ?, setup_version = setup_version + 1, updated_at = ?
      WHERE id = ? AND setup_version = ? RETURNING setup_version`,
  )
    .bind(blob, Date.now(), a.accountId, base)
    .first<{ setup_version: number }>();
  if (row) return json({ setup_version: row.setup_version });

  const current = await r.env.DB.prepare("SELECT setup_version FROM accounts WHERE id = ?")
    .bind(a.accountId)
    .first<{ setup_version: number }>();
  throw new ApiError("version_conflict", "The setup was changed by another device", {
    setup_version: current?.setup_version ?? 0,
  });
}

async function listDevices(r: Req): Promise<Response> {
  const a = await authenticate(r);
  const { results } = await r.env.DB.prepare(
    `SELECT id, name, platform, client_version, last_seen_at, created_at
       FROM devices WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at, id`,
  )
    .bind(a.accountId)
    .all<DeviceRow>();
  return json({
    devices: results.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      client_version: d.client_version,
      last_seen_at: iso(d.last_seen_at),
      created_at: iso(d.created_at),
      current: d.id === a.deviceId,
    })),
  });
}

async function deleteDevice(r: Req): Promise<Response> {
  const a = await authenticate(r);
  const id = (r.params[0] ?? "").toLowerCase();
  if (!isUuid(id)) throw new ApiError("not_found", "Device not found");
  const row = await r.env.DB.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ? AND revoked_at IS NULL")
    .bind(id, a.accountId)
    .first();
  if (!row) throw new ApiError("not_found", "Device not found");
  await revokeDevices(r.env, a.accountId, [id], "This Mac was signed out from another device.");
  return noContent();
}

async function logout(r: Req): Promise<Response> {
  const a = await authenticate(r);
  await revokeDevices(r.env, a.accountId, [a.deviceId], "This Mac was signed out.");
  return noContent();
}

async function changePassword(r: Req): Promise<Response> {
  const a = await authenticate(r);
  if (a.google) throw new ApiError("invalid_request", "This account signs in with Google and has no password");
  const body = await readJson(r.request);
  const kdf = parseKdf(body.kdf);
  const authKey = parseAuthKey(body.auth_key);
  const wrapped = parseWrappedKey(body.wrapped_account_key);
  await r.env.DB.prepare(
    `UPDATE accounts SET auth_hash = ?, kdf_alg = ?, kdf_m_kib = ?, kdf_t = ?, kdf_p = ?, kdf_salt = ?,
                         wrapped_account_key = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(await authHash(r.env, authKey), kdf.alg, kdf.m_kib, kdf.t, kdf.p, kdf.salt, wrapped, Date.now(), a.accountId)
    .run();
  return noContent();
}

async function deleteAccount(r: Req): Promise<Response> {
  const a = await authenticate(r);
  const body = await readJson(r.request);
  if (a.google) {
    // No password to confirm with; require an explicit confirmation instead.
    if (body.confirm !== "delete") throw new ApiError("invalid_request", 'Send {"confirm": "delete"} to delete this account');
    await removeAccount(r.env, a.accountId);
    return noContent();
  }
  const authKey = parseAuthKey(body.auth_key);

  const checks = await loginChecks(r.env, a.email, clientIp(r.request));
  await enforceLimits(r.env, checks);
  const row = await r.env.DB.prepare("SELECT auth_hash FROM accounts WHERE id = ?")
    .bind(a.accountId)
    .first<{ auth_hash: string }>();
  if (!row || !safeEqual(await authHash(r.env, authKey), row.auth_hash)) {
    await recordAttempts(r.env, checks);
    throw new ApiError("invalid_credentials", "Password is incorrect");
  }

  await removeAccount(r.env, a.accountId);
  return noContent();
}

async function removeAccount(env: Env, accountId: string): Promise<void> {
  // Devices cascade from accounts; the explicit delete keeps this correct even without FK enforcement.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM devices WHERE account_id = ?").bind(accountId),
    env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(accountId),
  ]);
  await notifyHub(env, accountId, null, "This account was deleted.");
}

async function startGoogle(r: Req): Promise<Response> {
  const body = await readJson(r.request);
  const checks = [{ rule: RATE.googleIp, subject: await rateSubject(r.env, RATE.googleIp, clientIp(r.request)) }];
  await enforceLimits(r.env, checks);
  await recordAttempts(r.env, checks);
  return googleStart(r.env, body);
}

async function pollGoogle(r: Req): Promise<Response> {
  const body = await readJson(r.request);
  return googlePoll(r.env, body, (accountId, device, tokenHash, now) => deviceStatements(r.env, accountId, device, tokenHash, now));
}

async function hubUpgrade(r: Req): Promise<Response> {
  const a = await authenticate(r);
  if (r.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw new ApiError("invalid_request", "Expected a WebSocket upgrade");
  }
  // Rebuild headers so clients cannot inject the internal ones.
  const headers = new Headers();
  for (const [k, v] of r.request.headers) {
    const key = k.toLowerCase();
    if (key.startsWith("x-rb-") || key === "authorization") continue;
    headers.set(k, v);
  }
  headers.set(INTERNAL_DEVICE_ID, a.deviceId);
  headers.set(INTERNAL_ACCOUNT_ID, a.accountId);
  headers.set(INTERNAL_TOKEN_HASH, a.tokenHash);
  return hubFor(r.env, a.accountId).fetch(new Request(r.request.url, { method: "GET", headers }));
}

// ---------------------------------------------------------------------------

function homePage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RenegadeBox</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         background: #f7f7f8; color: #1d1d1f; }
  main { max-width: 32rem; }
  h1 { font-size: 1.75rem; margin: 0 0 0.5rem; }
  p { margin: 0 0 0.75rem; color: #515154; }
  @media (prefers-color-scheme: dark) {
    body { background: #161618; color: #f5f5f7; }
    p { color: #a1a1a6; }
  }
</style>
</head>
<body>
<main>
  <h1>RenegadeBox</h1>
  <p>To sign in to your account, open the RenegadeBox app on your Mac.</p>
  <p>Your storage, folder and settings are set up automatically once you sign in.</p>
</main>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
