# RenegadeBox accounts

Sign in on any Mac and it is set up: storage, encryption key, folder, routing rules and AI
settings arrive from your account. There is no second password to type.

The account service runs on Cloudflare (`cloud/`): one Worker for the API, D1 for accounts and
devices, and one Durable Object per account for the instant-sync relay.

There are two kinds of account. **Google accounts** (the default in the app) sign in with Google
and nothing else. **Password accounts** use an email and a RenegadeBox password. They differ in
who can unlock the saved setup.

## Google sign-in

Google tells the server who you are, but gives the app no secret to unlock anything with. So for
Google accounts the server keeps the account key itself, encrypted under the `SETUP_KEK` Worker
secret (AES-256-GCM, bound to the account id). A stolen copy of the database alone opens nothing.
**Whoever controls the Worker, though, or your Google account, can reach your setup**, and with
it your storage keys and file key. This is the trade for signing in with Google alone.

Flow:

1. The app calls `POST /auth/google/start {device}` and gets `{session_id, poll_secret, url}`.
2. It opens `url` (Google's consent page) in the browser and polls `POST /auth/google/poll
   {session_id, poll_secret}`. The poll returns 202 `{status: "pending"}` meanwhile.
3. Google redirects the browser to `/api/v1/auth/google/callback`. The Worker checks the state,
   exchanges the code with Google (server-side, with the client secret), and requires a verified
   email.
4. The next poll returns, once, `{status: "ok", account_id, email, device_token, account_key,
   setup_blob, setup_version, is_new}`. Sessions last 10 minutes and are single use.

The first sign-in creates the account with a random account key. On a Mac that is already set
up, the app then saves its setup to the account. A new Mac signing in to an account with no saved
setup is told to sign in on its set-up Mac first. An email that already has a password account
is not linked to a Google identity (`email_taken`). Google accounts cannot use `/login` or
`/password`, and `DELETE /account` takes `{"confirm": "delete"}` instead of an auth key.

Worker settings: `GOOGLE_CLIENT_ID` and `PUBLIC_URL` in `[vars]`, `GOOGLE_CLIENT_SECRET` and
`SETUP_KEK` as secrets. Google sign-in answers `not_configured` (503) until all are set. The OAuth
client is a Google "Web application" client whose redirect URI is
`https://app.renegadebox.com/api/v1/auth/google/callback`. `GOOGLE_FAKE=1` lets tests send
`fake:<sub>:<email>` codes, but only when `PUBLIC_URL` is localhost.

## Privacy model (password accounts)

The account password is the only secret, and the server never sees it. The app stretches the
password on the Mac and splits the result into two keys:

- an **auth key**, sent to the server to prove you know the password. The server stores only an
  HMAC of it under a server-side pepper.
- a **wrap key**, which never leaves the Mac. It unlocks the account key, which unlocks your
  setup.

The server stores your setup only as ciphertext it cannot open. Whoever controls the server, or
steals its database, gets nothing usable: no S3 keys, no file encryption key.

Consequences:

- Forgetting the password means the saved setup is gone. Your files are not: any Mac that is
  still signed in can set a new password without the old one, and the vault passphrase plus
  S3 keys still work for a manual setup.

## Client crypto (engine/src/account.rs)

```
stretched   = Argon2id(NFC(password), salt, m_kib, t, p)        32 bytes  (HKDF below uses no salt)
auth_key    = HKDF-SHA256(stretched, info="renegadebox account auth v1")   32 bytes
wrap_key    = HKDF-SHA256(stretched, info="renegadebox account wrap v1")   32 bytes
account_key = 32 random bytes, made once at sign-up

wrapped_account_key = "RBK1" | nonce(12) | AES-256-GCM(wrap_key, account_key,
                                             aad = "renegadebox account key v1|" + account_id)
setup_blob          = "RBS1" | nonce(12) | AES-256-GCM(account_key, setup JSON,
                                             aad = "renegadebox setup v1|" + account_id)
```

Defaults: `m_kib = 65536`, `t = 3`, `p = 1`, 16-byte random salt. A password change makes a new
salt and re-wraps the same account key, so the setup blob and other signed-in Macs are unaffected.
Passwords need at least 12 characters.

### Setup JSON (v1)

```json
{
  "v": 1,
  "storage": { "bucket": "", "region": "", "endpoint": null, "access_key_id": "", "secret_access_key": "" },
  "vault": { "master_key": "<base64>", "vault_pin": "<hex>" },
  "folder": "~/RenegadeBox",
  "ai": { "...": "AiRouterConfig as stored in config.toml" },
  "secrets": { "openrouter-api-key": "", "grok-api-key": "" },
  "updated_by": "device name",
  "updated_at": "RFC 3339"
}
```

Device-specific values (device id, device name, key store choice) are never in the bundle.

## HTTP API

Base URL `{server}/api/v1`, default server `https://app.renegadebox.com`. Requests and responses
are JSON. Binary values are standard base64 with padding. Device tokens are 32 random bytes,
base64url without padding, and are sent as `Authorization: Bearer <token>`.

Errors: `{"error": {"code": "...", "message": "..."}}` with a matching HTTP status. Codes:
`invalid_request` 400, `unauthorized` 401, `invalid_credentials` 401, `not_found` 404,
`email_taken` 409, `device_conflict` 409, `version_conflict` 409, `too_large` 413,
`rate_limited` 429 (with `Retry-After` seconds), `internal` 500.

`kdf` objects are `{"alg": "argon2id", "m_kib": n, "t": n, "p": n, "salt": "<base64 16 bytes>"}`.
The server accepts `m_kib` 19456..1048576, `t` 2..10, `p` 1..4.

`device` objects sent by clients are `{"id": uuid, "name": 1..128 chars, "platform": "macos",
"client_version": "0.1.0"}`. The device id is the engine's `config.device_id`.

| Method and path | Auth | Body | Success |
|---|---|---|---|
| `POST /prelogin` | none | `{email}` | 200 `{kdf}`. An unknown email gets a stable fake salt, so this does not reveal who has an account. |
| `POST /signup` | none | `{email, account_id, kdf, auth_key, wrapped_account_key, setup_blob \| null, device}` | 201 `{account_id, device_token, setup_version}` (version 1 with a blob, else 0) |
| `POST /login` | none | `{email, auth_key, device}` | 200 `{account_id, device_token, kdf, wrapped_account_key, setup_blob, setup_version}` |
| `GET /account` | token | | 200 `{account_id, email, created_at, device_id, setup_version}` |
| `GET /setup` | token | | 200 `{setup_blob, setup_version}` |
| `PUT /setup` | token | `{setup_blob, base_version}` | 200 `{setup_version}`. 409 `version_conflict` with `setup_version` when someone saved first. |
| `GET /devices` | token | | 200 `{devices: [{id, name, platform, client_version, last_seen_at, created_at, current}]}`, signed-in devices only |
| `DELETE /devices/{id}` | token | | 204. Signs that device out and drops its relay connection. |
| `POST /logout` | token | | 204. Signs this device out. |
| `POST /password` | token | `{kdf, auth_key, wrapped_account_key}` | 204. Any signed-in device may set a new password. |
| `DELETE /account` | token | `{auth_key}` | 204. Deletes the account, devices and saved setup. |
| `GET /hub` | token | WebSocket upgrade | Relay, below |
| `GET /health` | none | | 200 `ok` |

Logging in with a device id the account already has replaces that device's token and signs it
back in. A device id that belongs to another account is `device_conflict`.

Limits: `setup_blob` up to 256 KiB decoded, request bodies up to 512 KiB, email up to 254
characters. Rate limits: 10 failed logins per email and 50 per IP address per 15 minutes; 10
sign-ups per IP address per hour.

Stored values: `auth_hash = hex(HMAC-SHA256(PEPPER, auth_key))`, compared in constant time;
`token_hash = hex(SHA-256(token))`. `PEPPER` is a Worker secret.

## Relay

`GET /api/v1/hub` with the device token in `Authorization`. The Worker checks the token and hands
the socket to the account's Durable Object. The messages are the ones in
`protocol/schemas/ws-message.schema.json`: the client sends `auth_init` (the Durable Object checks
its token matches the one the Worker verified) and gets `auth_ok`. A `journal_appended` from one
device becomes `sync_required` on the account's other devices. `ping` gets `pong`. Signing a
device out closes its socket with `auth_error` code `revoked`, and the client stops reconnecting.

The relay sees only sequence numbers, object keys and sealed entries, never paths or contents.

## Cloud

The service lives in `cloud/` (TypeScript, Workers free plan). Use bun only.

- `cd cloud && bun install`
- `bun run dev` applies the D1 migrations locally and starts `wrangler dev --local` on
  port 8787. It reads `PEPPER` from `cloud/.dev.vars` (gitignored), for example
  `PEPPER="dev-only-pepper"`.
- `bun run typecheck` and `bun test`. The tests start their own `wrangler dev --local` on a free
  port with a temporary D1 store, so they need no Cloudflare account.
- `bun run deploy` (after `bunx wrangler login`) runs `cloud/scripts/deploy.ts`: it creates the
  `renegadebox` D1 database if missing and writes its id into `wrangler.toml`, applies the
  migrations remotely, generates `PEPPER` only if the Worker does not have one yet, and deploys
  with the `app.renegadebox.com` custom domain. Never rotate `PEPPER`: every stored auth hash
  depends on it.

Behaviour the table above leaves open, as implemented:

- Emails are trimmed and lowercased before storage, lookup and the fake-salt HMAC.
- Timestamps (`created_at`, `last_seen_at`) are RFC 3339 strings in UTC.
- A `version_conflict` body carries `setup_version` both at the top level and inside `error`.
- A device signed out of one account (logout or revoked) may sign in to another; only a device
  that is still signed in elsewhere is `device_conflict`.
- On the relay, `auth_init.device_id` must equal the device the bearer token belongs to.
  `sealed_entry: null` is treated as absent. Sockets that do not finish `auth_init` within 10
  seconds get `auth_error` `invalid_token` and close code 4001; revoked sockets close with 4002.
