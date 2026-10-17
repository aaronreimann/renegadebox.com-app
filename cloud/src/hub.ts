// AccountHub: one Durable Object per account, relaying journal notifications between that
// account's devices. Uses the WebSocket Hibernation API so idle sockets cost nothing.
//
// The Worker authenticates the upgrade request (bearer token against D1) and forwards it here
// with internal headers carrying the device id, account id and token hash it verified. The
// client must still send `auth_init` with the same token before anything is relayed.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import { isObject, isUuid, safeEqual, sha256Hex } from "./util";

export const INTERNAL_DEVICE_ID = "x-rb-device-id";
export const INTERNAL_ACCOUNT_ID = "x-rb-account-id";
export const INTERNAL_TOKEN_HASH = "x-rb-token-hash";

const AUTH_TIMEOUT_MS = 10_000;
const CLOSE_UNAUTHENTICATED = 4001;
const CLOSE_REVOKED = 4002;
const OBJECT_KEY_RE = /^rb\/journal\/[0-9a-f-]{36}\/[0-9]{20}$/;
const SEALED_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

interface Attachment {
  deviceId: string;
  accountId: string;
  tokenHash: string;
  authed: boolean;
  connectedAt: number;
}

type AuthErrorCode = "invalid_token" | "revoked" | "rate_limited" | "unsupported_version";

export class AccountHub extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 400 });
    }
    const deviceId = request.headers.get(INTERNAL_DEVICE_ID);
    const accountId = request.headers.get(INTERNAL_ACCOUNT_ID);
    const tokenHash = request.headers.get(INTERNAL_TOKEN_HASH);
    if (!deviceId || !accountId || !tokenHash) {
      return new Response("missing device context", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const now = Date.now();
    this.ctx.acceptWebSocket(server, [deviceId]);
    const att: Attachment = { deviceId, accountId, tokenHash, authed: false, connectedAt: now };
    server.serializeAttachment(att);

    const deadline = now + AUTH_TIMEOUT_MS;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > deadline) await this.ctx.storage.setAlarm(deadline);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;

    let msg: unknown;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      if (!att.authed) this.reject(ws, "invalid_token", "Malformed message", CLOSE_UNAUTHENTICATED);
      return;
    }
    if (!isObject(msg) || typeof msg.type !== "string" || !isObject(msg.payload)) {
      if (!att.authed) this.reject(ws, "invalid_token", "Malformed message", CLOSE_UNAUTHENTICATED);
      return;
    }
    const payload = msg.payload;

    switch (msg.type) {
      case "auth_init":
        await this.handleAuthInit(ws, att, payload);
        return;

      case "journal_appended": {
        if (!att.authed) {
          this.reject(ws, "invalid_token", "Not authenticated", CLOSE_UNAUTHENTICATED);
          return;
        }
        const seq = payload.seq;
        const objectKey = payload.object_key;
        const sealed = payload.sealed_entry;
        const sealedOk =
          sealed === undefined ||
          sealed === null ||
          (typeof sealed === "string" && sealed.length >= 4 && sealed.length <= 16384 && SEALED_RE.test(sealed));
        if (
          typeof seq !== "number" ||
          !Number.isSafeInteger(seq) ||
          seq < 1 ||
          typeof objectKey !== "string" ||
          !OBJECT_KEY_RE.test(objectKey) ||
          !sealedOk
        ) {
          return; // Ignore malformed notifications from an authenticated device.
        }
        const out = JSON.stringify({
          type: "sync_required",
          payload: {
            origin_device_id: att.deviceId,
            seq,
            object_key: objectKey,
            ...(typeof sealed === "string" ? { sealed_entry: sealed } : {}),
          },
        });
        for (const peer of this.ctx.getWebSockets()) {
          const p = peer.deserializeAttachment() as Attachment | null;
          if (!p || !p.authed || p.deviceId === att.deviceId) continue;
          try {
            peer.send(out);
          } catch {
            // Peer is closing; it will be cleaned up by the runtime.
          }
        }
        return;
      }

      case "ping": {
        const nonce = payload.nonce;
        const pong = typeof nonce === "string" && nonce.length <= 64 ? { nonce } : {};
        ws.send(JSON.stringify({ type: "pong", payload: pong }));
        return;
      }

      default:
        return; // pong and anything else: nothing to do.
    }
  }

  private async handleAuthInit(ws: WebSocket, att: Attachment, payload: Record<string, unknown>): Promise<void> {
    const token = payload.device_token;
    const deviceId = payload.device_id;
    if (typeof token !== "string" || token.length < 16 || token.length > 512 || !isUuid(deviceId)) {
      this.reject(ws, "invalid_token", "Malformed auth_init", CLOSE_UNAUTHENTICATED);
      return;
    }
    const hash = await sha256Hex(token);
    if (!safeEqual(hash, att.tokenHash) || deviceId.toLowerCase() !== att.deviceId) {
      this.reject(ws, "invalid_token", "Invalid device token", CLOSE_UNAUTHENTICATED);
      return;
    }
    if (!att.authed) {
      att.authed = true;
      ws.serializeAttachment(att);
    }
    ws.send(
      JSON.stringify({
        type: "auth_ok",
        payload: { device_id: att.deviceId, account_id: att.accountId, server_time: Date.now() },
      }),
    );
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed (the runtime may have replied to the close frame).
    }
  }

  override async webSocketError(): Promise<void> {
    // Nothing to clean up: socket state lives in the attachment.
  }

  /** Closes sockets that never completed auth_init within the timeout. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    let next: number | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att || att.authed) continue;
      const deadline = att.connectedAt + AUTH_TIMEOUT_MS;
      if (deadline <= now) {
        this.reject(ws, "invalid_token", "Authentication timeout", CLOSE_UNAUTHENTICATED);
      } else if (next === null || deadline < next) {
        next = deadline;
      }
    }
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /**
   * Signs devices out of the relay: each socket gets `auth_error` code `revoked` and is closed.
   * `deviceIds === null` closes every socket (account deleted).
   */
  async revoke(deviceIds: string[] | null, message: string): Promise<number> {
    const sockets =
      deviceIds === null ? this.ctx.getWebSockets() : deviceIds.flatMap((id) => this.ctx.getWebSockets(id));
    for (const ws of sockets) this.reject(ws, "revoked", message, CLOSE_REVOKED);
    return sockets.length;
  }

  private reject(ws: WebSocket, code: AuthErrorCode, message: string, closeCode: number): void {
    try {
      ws.send(JSON.stringify({ type: "auth_error", payload: { code, message } }));
    } catch {
      // ignore
    }
    try {
      ws.close(closeCode, code);
    } catch {
      // ignore
    }
  }
}
