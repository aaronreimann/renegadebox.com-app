// Sign in with Google.
//
// The app starts a sign-in session, opens the returned Google URL in the browser, and polls
// until Google redirects back to /auth/google/callback. Google accounts have no password to
// unlock the saved setup with, so their account key is kept here, encrypted under the
// SETUP_KEK secret. See docs/ACCOUNTS.md ("Google sign-in").

import {
  ApiError,
  DEFAULT_KDF,
  base64ToBytes,
  bytesToBase64,
  json,
  newDeviceToken,
  parseDevice,
  sha256Hex,
  type DeviceInput,
} from "./util";

export interface GoogleEnv {
  DB: D1Database;
  PEPPER: string;
  SETUP_KEK?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Origin Google sends the browser back to, e.g. https://app.renegadebox.com. */
  PUBLIC_URL?: string;
  /** Tests only: accept `fake:<sub>:<email>` codes. Ignored unless PUBLIC_URL is localhost. */
  GOOGLE_FAKE?: string;
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = "/api/v1/auth/google/callback";

export type DeviceStatements = (accountId: string, device: DeviceInput, tokenHash: string, now: number) => Promise<D1PreparedStatement[]>;

interface SessionRow {
  id: string;
  poll_hash: string;
  state_hash: string;
  device: string;
  google_sub: string | null;
  email: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

function configured(env: GoogleEnv): { clientId: string; clientSecret: string; kek: string } {
  if (!env.GOOGLE_CLIENT_ID || !env.SETUP_KEK || (!env.GOOGLE_CLIENT_SECRET && !fakeAllowed(env))) {
    throw new ApiError("not_configured", "Google sign-in is not set up on the server yet");
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET ?? "", kek: env.SETUP_KEK };
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function callbackUrl(env: GoogleEnv): string {
  return new URL(CALLBACK_PATH, env.PUBLIC_URL ?? "https://app.renegadebox.com").toString();
}

function fakeAllowed(env: GoogleEnv): boolean {
  if (env.GOOGLE_FAKE !== "1" || !env.PUBLIC_URL) return false;
  const host = new URL(env.PUBLIC_URL).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

// ---------------------------------------------------------------------------
// Account key at rest

async function kekKey(hex: string): Promise<CryptoKey> {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new ApiError("internal", "Server key is misconfigured");
  const raw = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const keyAad = (accountId: string) => new TextEncoder().encode(`renegadebox google account key v1|${accountId}`);

async function sealAccountKey(kek: string, accountId: string, accountKey: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: keyAad(accountId) }, await kekKey(kek), accountKey),
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return bytesToBase64(out);
}

async function openAccountKey(kek: string, accountId: string, sealed: string): Promise<Uint8Array> {
  const bytes = base64ToBytes(sealed);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: keyAad(accountId) },
    await kekKey(kek),
    bytes.slice(12),
  );
  return new Uint8Array(pt);
}

// ---------------------------------------------------------------------------
// Handlers

/** POST /auth/google/start {device} -> {session_id, poll_secret, url, expires_in} */
export async function googleStart(env: GoogleEnv, body: Record<string, unknown>): Promise<Response> {
  const { clientId } = configured(env);
  const device = parseDevice(body.device);
  const id = randomHex(16);
  const pollSecret = newDeviceToken();
  const state = randomHex(16);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM google_sessions WHERE created_at < ?").bind(now - SESSION_TTL_MS),
    env.DB.prepare("INSERT INTO google_sessions (id, poll_hash, state_hash, device, created_at) VALUES (?, ?, ?, ?, ?)").bind(
      id,
      await sha256Hex(pollSecret),
      await sha256Hex(state),
      JSON.stringify(device),
      now,
    ),
  ]);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl(env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", `${id}.${state}`);
  url.searchParams.set("prompt", "select_account");
  return json({ session_id: id, poll_secret: pollSecret, url: url.toString(), expires_in: SESSION_TTL_MS / 1000 });
}

interface GoogleIdentity {
  sub: string;
  email: string;
}

/** Exchange the code with Google. The ID token comes straight from Google over TLS, so its
 * claims can be read without verifying the signature (Google's documented guidance). */
async function exchangeCode(env: GoogleEnv, code: string): Promise<GoogleIdentity> {
  const { clientId, clientSecret } = configured(env);
  if (fakeAllowed(env)) {
    const m = /^fake:([^:]+):(.+)$/.exec(code);
    if (!m) throw new Error("bad fake code");
    return { sub: m[1]!, email: m[2]!.toLowerCase() };
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl(env),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  const tokens = (await res.json()) as { id_token?: string };
  const part = tokens.id_token?.split(".")[1];
  if (!part) throw new Error("Google sent no ID token");
  const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="))) as {
    iss?: string;
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    exp?: number;
  };
  if (claims.aud !== clientId) throw new Error("ID token is for another app");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new Error("ID token is not from Google");
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error("ID token expired");
  if (!claims.sub || !claims.email || claims.email_verified !== true) throw new Error("Google account has no verified email");
  return { sub: claims.sub, email: claims.email.toLowerCase() };
}

/** GET /auth/google/callback: where Google sends the browser back. */
export async function googleCallback(request: Request, env: GoogleEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const [id, state] = (params.get("state") ?? "").split(".");
  const session =
    id && state
      ? await env.DB.prepare("SELECT * FROM google_sessions WHERE id = ? AND completed_at IS NULL AND created_at > ?")
          .bind(id, Date.now() - SESSION_TTL_MS)
          .first<SessionRow>()
      : null;
  if (!session || !state || (await sha256Hex(state)) !== session.state_hash) {
    return page("This sign-in link has expired", "Go back to RenegadeBox and click Continue with Google again.", 400);
  }

  let identity: GoogleIdentity | null = null;
  let error: string | null = null;
  if (params.get("error")) {
    error = params.get("error") === "access_denied" ? "cancelled" : "google_error";
  } else {
    try {
      identity = await exchangeCode(env, params.get("code") ?? "");
    } catch (e) {
      console.error("google sign-in failed", e);
      error = "google_error";
    }
  }
  await env.DB.prepare("UPDATE google_sessions SET google_sub = ?, email = ?, error = ?, completed_at = ? WHERE id = ?")
    .bind(identity?.sub ?? null, identity?.email ?? null, error, Date.now(), session.id)
    .run();
  if (error === "cancelled") return page("Sign-in cancelled", "You can close this tab. Nothing was changed.");
  if (error) return page("Google sign-in didn't work", "Close this tab, go back to RenegadeBox and try again.", 502);
  return page("You're signed in", "You can close this tab and go back to RenegadeBox.");
}

/**
 * POST /auth/google/poll {session_id, poll_secret}
 * 202 {status: "pending"} until the browser comes back, then the sign-in result, once.
 */
export async function googlePoll(env: GoogleEnv, body: Record<string, unknown>, deviceStatements: DeviceStatements): Promise<Response> {
  const { kek } = configured(env);
  const id = typeof body.session_id === "string" ? body.session_id : "";
  const secret = typeof body.poll_secret === "string" ? body.poll_secret : "";
  const session = await env.DB.prepare("SELECT * FROM google_sessions WHERE id = ? AND created_at > ?")
    .bind(id, Date.now() - SESSION_TTL_MS)
    .first<SessionRow>();
  if (!session || (await sha256Hex(secret)) !== session.poll_hash) {
    throw new ApiError("expired", "This sign-in has expired. Start again.");
  }
  if (session.completed_at === null) return json({ status: "pending" }, 202);

  // Single use: whatever happens next, this session is spent.
  await env.DB.prepare("DELETE FROM google_sessions WHERE id = ?").bind(session.id).run();
  if (session.error === "cancelled") throw new ApiError("cancelled", "Sign-in was cancelled.");
  if (session.error || !session.google_sub || !session.email) {
    throw new ApiError("invalid_credentials", "Google sign-in didn't work. Try again.");
  }

  const device = parseDevice(JSON.parse(session.device));
  const now = Date.now();
  let account = await env.DB.prepare("SELECT id, email, server_wrapped_key, setup_blob, setup_version FROM accounts WHERE google_sub = ?")
    .bind(session.google_sub)
    .first<{ id: string; email: string; server_wrapped_key: string | null; setup_blob: string | null; setup_version: number }>();
  let isNew = false;
  const statements: D1PreparedStatement[] = [];

  if (!account) {
    const byEmail = await env.DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(session.email).first();
    if (byEmail) {
      throw new ApiError("email_taken", "This email already has a RenegadeBox account that signs in with a password.");
    }
    const accountId = crypto.randomUUID();
    const accountKey = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await sealAccountKey(kek, accountId, accountKey);
    // Google accounts have no password: the password columns hold values no login can match.
    statements.push(
      env.DB.prepare(
        `INSERT INTO accounts (id, email, auth_hash, kdf_alg, kdf_m_kib, kdf_t, kdf_p, kdf_salt,
                               wrapped_account_key, setup_blob, setup_version, created_at, updated_at,
                               google_sub, server_wrapped_key)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, '', NULL, 0, ?, ?, ?, ?)`,
      ).bind(
        accountId,
        session.email,
        DEFAULT_KDF.alg,
        DEFAULT_KDF.m_kib,
        DEFAULT_KDF.t,
        DEFAULT_KDF.p,
        bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
        now,
        now,
        session.google_sub,
        wrapped,
      ),
    );
    account = { id: accountId, email: session.email, server_wrapped_key: wrapped, setup_blob: null, setup_version: 0 };
    isNew = true;
  }
  if (!account.server_wrapped_key) throw new ApiError("internal", "Account key is missing");

  const token = newDeviceToken();
  statements.push(...(await deviceStatements(account.id, device, await sha256Hex(token), now)));
  await env.DB.batch(statements);

  const accountKey = await openAccountKey(kek, account.id, account.server_wrapped_key);
  return json({
    status: "ok",
    account_id: account.id,
    email: account.email,
    device_token: token,
    account_key: bytesToBase64(accountKey),
    setup_blob: account.setup_blob,
    setup_version: account.setup_version,
    is_new: isNew,
  });
}

function page(title: string, message: string, status = 200): Response {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
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
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  p { margin: 0; color: #515154; }
  @media (prefers-color-scheme: dark) { body { background: #161618; color: #f5f5f7; } p { color: #a1a1a6; } }
</style>
</head>
<body><main><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body>
</html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

