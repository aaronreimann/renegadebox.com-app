# RenegadeBox

RenegadeBox is a Dropbox-style synced folder that stores everything in **your own** S3 bucket (AWS S3, Cloudflare R2, Backblaze B2, or any S3-compatible store). It's end-to-end encrypted: the bucket only ever sees ciphertext, including file names, and the server never sees your files or your keys.

How it works and why: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Living spec and test checklist: [ISA.md](ISA.md).

## Layout

| Dir | What | Status |
|---|---|---|
| `engine/` | Rust sync engine + `rbox` CLI with Hub WebSocket client | Phase 1 & Phase 3 ✅ |
| `protocol/` | WebSocket + journal JSON Schemas, TS types, shared fixtures | Phase 1 ✅ |
| `hub/` | WebSocket relay (Bun + Postgres `LISTEN/NOTIFY`) | Phase 2 ✅ |
| `dashboard/` | Astro SSR: accounts, devices, tokens | Phase 2 ✅ |
| `scripts/` | `e2e.ts` (S3 engine) & `e2e-hub.ts` (real-time push) | ✅ |

## Quickstart (local)

Requires Rust (`brew install rustup && rustup default stable`, then put `$(brew --prefix rustup)/bin` on your PATH), Bun and Docker.

```bash
docker compose up -d s3 postgres
echo "s3.bucket.create -name my-box" | docker compose exec -T s3 weed shell

cargo install --path engine --root ~/.local   # installs rbox to ~/.local/bin (must be on your PATH)

# Start Hub & Dashboard (Control Plane)
(cd hub && bun run src/index.ts) &           # ws://localhost:8787
(cd dashboard && bun run dev) &              # http://localhost:3000 (register account & device)

# Device 1 (creates the encrypted vault; you choose the passphrase)
rbox init --folder ~/RenegadeBox --bucket my-box --endpoint http://localhost:8333 \
          --access-key-id dev --device-name Laptop \
          --hub-url ws://localhost:8787/ws --device-token <YOUR_DEVICE_TOKEN>
rbox watch

# Device 2 (another profile on the same machine, for trying out real-time sync)
RBOX_HOME=~/.renegadebox-2 rbox init --folder ~/RenegadeBox-2 --bucket my-box \
          --endpoint http://localhost:8333 --access-key-id dev --device-name Desktop \
          --hub-url ws://localhost:8787/ws --device-token <DEVICE_2_TOKEN>
RBOX_HOME=~/.renegadebox-2 rbox watch
```

On real AWS, omit `--endpoint` and pass `--region`. For R2 or B2, pass their S3 endpoint. Create an IAM user whose policy allows only `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` on your one bucket.

## Commands

| Command | |
|---|---|
| `rbox init` | Connect this device to a bucket (with optional `--hub-url` and `--device-token`). Creates the vault on first use, otherwise unlocks it. |
| `rbox sync` | Run one sync cycle (scan → pull → push). |
| `rbox watch` | Keep syncing: react to local changes, receive real-time Hub pushes, and fallback poll. |
| `rbox status` | Show configuration and pending changes. |

Secrets (S3 secret key, master key, device token) are stored in the OS keychain. `--insecure-file-keystore` keeps them in a 0600 file instead, for headless boxes and tests.

## Tests

```bash
# 1. Engine tests & S3 integration
(cd engine && cargo test && RBOX_TEST_S3=1 cargo test --test s3 && cargo clippy --all-targets -- -D warnings)

# 2. Protocol JSON Schema & TypeScript tests
(cd protocol && bun test && bunx tsc --noEmit)

# 3. Hub WebSocket relay & Postgres tests
(cd hub && bun test && bunx tsc --noEmit)

# 4. Dashboard Astro SSR tests & build
(cd dashboard && bun test && bun run build)

# 5. Full multi-device E2E (S3 engine, 38 checks)
bun scripts/e2e.ts

# 6. Real-time push E2E (Engine + Hub + Postgres, < 1s latency, 0 leaks)
bun scripts/e2e-hub.ts
```

## License

MIT — see [LICENSE](LICENSE).
