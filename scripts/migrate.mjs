import pg from "pg";
import { readFile } from "node:fs/promises";
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL before running migrations.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(
    await readFile(new URL("../db/001-accounts.sql", import.meta.url), "utf8"),
  );
  console.log("Account migration applied.");
} finally {
  await pool.end();
}
