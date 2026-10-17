-- RenegadeBox account service schema (D1 / SQLite).
-- D1 enforces foreign keys, so deleting an account cascades to its devices.
-- Timestamps are Unix epoch milliseconds.

CREATE TABLE accounts (
  id                  TEXT PRIMARY KEY,          -- client-generated account id
  email               TEXT NOT NULL UNIQUE,      -- trimmed, lowercased
  auth_hash           TEXT NOT NULL,             -- hex(HMAC-SHA256(PEPPER, auth_key))
  kdf_alg             TEXT NOT NULL,
  kdf_m_kib           INTEGER NOT NULL,
  kdf_t               INTEGER NOT NULL,
  kdf_p               INTEGER NOT NULL,
  kdf_salt            TEXT NOT NULL,             -- base64, 16 bytes
  wrapped_account_key TEXT NOT NULL,             -- base64 ciphertext
  setup_blob          TEXT,                      -- base64 ciphertext, NULL when none saved
  setup_version       INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE devices (
  id             TEXT PRIMARY KEY,               -- engine config.device_id (lowercase uuid)
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  platform       TEXT NOT NULL,
  client_version TEXT NOT NULL,
  token_hash     TEXT UNIQUE,                    -- hex(SHA-256(token)), NULL once signed out
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  revoked_at     INTEGER                         -- set when signed out
);

CREATE INDEX devices_account_idx ON devices (account_id, revoked_at);

-- One row per counted attempt: failed logins (by email and by IP) and sign-ups (by IP).
-- subject is hex(HMAC-SHA256(PEPPER, kind|value)) so raw emails and IPs are not kept here.
CREATE TABLE auth_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                      -- 'login_email' | 'login_ip' | 'signup_ip'
  subject    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX auth_attempts_lookup_idx ON auth_attempts (kind, subject, created_at);
CREATE INDEX auth_attempts_created_idx ON auth_attempts (created_at);
