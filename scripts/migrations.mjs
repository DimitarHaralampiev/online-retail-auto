import pg from "pg";
import { readdir, readFile } from "node:fs/promises";

const folder = new URL("../db/", import.meta.url);

/** Sorted migration file names from db/. */
export async function migrationFiles() {
  return (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort();
}

/**
 * Applies every migration in order, each in its own transaction. There is no
 * tracking table: all files run on every call, so each must be idempotent.
 */
export async function applyMigrations(
  connectionString,
  { log = () => {} } = {},
) {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    for (const file of await migrationFiles()) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(await readFile(new URL(file, folder), "utf8"));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${error.message}`, {
          cause: error,
        });
      } finally {
        client.release();
      }
      log(`Applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}
