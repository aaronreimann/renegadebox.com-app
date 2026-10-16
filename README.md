# RenegadeBox

RenegadeBox is a Dropbox-style synced folder that stores everything in **your own** S3 bucket (AWS S3, Cloudflare R2, Backblaze B2, or any S3-compatible store). It's end-to-end encrypted: the bucket only ever sees ciphertext, including file names, and the server never sees your files or your keys.

How it works and why: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Living spec and test checklist: [ISA.md](ISA.md).

## Layout

| Dir | What | Status |
|---|---|---|
| `engine/` | Rust sync engine + `rbox` CLI | Phase 1 ✅ |
| `protocol/` | WebSocket + journal JSON Schemas, TS types, shared fixtures | ✅ |
| `hub/` | WebSocket relay (Bun + Postgres `LISTEN/NOTIFY`) | Phase 2 |
| `dashboard/` | Astro SSR: accounts, devices, tokens | Phase 2 |
| `scripts/` | `e2e.ts` multi-device test | ✅ |

## Quickstart (local)

Requires Rust (`brew install rustup && rustup default stable`), Bun and Docker.

```bash
docker compose up -d s3
echo "s3.bucket.create -name my-box" | docker compose exec -T s3 weed shell

cd engine && cargo build --release
export PATH="$PWD/target/release:$PATH"

# Device 1 (creates the encrypted vault; you choose the passphrase)
rbox init --folder ~/RenegadeBox --bucket my-box --endpoint http://localhost:8333 \
          --access-key-id dev --device-name Laptop
rbox watch

# Device 2 (another profile on the same machine, for trying it out)
RBOX_HOME=~/.renegadebox-2 rbox init --folder ~/RenegadeBox-2 --bucket my-box \
          --endpoint http://localhost:8333 --access-key-id dev --device-name Desktop
RBOX_HOME=~/.renegadebox-2 rbox watch
```

On real AWS, omit `--endpoint` and pass `--region`. For R2 or B2, pass their S3 endpoint. Create an IAM user whose policy allows only `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` on your one bucket.

## Commands

| Command | |
|---|---|
| `rbox init` | Connect this device to a bucket. Creates the vault on first use, otherwise unlocks it. |
| `rbox sync` | Run one sync cycle (scan → pull → push). |
| `rbox watch` | Keep syncing: react to local changes, poll for remote ones. |
| `rbox status` | Show configuration and pending changes. |

Secrets are stored in the OS keychain. `--insecure-file-keystore` keeps them in a 0600 file instead, for headless boxes and tests.

## Tests

```bash
cd engine && cargo test && RBOX_TEST_S3=1 cargo test --test s3
bun scripts/e2e.ts
cd protocol && bun test
```
