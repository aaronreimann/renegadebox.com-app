import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "./db.js";
import type { AstroCookies } from "astro";

const scryptAsync = promisify(scrypt);

export interface Account {
  id: string;
  email: string;
  created_at: Date;
}

const SESSION_COOKIE = "rb_session";
const SESSION_DURATION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  // If running in Bun with native password hashing
  if (typeof Bun !== "undefined" && typeof Bun.password?.hash === "function") {
    return await Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 3,
    });
  }

  // Robust fallback for Node.js using standard scrypt (memory-hard KDF)
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `$scrypt$N=16384,r=8,p=1$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith("$argon2id$")) {
    if (typeof Bun !== "undefined" && typeof Bun.password?.verify === "function") {
      return await Bun.password.verify(password, hash);
    }
    return false;
  }

  if (hash.startsWith("$scrypt$")) {
    const parts = hash.split("$");
    // format: ["", "scrypt", "N=16384,r=8,p=1", salt, hashHex]
    const salt = parts[3];
    const originalHashHex = parts[4];
    if (!salt || !originalHashHex) return false;

    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const computedBuf = Buffer.from(derivedKey.toString("hex"), "hex");
    const originalBuf = Buffer.from(originalHashHex, "hex");

    if (computedBuf.length !== originalBuf.length) return false;
    return timingSafeEqual(computedBuf, originalBuf);
  }

  return false;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(accountId: string, cookies: AstroCookies): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO sessions (id, account_id, expires_at)
    VALUES (${tokenHash}, ${accountId}, ${expiresAt})
  `;

  cookies.set(SESSION_COOKIE, rawToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
  });

  return rawToken;
}

export async function getSessionAccount(cookies: AstroCookies): Promise<Account | null> {
  const rawToken = cookies.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);

  const [row] = await sql`
    SELECT a.id, a.email, a.created_at
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.id = ${tokenHash} AND s.expires_at > NOW()
  `;

  if (!row) {
    cookies.delete(SESSION_COOKIE, { path: "/" });
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    created_at: row.created_at,
  };
}

export async function destroySession(cookies: AstroCookies): Promise<void> {
  const rawToken = cookies.get(SESSION_COOKIE)?.value;
  if (rawToken) {
    const tokenHash = hashSessionToken(rawToken);
    await sql`DELETE FROM sessions WHERE id = ${tokenHash}`;
  }
  cookies.delete(SESSION_COOKIE, { path: "/" });
}
