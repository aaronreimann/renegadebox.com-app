// Client-side checks and labels for the RenegadeBox account screens. The server and the engine
// check everything again; these exist so people get a plain answer before waiting on the network.

import { relativeTime } from "./format";
import type { AccountDevice } from "./types";

/** Matches the engine's minimum (docs/ACCOUNTS.md). */
export const MIN_ACCOUNT_PASSWORD = 12;

const length = (s: string) => [...s].length;

function emailProblem(email: string): string | null {
  const e = email.trim();
  if (!e) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Enter a valid email address.";
  return null;
}

/** Sign in only needs both fields: a short password just won't match. */
export function validateSignIn(email: string, password: string): string | null {
  return emailProblem(email) ?? (password ? null : "Enter your password.");
}

/** A new password and its confirmation, for creating an account or changing the password. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (!password) return "Enter a password.";
  if (length(password) < MIN_ACCOUNT_PASSWORD) return `Your password needs at least ${MIN_ACCOUNT_PASSWORD} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

export function validateCreateAccount(email: string, password: string, confirm: string): string | null {
  return emailProblem(email) ?? validateNewPassword(password, confirm);
}

/** "This Mac" for this one, otherwise "Last seen 3 hours ago" in plain words. */
export function deviceMeta(d: AccountDevice, now: number = Date.now()): string {
  if (d.current) return "This Mac";
  const seen = d.last_seen_at ? Date.parse(d.last_seen_at) : NaN;
  if (!Number.isFinite(seen)) return "Not seen yet";
  const rel = relativeTime(seen, now);
  if (rel === "Just now" || rel === "Yesterday") return `Last seen ${rel.toLowerCase()}`;
  if (/^[A-Z][a-z]{2} \d/.test(rel)) return `Last seen on ${rel}`;
  return `Last seen ${rel}`;
}

/** Signed-in Macs with this one first, then the most recently seen. */
export function sortDevices(devices: AccountDevice[]): AccountDevice[] {
  const seen = (d: AccountDevice) => (d.last_seen_at ? Date.parse(d.last_seen_at) || 0 : 0);
  return [...devices].sort((a, b) => Number(b.current) - Number(a.current) || seen(b) - seen(a));
}
