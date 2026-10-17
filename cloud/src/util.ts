// Shared helpers: responses, crypto, encoding and input validation.

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "invalid_credentials"
  | "not_found"
  | "email_taken"
  | "device_conflict"
  | "version_conflict"
  | "too_large"
  | "rate_limited"
  | "expired"
  | "cancelled"
  | "not_configured"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  invalid_credentials: 401,
  not_found: 404,
  email_taken: 409,
  device_conflict: 409,
  version_conflict: 409,
  too_large: 413,
  rate_limited: 429,
  expired: 410,
  cancelled: 409,
  not_configured: 503,
  internal: 500,
};

/** Thrown by handlers and turned into the standard error body by the router. */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly extra: Record<string, unknown> = {},
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(err: ApiError): Response {
  return json(
    { error: { code: err.code, message: err.message, ...err.extra }, ...err.extra },
    STATUS[err.code],
    err.headers,
  );
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

// ---------------------------------------------------------------------------
// Encoding

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decoded length of a standard, padded base64 string, or -1 when it is not valid.
 * Checks the alphabet and padding without decoding, so large blobs stay cheap.
 */
export function base64DecodedLength(s: string): number {
  if (s.length % 4 !== 0 || !BASE64_RE.test(s)) return -1;
  let pad = 0;
  if (s.endsWith("==")) pad = 2;
  else if (s.endsWith("=")) pad = 1;
  return (s.length / 4) * 3 - pad;
}

// ---------------------------------------------------------------------------
// Crypto (WebCrypto only; no password hashing on the server)

let cachedPepper: string | null = null;
let cachedKey: Promise<CryptoKey> | null = null;

function pepperKey(pepper: string): Promise<CryptoKey> {
  if (cachedKey && cachedPepper === pepper) return cachedKey;
  cachedPepper = pepper;
  cachedKey = crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return cachedKey;
}

export async function hmac(pepper: string, data: Uint8Array | string): Promise<Uint8Array> {
  const key = await pepperKey(pepper);
  const input = typeof data === "string" ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
}

export async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

/** Constant-time string comparison (both sides are fixed-length hex in practice). */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

export function newDeviceToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// ---------------------------------------------------------------------------
// Validation

export const LIMITS = {
  bodyBytes: 512 * 1024,
  setupBlobBytes: 256 * 1024,
  wrappedKeyMinBytes: 16,
  wrappedKeyMaxBytes: 1024,
  emailChars: 254,
} as const;

export const DEFAULT_KDF = { alg: "argon2id", m_kib: 65536, t: 3, p: 1 } as const;

export interface Kdf {
  alg: "argon2id";
  m_kib: number;
  t: number;
  p: number;
  salt: string;
}

export interface DeviceInput {
  id: string;
  name: string;
  platform: string;
  client_version: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PLATFORM_RE = /^[a-z0-9_-]{1,32}$/;

function bad(message: string): never {
  throw new ApiError("invalid_request", message);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function charCount(s: string): number {
  return [...s].length;
}

export function parseEmail(v: unknown): string {
  if (typeof v !== "string") bad("email is required");
  const email = v.trim().toLowerCase();
  if (email.length === 0 || email.length > LIMITS.emailChars || !EMAIL_RE.test(email)) {
    bad("email is not a valid address");
  }
  return email;
}

export function parseAccountId(v: unknown): string {
  if (typeof v !== "string" || !ACCOUNT_ID_RE.test(v)) bad("account_id must be 1 to 128 characters of A-Z, a-z, 0-9, _ or -");
  return v;
}

export function parseKdf(v: unknown): Kdf {
  if (!isObject(v)) bad("kdf is required");
  if (v.alg !== "argon2id") bad("kdf.alg must be argon2id");
  if (!isInt(v.m_kib, 19456, 1048576)) bad("kdf.m_kib must be an integer from 19456 to 1048576");
  if (!isInt(v.t, 2, 10)) bad("kdf.t must be an integer from 2 to 10");
  if (!isInt(v.p, 1, 4)) bad("kdf.p must be an integer from 1 to 4");
  if (typeof v.salt !== "string" || base64DecodedLength(v.salt) !== 16) bad("kdf.salt must be 16 bytes of base64");
  return { alg: "argon2id", m_kib: v.m_kib, t: v.t, p: v.p, salt: v.salt };
}

/** Returns the decoded 32-byte auth key. */
export function parseAuthKey(v: unknown): Uint8Array {
  if (typeof v !== "string" || base64DecodedLength(v) !== 32) bad("auth_key must be 32 bytes of base64");
  return base64ToBytes(v);
}

export function parseWrappedKey(v: unknown): string {
  const n = typeof v === "string" ? base64DecodedLength(v) : -1;
  if (typeof v !== "string" || n < LIMITS.wrappedKeyMinBytes || n > LIMITS.wrappedKeyMaxBytes) {
    bad(`wrapped_account_key must be ${LIMITS.wrappedKeyMinBytes} to ${LIMITS.wrappedKeyMaxBytes} bytes of base64`);
  }
  return v;
}

export function parseSetupBlob(v: unknown, nullable: boolean): string | null {
  if (v === null || v === undefined) {
    if (nullable) return null;
    bad("setup_blob is required");
  }
  if (typeof v !== "string") bad("setup_blob must be base64");
  const n = base64DecodedLength(v);
  if (n < 0) bad("setup_blob must be base64");
  if (n === 0) bad("setup_blob must not be empty");
  if (n > LIMITS.setupBlobBytes) throw new ApiError("too_large", "setup_blob is larger than 256 KiB");
  return v;
}

export function parseDevice(v: unknown): DeviceInput {
  if (!isObject(v)) bad("device is required");
  if (!isUuid(v.id)) bad("device.id must be a uuid");
  if (typeof v.name !== "string" || v.name.trim().length === 0 || charCount(v.name) > 128) {
    bad("device.name must be 1 to 128 characters");
  }
  if (typeof v.platform !== "string" || !PLATFORM_RE.test(v.platform)) bad("device.platform is invalid");
  if (typeof v.client_version !== "string" || v.client_version.length < 1 || charCount(v.client_version) > 64) {
    bad("device.client_version must be 1 to 64 characters");
  }
  return { id: v.id.toLowerCase(), name: v.name, platform: v.platform, client_version: v.client_version };
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}
