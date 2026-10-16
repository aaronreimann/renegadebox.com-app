import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Account {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface Device {
  id: string;
  account_id: string;
  name: string;
  token_hash: string;
  client_version: string | null;
  last_seen_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createDb(url?: string) {
  const connStr =
    url ||
    process.env.DATABASE_URL ||
    "postgres://renegadebox:renegadebox@localhost:5432/renegadebox";
  return postgres(connStr, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export async function runMigrations(sql: postgres.Sql) {
  // Try several candidate locations for db/schema.sql
  const candidates = [
    join(import.meta.dir, "../../db/schema.sql"),
    join(import.meta.dir, "../db/schema.sql"),
    join(process.cwd(), "db/schema.sql"),
    join(process.cwd(), "../db/schema.sql"),
  ];

  let schemaPath = candidates.find((p) => existsSync(p));
  if (!schemaPath) {
    throw new Error("Could not find db/schema.sql in any candidate path");
  }

  const schemaSql = readFileSync(schemaPath, "utf8");
  await sql.unsafe(schemaSql);
}
