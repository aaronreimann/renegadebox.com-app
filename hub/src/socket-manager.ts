import type { ServerWebSocket } from "bun";
import type { AuthErrorMessage } from "@renegadebox/protocol";

export interface SocketData {
  id: string;
  authenticated: boolean;
  accountId?: string;
  deviceId?: string;
  deviceName?: string;
  clientVersion?: string;
  authTimeoutTimer?: ReturnType<typeof setTimeout>;
}

export class SocketManager {
  private accounts = new Map<string, Set<ServerWebSocket<SocketData>>>();
  private devices = new Map<string, ServerWebSocket<SocketData>>();

  add(ws: ServerWebSocket<SocketData>) {
    const { accountId, deviceId } = ws.data;
    if (!accountId || !deviceId) return;

    let set = this.accounts.get(accountId);
    if (!set) {
      set = new Set();
      this.accounts.set(accountId, set);
    }
    set.add(ws);
    this.devices.set(deviceId, ws);
  }

  remove(ws: ServerWebSocket<SocketData>) {
    if (ws.data.authTimeoutTimer) {
      clearTimeout(ws.data.authTimeoutTimer);
    }
    const { accountId, deviceId } = ws.data;
    if (accountId) {
      const set = this.accounts.get(accountId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          this.accounts.delete(accountId);
        }
      }
    }
    if (deviceId) {
      const current = this.devices.get(deviceId);
      if (current === ws) {
        this.devices.delete(deviceId);
      }
    }
  }

  broadcast(accountId: string, originDeviceId: string, message: string) {
    const set = this.accounts.get(accountId);
    if (!set) return;

    for (const ws of set) {
      if (ws.data.deviceId !== originDeviceId) {
        try {
          ws.send(message);
        } catch (err) {
          console.warn(`Failed to send message to device ${ws.data.deviceId}:`, err);
        }
      }
    }
  }

  revokeDevice(deviceId: string) {
    const ws = this.devices.get(deviceId);
    if (!ws) return;

    const errMsg: AuthErrorMessage = {
      type: "auth_error",
      payload: {
        code: "revoked",
        message: "This device has been revoked",
      },
    };
    try {
      ws.send(JSON.stringify(errMsg));
      ws.close(4002, "revoked");
    } catch {
      // ignore
    }
    this.remove(ws);
  }

  getDeviceSocket(deviceId: string): ServerWebSocket<SocketData> | undefined {
    return this.devices.get(deviceId);
  }

  getAccountSocketCount(accountId: string): number {
    return this.accounts.get(accountId)?.size ?? 0;
  }
}
