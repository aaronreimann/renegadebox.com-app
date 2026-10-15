# @renegadebox/protocol

Wire and storage contracts for RenegadeBox: JSON Schemas (draft 2020-12), mirroring TypeScript types, Ajv validators, and shared fixtures.

## Schemas

- `schemas/journal-entry.schema.json` — the **plaintext** per-device journal entry (`added | modified | deleted | renamed`). It exists only on the client and is encrypted (sealed) before upload.
- `schemas/ws-message.schema.json` — the WebSocket envelope `{ "type", "payload" }` the hub relays: `auth_init`, `auth_ok`, `auth_error`, `journal_appended`, `sync_required`, `ping`, `pong`.

Both schemas set `additionalProperties: false` at every object level, and the path regex is lookaround-free so the Rust `regex` crate can reuse it.

## Privacy rule

The hub sees only opaque data: device ids, seq numbers, object keys and sealed ciphertext. It never sees paths, file names or hashes. `base_hash` and every other piece of file metadata lives inside the encrypted journal entry. The only human-readable name on the wire is `auth_init.device_name`.

## Object keys

`rb/journal/<device_id>/<seq zero-padded to 20 digits>`, e.g. `rb/journal/3f2b8c1e-9d4a-4e7b-a1c6-5f8e2d9b0a73/00000000000000000042`. Build them with `journalObjectKey(deviceId, seq)`; check them with `JOURNAL_OBJECT_KEY_PATTERN`.

## Fixtures

- `fixtures/valid/` — one per journal action (`journal-entry.<action>.json`) and one per ws type (`ws.<type>.json`).
- `fixtures/invalid/` — `journal-entry.<what-is-wrong>.json` / `ws.<what-is-wrong>.json`.

The filename prefix selects the schema. The Rust test suite globs these directories, so keep the naming convention.

## Usage

```ts
import { validateWsMessage, wsMessageErrors, journalObjectKey } from "@renegadebox/protocol";

if (!validateWsMessage(msg)) console.error(wsMessageErrors());
```

## Development

```sh
bun install
bun test
bunx tsc --noEmit
```
