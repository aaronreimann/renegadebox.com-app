import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import journalSchema from "../schemas/journal-entry.schema.json" with { type: "json" };
import wsSchema from "../schemas/ws-message.schema.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Journal entry (plaintext, client-only; sealed before upload)
// ---------------------------------------------------------------------------

export type JournalAction = "added" | "modified" | "deleted" | "renamed";

interface JournalEntryBase {
  v: 1;
  device_id: string;
  device_name: string;
  seq: number;
  lamport: number;
  path: string;
}

interface JournalEntryContent {
  hash: string;
  size: number;
  mtime_ms: number;
  blob_id: string;
}

export interface JournalEntryAdded extends JournalEntryBase, JournalEntryContent {
  action: "added";
  old_path: null;
  base_hash: null;
}

export interface JournalEntryModified extends JournalEntryBase, JournalEntryContent {
  action: "modified";
  old_path: null;
  base_hash: string | null;
}

export interface JournalEntryRenamed extends JournalEntryBase, JournalEntryContent {
  action: "renamed";
  old_path: string;
  base_hash: string | null;
}

export interface JournalEntryDeleted extends JournalEntryBase {
  action: "deleted";
  old_path: null;
  hash: null;
  base_hash: string | null;
  size: null;
  mtime_ms: null;
  blob_id: null;
}

export type JournalEntry =
  | JournalEntryAdded
  | JournalEntryModified
  | JournalEntryRenamed
  | JournalEntryDeleted;

// ---------------------------------------------------------------------------
// WebSocket envelope (what the hub relays; never paths, names or hashes)
// ---------------------------------------------------------------------------

export type AuthErrorCode = "invalid_token" | "revoked" | "rate_limited" | "unsupported_version";

export interface AuthInitMessage {
  type: "auth_init";
  payload: {
    device_token: string;
    device_id: string;
    device_name: string;
    client_version: string;
  };
}

export interface AuthOkMessage {
  type: "auth_ok";
  payload: {
    device_id: string;
    account_id: string;
    server_time: number;
  };
}

export interface AuthErrorMessage {
  type: "auth_error";
  payload: {
    code: AuthErrorCode;
    message: string;
  };
}

export interface JournalAppendedMessage {
  type: "journal_appended";
  payload: {
    seq: number;
    object_key: string;
    sealed_entry?: string;
  };
}

export interface SyncRequiredMessage {
  type: "sync_required";
  payload: {
    origin_device_id: string;
    seq: number;
    object_key: string;
    sealed_entry?: string;
  };
}

export interface PingMessage {
  type: "ping";
  payload: { nonce?: string };
}

export interface PongMessage {
  type: "pong";
  payload: { nonce?: string };
}

export type WsMessage =
  | AuthInitMessage
  | AuthOkMessage
  | AuthErrorMessage
  | JournalAppendedMessage
  | SyncRequiredMessage
  | PingMessage
  | PongMessage;

export type WsMessageType = WsMessage["type"];

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const journalValidator: ValidateFunction<JournalEntry> = ajv.compile<JournalEntry>(journalSchema);
const wsValidator: ValidateFunction<WsMessage> = ajv.compile<WsMessage>(wsSchema);

export function validateJournalEntry(x: unknown): x is JournalEntry {
  return journalValidator(x);
}

export function validateWsMessage(x: unknown): x is WsMessage {
  return wsValidator(x);
}

/** Errors from the most recent `validateJournalEntry` call (null if it passed). */
export function journalEntryErrors(): ErrorObject[] | null {
  return journalValidator.errors ?? null;
}

/** Errors from the most recent `validateWsMessage` call (null if it passed). */
export function wsMessageErrors(): ErrorObject[] | null {
  return wsValidator.errors ?? null;
}

// ---------------------------------------------------------------------------
// Object keys
// ---------------------------------------------------------------------------

export const JOURNAL_OBJECT_KEY_PATTERN = /^rb\/journal\/[0-9a-f-]{36}\/[0-9]{20}$/;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Builds `rb/journal/<deviceId>/<seq zero-padded to 20 digits>`. */
export function journalObjectKey(deviceId: string, seq: number): string {
  if (typeof deviceId !== "string" || !CANONICAL_UUID.test(deviceId)) {
    throw new TypeError(
      `journalObjectKey: deviceId must be a lowercase canonical uuid (8-4-4-4-12 hex), got ${JSON.stringify(deviceId)}`,
    );
  }
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new RangeError(`journalObjectKey: seq must be a safe integer >= 1, got ${String(seq)}`);
  }
  return `rb/journal/${deviceId}/${String(seq).padStart(20, "0")}`;
}
