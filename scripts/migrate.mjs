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
    await pool.query(await readFile(new URL(file, folder), "utf8"));
    console.log(`Applied ${file}`);
  }
} finally {
  await pool.end();
}
