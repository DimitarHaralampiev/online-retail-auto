import assert from "node:assert/strict";
import { test } from "node:test";
import { database } from "../../src/lib/accounts";
import { setupTestDatabase } from "./database";

const db = setupTestDatabase();

test("a lost idle connection is logged and the pool recovers", async () => {
  const app = database();
  // Open an app connection and leave it idle in the pool.
  const pid = (
    await app.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
  ).rows[0].pid;
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    const lost = new Promise<void>((resolve) =>
      app.once("error", () => resolve()),
    );
    // What a database restart or failover does to idle connections.
    await db().pool.query("SELECT pg_terminate_backend($1)", [pid]);
    await lost;
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(
    String((logged[0] as unknown[])[0]),
    /Idle database connection lost/,
  );
  // The process is still alive and the next query gets a fresh connection.
  const next = await app.query<{ ok: number }>("SELECT 1 AS ok");
  assert.equal(next.rows[0].ok, 1);
});
