// Test harness: runs the real Worker under `wrangler dev --local` with a throwaway D1 store.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLOUD_DIR = resolve(import.meta.dir, "..");
export const TEST_PEPPER = "test-pepper-0123456789abcdef";
export const TEST_SETUP_KEK = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

export interface Server {
  base: string;
  wsBase: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = listener.port;
  listener.stop(true);
  return port;
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd: CLOUD_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
  });
  const code = await proc.exited;
  if (code !== 0) {
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    throw new Error(`${cmd.join(" ")} failed (${code}):\n${out}`);
  }
}

export async function startServer(): Promise<Server> {
  const persist = mkdtempSync(join(tmpdir(), "rb-cloud-test-"));
  await run(["bunx", "wrangler", "d1", "migrations", "apply", "renegadebox", "--local", "--persist-to", persist]);

  const port = await freePort();
  const inspector = await freePort();
  const proc = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspector),
      "--persist-to",
      persist,
      "--var",
      `PEPPER:${TEST_PEPPER}`,
      "--var",
      `SETUP_KEK:${TEST_SETUP_KEK}`,
      "--var",
      "GOOGLE_CLIENT_ID:test-client.apps.googleusercontent.com",
      "--var",
      "GOOGLE_FAKE:1",
      "--var",
      `PUBLIC_URL:http://127.0.0.1:${port}`,
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: CLOUD_DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    },
  );

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    try {
      const res = await fetch(`${base}/api/v1/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
  if (!ready) {
    proc.kill();
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    throw new Error(`wrangler dev did not start:\n${out}`);
  }

  return {
    base,
    wsBase: `ws://127.0.0.1:${port}`,
    async stop() {
      proc.kill("SIGTERM");
      await Promise.race([proc.exited, Bun.sleep(5000)]);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      rmSync(persist, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers

export function randomBytesB64(n: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64");
}

/** Large random buffers (getRandomValues is capped at 64 KiB per call). */
export function bigRandomB64(n: number): string {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return Buffer.from(out).toString("base64");
}

export function randomIp(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

export function randomEmail(): string {
  return `user-${crypto.randomUUID().slice(0, 12)}@example.com`;
}

export function kdf(salt = randomBytesB64(16)) {
  return { alg: "argon2id", m_kib: 65536, t: 3, p: 1, salt };
}

export function device(id: string = crypto.randomUUID(), name = "Test Mac") {
  return { id, name, platform: "macos", client_version: "0.1.0" };
}

export interface ApiResult {
  status: number;
  headers: Headers;
  body: any;
}

export async function api(
  server: Server,
  method: string,
  path: string,
  opts: { body?: unknown; rawBody?: string; token?: string; ip?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined || opts.rawBody !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  headers["cf-connecting-ip"] = opts.ip ?? randomIp();
  const res = await fetch(`${server.base}/api/v1${path}`, {
    method,
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let body: any = text;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) body = JSON.parse(text);
  return { status: res.status, headers: res.headers, body };
}

export interface TestAccount {
  email: string;
  accountId: string;
  authKey: string;
  wrapped: string;
  kdf: ReturnType<typeof kdf>;
  deviceId: string;
  token: string;
}

export async function createAccount(server: Server, opts: { setupBlob?: string | null } = {}): Promise<TestAccount> {
  const acct = {
    email: randomEmail(),
    accountId: crypto.randomUUID(),
    authKey: randomBytesB64(32),
    wrapped: randomBytesB64(64),
    kdf: kdf(),
    deviceId: crypto.randomUUID(),
  };
  const res = await api(server, "POST", "/signup", {
    body: {
      email: acct.email,
      account_id: acct.accountId,
      kdf: acct.kdf,
      auth_key: acct.authKey,
      wrapped_account_key: acct.wrapped,
      setup_blob: opts.setupBlob === undefined ? null : opts.setupBlob,
      device: device(acct.deviceId),
    },
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...acct, token: res.body.device_token };
}

/** Signs another device in to an existing account. */
export async function loginDevice(server: Server, acct: TestAccount, deviceId = crypto.randomUUID()) {
  const res = await api(server, "POST", "/login", {
    body: { email: acct.email, auth_key: acct.authKey, device: device(deviceId, "Second Mac") },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { deviceId, token: res.body.device_token as string };
}

// ---------------------------------------------------------------------------
// WebSocket helper

export interface Socket {
  ws: WebSocket;
  opened: Promise<boolean>;
  closed: Promise<{ code: number; reason: string }>;
  send(msg: unknown): void;
  next(timeoutMs?: number): Promise<any>;
  /** Resolves true if no message arrives within `ms`. */
  quiet(ms: number): Promise<boolean>;
  close(): void;
}

export function connect(server: Server, token?: string): Socket {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const ws = new WebSocket(`${server.wsBase}/api/v1/hub`, { headers } as any);
  const queue: any[] = [];
  const waiters: Array<(m: any) => void> = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  const opened = new Promise<boolean>((res) => {
    ws.addEventListener("open", () => res(true));
    ws.addEventListener("error", () => res(false));
    ws.addEventListener("close", () => res(false));
  });
  const closed = new Promise<{ code: number; reason: string }>((res) => {
    ws.addEventListener("close", (ev) => res({ code: ev.code, reason: ev.reason }));
  });
  return {
    ws,
    opened,
    closed,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(timeoutMs = 3000) {
      const queued = queue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          rej(new Error("timed out waiting for a message"));
        }, timeoutMs);
        const waiter = (m: any) => {
          clearTimeout(timer);
          res(m);
        };
        waiters.push(waiter);
      });
    },
    async quiet(ms) {
      if (queue.length > 0) return false;
      try {
        await this.next(ms);
        return false;
      } catch {
        return true;
      }
    },
    close: () => ws.close(),
  };
}

export function authInit(token: string, deviceId: string) {
  return {
    type: "auth_init",
    payload: { device_token: token, device_id: deviceId, device_name: "Test Mac", client_version: "0.1.0" },
  };
}
