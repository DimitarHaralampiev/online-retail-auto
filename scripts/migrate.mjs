import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL before running migrations.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const folder = new URL("../db/", import.meta.url);
  for (const file of (await readdir(folder))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(new URL(file, folder), "utf8"));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log(`Applied ${file}`);
  }
} finally {
  await pool.end();
}
