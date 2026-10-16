import postgres from "postgres";

const connStr =
  process.env.DATABASE_URL ||
  "postgres://renegadebox:renegadebox@localhost:5432/renegadebox";

export const sql = postgres(connStr, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});
