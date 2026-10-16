import { randomBytes, randomUUID, createHash } from "node:crypto";
import { sql } from "./db.js";

export interface DeviceInfo {
  id: string;
  account_id: string;
  name: string;
  client_version: string | null;
  last_seen_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function listDevices(accountId: string): Promise<DeviceInfo[]> {
  const rows = await sql`
    SELECT id, account_id, name, client_version, last_seen_at, revoked_at, created_at
    FROM devices
    WHERE account_id = ${accountId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    account_id: r.account_id,
    name: r.name,
    client_version: r.client_version,
    last_seen_at: r.last_seen_at,
    revoked_at: r.revoked_at,
    created_at: r.created_at,
  }));
}

export async function createDevice(
  accountId: string,
  name: string
): Promise<{ id: string; name: string; rawToken: string }> {
  const id = randomUUID();
  // 256 bits of CSPRNG entropy
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashDeviceToken(rawToken);

  await sql`
    INSERT INTO devices (id, account_id, name, token_hash)
    VALUES (${id}, ${accountId}, ${name.trim()}, ${tokenHash})
  `;

  return { id, name: name.trim(), rawToken };
}

export async function revokeDevice(accountId: string, deviceId: string): Promise<boolean> {
  const [updated] = await sql`
    UPDATE devices
    SET revoked_at = NOW()
    WHERE id = ${deviceId} AND account_id = ${accountId} AND revoked_at IS NULL
    RETURNING id
  `;

  if (updated) {
    // Notify all Hub instances to disconnect this device immediately
    await sql.notify(
      "account_events",
      JSON.stringify({
        action: "device_revoked",
        device_id: deviceId,
      })
    );
    return true;
  }
  return false;
}
