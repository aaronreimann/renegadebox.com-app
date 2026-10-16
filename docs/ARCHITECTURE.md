# RenegadeBox Architecture

RenegadeBox turns a bucket you own (AWS S3, Cloudflare R2, Backblaze B2, or any S3-compatible store) into a Dropbox-style synced folder. Every byte and every file name in the bucket is ciphertext. The control plane (`app.renegadebox.com`) only relays opaque "something changed" notifications between your devices.

This document supersedes the storage, payload, and security sections of the original plan (`renegadebox_architecture_development_plan.md`). The three-zone split (Rust client, control plane, marketing site) and the phase order are unchanged.

## What changed from the original plan

| # | Original plan | Now | Why |
|---|---|---|---|
| 1 | `file_event` carried `hash` but no ancestry | Every journal entry carries `base_hash`, the version the edit started from | Without it, a device can't tell a normal update from a conflicting one |
| 2 | Encryption "optional but recommended" | End-to-end encryption is mandatory for contents **and** paths | Adding it later would mean migrating every bucket. File names in object keys and WebSocket payloads were a leak. |
| 3 | Offline reconciliation by listing S3 objects and comparing ETags | Per-device, append-only, encrypted **journals** in the bucket | Multipart ETags aren't SHA-256. Listing every object doesn't scale. One shared manifest would need locking. |
| 4 | Not addressed | Echo suppression: downloads are recorded as synced before the watcher can re-observe them | Otherwise device B re-uploads every file it downloads |
| 5 | Hub broadcasts in-process | Hub is a separate service. Fan-out goes through Postgres `LISTEN/NOTIFY`. | When a user's devices are connected to different hub instances, an in-process broadcast misses some of them |

## Repository layout

```
protocol/   JSON Schemas + TS types for the WebSocket and journal contracts (Bun)
engine/     Rust sync engine and the `rbox` CLI (Phase 1, built)
hub/        WebSocket relay, Bun + TypeScript + Postgres (Phase 2)
dashboard/  Astro SSR app: accounts, devices, device tokens (Phase 2)
scripts/    e2e.ts: multi-device test against local S3
docs/       this file
```

## Keys

```
passphrase ──Argon2id(m=64 MiB, t=3)──▶ KEK ──AES-256-GCM unwrap──▶ master key (32 random bytes)
master ──HKDF-SHA256──┬─▶ content root ──HKDF("blob" ‖ sha256(plaintext))──▶ per-content blob key
                      ├─▶ names key  ──HMAC-SHA256(sha256(plaintext))──▶ blob id
                      └─▶ journal key ──AES-256-GCM──▶ sealed journal entries
```

- The first device generates the master key and writes `rb/vault.json` (the master key wrapped under the passphrase). Later devices download the vault and unlock it with the same passphrase.
- After unlocking, each device keeps the master key in the OS credential manager (macOS Keychain, Windows Credential Manager, Linux Secret Service). The S3 secret key goes there too. Neither ever reaches the control plane.
- The vault carries a `key_epoch` so the master key can be rotated later (needed for revoking a lost device). It also carries the KDF parameters, so they can be raised over time.
- Each device pins the SHA-256 of the vault it unlocked and warns if the bucket's vault ever changes.
- Primitives come only from RustCrypto (`aes-gcm`, `hkdf`, `hmac`, `sha2`, `argon2`). We compose them; we don't invent new ones.

### Blob format

`RBX1` header (16 bytes: magic, version, chunk size), followed by 4 MiB chunks. Each chunk is AES-256-GCM with:

- **nonce** = chunk index (u64, big-endian) ‖ `00 00 00` ‖ final-flag
- **AAD** = header ‖ blob id ‖ chunk index ‖ final-flag

Removing the last chunk, reordering chunks, splicing in a chunk from another blob, or flipping a single bit all fail authentication. Each of these has a unit test.

The blob key is derived from the plaintext hash, so a (key, nonce) pair can only ever encrypt identical bytes. To uphold that, the engine hashes the file, then encrypts it while hashing again. If the two hashes differ (the file changed mid-read), it throws away the output before anything is uploaded.

## Bucket layout

```
rb/vault.json                         wrapped master key (public KDF params, no secrets)
rb/blobs/<id[0..2]>/<id>              encrypted file contents, id = HMAC(names key, sha256)
rb/journal/<device-uuid>/<seq:020>    sealed journal entries, written with If-None-Match: *
```

- **Content-addressed blobs.** Identical content is stored once, and a rename uploads nothing. It's a single journal entry pointing at the same blob.
- **Per-device journals.** Each device only ever appends to its own prefix, so there is no write contention and nothing to lock. Every journal write uses `If-None-Match: *`. If a slot is already taken, the profile was cloned or restored from backup, and the engine stops instead of forking the journal.
- **Sealed entries.** Each entry is sealed with its own object key as AAD, so an entry can't be moved to another device or sequence number.

**Accepted leakage.** Someone who can read the bucket learns object sizes (roughly file sizes), how many files there are, when edits happen, which device made each change, and that two files share content (only within your own bucket). File names, folder structure and contents stay hidden.

## Journal entries

Schema: `protocol/schemas/journal-entry.schema.json`. The plaintext exists only on devices.

```json
{ "v": 1, "device_id": "…", "device_name": "Laptop", "seq": 42, "lamport": 1792108871833,
  "action": "modified", "path": "Documents/finances.pdf", "old_path": null,
  "hash": "<sha256>", "base_hash": "<sha256 of the version edited>",
  "size": 1234, "mtime_ms": 1792108870000, "blob_id": "<hmac>" }
```

`lamport = max(now_ms, highest lamport seen + 1)`. That keeps causally later edits ordered later, even when device clocks disagree.

## Sync cycle

`scan → pull → push`, in that order:

1. **Scan** walks the folder. A file whose size and mtime haven't changed isn't re-hashed. Changed files are hashed and recorded as `local_hash`. Symlinks, `.DS_Store`, Office lock files and the engine's own `.rbox-tmp-*` files are ignored.
2. **Pull** lists `rb/journal/<device>/` after each device's cursor. It only advances across contiguous sequence numbers: a gap means "not visible yet", so it waits. It then opens and validates each entry and applies the batch in `(lamport, device_id)` order.
3. **Push** publishes every path where `local_hash ≠ synced_hash`. The blob is uploaded and verified *before* the journal entry that references it. A delete paired with an add of identical content becomes a single `renamed` entry.

Phase 1 discovers remote changes by polling the journal (`rbox watch --poll-secs 15`). In Phase 3, the hub's `sync_required` message triggers the pull instead, and polling drops to a slow safety net.

## Conflict resolution

**Rule:** for each path, the entry with the highest `(lamport, device_id)` wins on every device, whatever order entries arrive in. Entries at or below a path's current head are skipped.

**Nothing is lost:** before a newer remote entry replaces a file, the receiving device checks whether that file holds content that exists only on this device:

- **Unsynced local edit:** `local_hash ≠ synced_hash`, or
- **Lost race:** this device authored the current version, and the incoming entry's `base_hash` isn't that version (the other device never saw our edit).

If either is true, the device renames its copy to `name (conflicted copy from <device> <date> <hash8>).ext` and then applies the remote entry. The copy is published like any new file. Its blob usually already exists, so publishing it uploads nothing. Only the device that owns the losing content creates the copy, so each conflict produces exactly one copy.

**Worked example.** Laptop and Desktop both edit `notes.md`, starting from version `h0`.

1. Laptop syncs first: `modified notes.md h0→hL`, lamport 100.
2. Desktop syncs: pull sees Laptop's entry (100 > Desktop's head). Desktop's edit hasn't been pushed yet (an unsynced local edit), so Desktop renames its file to `notes (conflicted copy from Desktop …).md`, installs `hL`, and then pushes the copy as a new file.
3. Laptop's next pull downloads the copy. Both devices now hold identical trees: `notes.md = hL` plus the conflicted copy holding Desktop's version.

If both devices push at the same instant (neither saw the other), they race. The lower-ordered device later sees an entry that is newer than its own head and whose `base_hash` isn't its version. It moves its version aside, then installs the winner. `scripts/e2e.ts` runs a three-device simultaneous race and checks that every version survives and exactly two copies exist per file.

**Delete vs. modify:** the newer entry wins. If the delete wins, the modified version is kept as a conflicted copy. If the modify wins, the file reappears.

**Clobber guard:** right before a downloaded file replaces the local one, the engine stats the file again. If the user edited it during the download, that edit is moved aside as a conflicted copy first.

**Known limitation:** if the device holding the losing version of a race is never seen again (say, a dead laptop), no copy is created. The version still exists in the bucket (as its blob and journal entry) and will be recoverable once version history ships.

## Echo suppression

When the engine installs a downloaded file, it records `synced_hash = local_hash = hash` and the new size and mtime in the same step. The watcher event that follows triggers a scan. That scan finds the size and mtime unchanged (or a hash equal to `synced_hash`), so nothing is published. The e2e suite checks that a full round-trip creates zero new journal entries and that `rbox watch` goes quiet afterwards.

## WebSocket protocol (Phase 2/3)

Schema: `protocol/schemas/ws-message.schema.json`. The hub sees only:

| Message | Direction | Payload |
|---|---|---|
| `auth_init` | client → hub | per-device token, device id, device name, client version |
| `auth_ok` / `auth_error` | hub → client | device id, account id / error code |
| `journal_appended` | client → hub | `seq`, `object_key`, optional `sealed_entry` (base64, ≤16 KiB) |
| `sync_required` | hub → other clients | `origin_device_id`, `seq`, `object_key`, optional `sealed_entry` |
| `ping` / `pong` | both | optional nonce |

There's no path, hash or `base_hash` anywhere. Those live inside `sealed_entry`, which only the user's devices can open. When `sealed_entry` is inlined, a receiver can apply the change without an extra S3 GET. The schema tests fail if a path-like field ever appears in a hub message.

## Control plane (Phase 2 design)

- **Postgres** tables: `accounts`, `devices` (id, account, name, token hash, last seen, revoked_at) and `sessions`. Device tokens are random 256-bit values, shown once and stored hashed.
- **Hub** (Bun + TypeScript): each instance `LISTEN`s on `account_events`. When a `journal_appended` message arrives, the instance runs `NOTIFY account_events, '{account_id, origin_device_id, seq, object_key, sealed_entry}'`, and every instance forwards it to that account's other sockets. Payloads over Postgres's 8 KB NOTIFY limit drop the `sealed_entry`, and receivers fetch it from S3 instead.
- **Dashboard** (Astro SSR): sign-up and login, the device list, issuing and revoking device tokens.
- **Revocation:** revoking a token disconnects the device from the hub. Cutting off its access to the *data* takes rotating the S3 credentials and the master key (`key_epoch`), which is a planned feature.

## Testing

```bash
docker compose up -d s3                 # SeaweedFS S3 gateway on :8333 (MinIO no longer ships images)
cd engine && cargo test                 # unit tests: crypto, paths, state, protocol fixtures
RBOX_TEST_S3=1 cargo test --test s3     # storage tests against local S3 (incl. If-None-Match)
cd .. && bun scripts/e2e.ts             # multi-device scenarios + bucket leak probe
cd protocol && bun test                 # schema/fixture tests
```
