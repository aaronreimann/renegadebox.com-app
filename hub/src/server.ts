import {
  validateWsMessage,
  wsMessageErrors,
  type AuthErrorMessage,
  type AuthOkMessage,
} from "@renegadebox/protocol";
import postgres from "postgres";
import { createDb, hashToken, runMigrations } from "./db.js";
import { SocketManager, type SocketData } from "./socket-manager.js";

export interface HubOptions {
  port?: number;
  dbUrl?: string;
  authTimeoutMs?: number;
}

export async function createHub(options: HubOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const authTimeoutMs = options.authTimeoutMs ?? 10_000;
  const sql = createDb(options.dbUrl);
  const subSql = createDb(options.dbUrl);

  // Ensure migrations are run on startup
  await runMigrations(sql);

  const socketManager = new SocketManager();

  // Listen to Postgres account_events channel for cross-hub and cross-socket fanout
  await subSql.listen("account_events", (rawPayload) => {
    try {
      const data = JSON.parse(rawPayload);
      if (data.action === "device_revoked" && data.device_id) {
        socketManager.revokeDevice(data.device_id);
        return;
      }

      const { account_id, origin_device_id, seq, object_key, sealed_entry } = data;
      if (!account_id || !origin_device_id || !seq || !object_key) return;

      const syncMsg = {
        type: "sync_required",
        payload: {
          origin_device_id,
          seq,
          object_key,
          ...(sealed_entry ? { sealed_entry } : {}),
        },
      };

      socketManager.broadcast(account_id, origin_device_id, JSON.stringify(syncMsg));
    } catch (err) {
      console.warn("Hub error handling account_events notification:", err);
    }
  });

  const server = Bun.serve<SocketData>({
    port,
    fetch(req, s) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return new Response("OK", { status: 200 });
      }
      if (url.pathname === "/ws" || url.pathname === "/") {
        const upgraded = s.upgrade(req, {
          data: {
            id: crypto.randomUUID(),
            authenticated: false,
          },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        // Enforce auth timeout so unauthenticated connections don't hang indefinitely
        ws.data.authTimeoutTimer = setTimeout(() => {
          if (!ws.data.authenticated) {
            const errMsg: AuthErrorMessage = {
              type: "auth_error",
              payload: {
                code: "invalid_token",
                message: "Authentication timeout",
              },
            };
            try {
              ws.send(JSON.stringify(errMsg));
              ws.close(4001, "auth_timeout");
            } catch {
              // ignore
            }
          }
        }, authTimeoutMs);
      },
      async message(ws, raw) {
        let msg: unknown;
        try {
          msg = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw));
        } catch {
          // Bad JSON
          return;
        }

        if (!validateWsMessage(msg)) {
          console.warn("Hub received invalid message schema:", wsMessageErrors());
          if (!ws.data.authenticated) {
            const errMsg: AuthErrorMessage = {
              type: "auth_error",
              payload: {
                code: "invalid_token",
                message: "Malformed message schema",
              },
            };
            ws.send(JSON.stringify(errMsg));
            ws.close(4001, "bad_schema");
          }
          return;
        }

        switch (msg.type) {
          case "auth_init": {
            const { device_token, device_id, device_name, client_version } = msg.payload;
            const tokenHash = hashToken(device_token);

            const [device] = await sql`
              SELECT id, account_id, name, revoked_at
              FROM devices
              WHERE token_hash = ${tokenHash}
            `;

            if (!device) {
              const errMsg: AuthErrorMessage = {
                type: "auth_error",
                payload: {
                  code: "invalid_token",
                  message: "Invalid or unknown device token",
                },
              };
              ws.send(JSON.stringify(errMsg));
              ws.close(4001, "invalid_token");
              return;
            }

            if (device.revoked_at) {
              const errMsg: AuthErrorMessage = {
                type: "auth_error",
                payload: {
                  code: "revoked",
                  message: "This device has been revoked",
                },
              };
              ws.send(JSON.stringify(errMsg));
              ws.close(4002, "revoked");
              return;
            }

            if (ws.data.authTimeoutTimer) {
              clearTimeout(ws.data.authTimeoutTimer);
              ws.data.authTimeoutTimer = undefined;
            }

            // If the registered device ID differs from the connecting client's device_id,
            // update it to match the client's device_id.
            if (device.id !== device_id) {
              await sql`
                UPDATE devices
                SET id = ${device_id}
                WHERE token_hash = ${tokenHash}
              `;
            }

            // Update device in DB
            await sql`
              UPDATE devices
              SET last_seen_at = NOW(), client_version = ${client_version}, name = ${device_name}
              WHERE id = ${device_id}
            `;

            ws.data.authenticated = true;
            ws.data.accountId = device.account_id;
            ws.data.deviceId = device_id;
            ws.data.deviceName = device_name;
            ws.data.clientVersion = client_version;

            socketManager.add(ws);

            const okMsg: AuthOkMessage = {
              type: "auth_ok",
              payload: {
                device_id: device.id,
                account_id: device.account_id,
                server_time: Date.now(),
              },
            };
            ws.send(JSON.stringify(okMsg));
            break;
          }

          case "journal_appended": {
            if (!ws.data.authenticated || !ws.data.accountId || !ws.data.deviceId) {
              const errMsg: AuthErrorMessage = {
                type: "auth_error",
                payload: {
                  code: "invalid_token",
                  message: "Not authenticated",
                },
              };
              ws.send(JSON.stringify(errMsg));
              ws.close(4001, "unauthenticated");
              return;
            }

            // Update last_seen_at
            await sql`
              UPDATE devices
              SET last_seen_at = NOW()
              WHERE id = ${ws.data.deviceId}
            `;

            const eventData = {
              account_id: ws.data.accountId,
              origin_device_id: ws.data.deviceId,
              seq: msg.payload.seq,
              object_key: msg.payload.object_key,
              sealed_entry: msg.payload.sealed_entry,
            };

            let notifyStr = JSON.stringify(eventData);
            // Postgres NOTIFY payload hard limit is 8000 bytes.
            // If payload > 7500 bytes, omit sealed_entry so receiver pulls from S3.
            if (notifyStr.length > 7500) {
              notifyStr = JSON.stringify({
                account_id: ws.data.accountId,
                origin_device_id: ws.data.deviceId,
                seq: msg.payload.seq,
                object_key: msg.payload.object_key,
              });
            }

            await sql.notify("account_events", notifyStr);
            break;
          }

          case "ping": {
            ws.send(
              JSON.stringify({
                type: "pong",
                payload: { nonce: msg.payload.nonce },
              })
            );
            break;
          }

          case "pong": {
            if (ws.data.authenticated && ws.data.deviceId) {
              await sql`
                UPDATE devices
                SET last_seen_at = NOW()
                WHERE id = ${ws.data.deviceId}
              `;
            }
            break;
          }

          default:
            break;
        }
      },
      close(ws) {
        socketManager.remove(ws);
      },
    },
  });

  return {
    server,
    port: (server.port ?? port) as number,
    socketManager,
    sql,
    subSql,
    async stop() {
      server.stop(true);
      await subSql.end();
      await sql.end();
    },
  };
}
