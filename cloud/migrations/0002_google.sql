-- Sign in with Google. Google accounts have no password, so the account key that unlocks
-- their saved setup is kept here, encrypted under the SETUP_KEK Worker secret.

ALTER TABLE accounts ADD COLUMN google_sub TEXT;          -- Google's stable user id
ALTER TABLE accounts ADD COLUMN server_wrapped_key TEXT;  -- base64(iv | AES-GCM(SETUP_KEK, account key))
CREATE UNIQUE INDEX accounts_google_sub_idx ON accounts (google_sub) WHERE google_sub IS NOT NULL;

-- A sign-in in progress: the app polls with poll_secret while the browser goes to Google.
CREATE TABLE google_sessions (
  id           TEXT PRIMARY KEY,
  poll_hash    TEXT NOT NULL,   -- hex(SHA-256(poll secret))
  state_hash   TEXT NOT NULL,   -- hex(SHA-256(OAuth state))
  device       TEXT NOT NULL,   -- JSON device the app is signing in
  google_sub   TEXT,
  email        TEXT,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX google_sessions_created_idx ON google_sessions (created_at);
