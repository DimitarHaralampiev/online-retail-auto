import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { checkDatabase, checkHealth } from "./health";

const saved = process.env.DATABASE_URL;
beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://user@127.0.0.1:1/none";
});
afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

test("the database check passes, fails and times out", async () => {
  assert.equal(await checkDatabase(async () => ({ rows: [] })), "ok");
  assert.equal(
    await checkDatabase(async () => {
      throw new Error("ECONNREFUSED");
    }),
    "error",
  );
  assert.equal(await checkDatabase(() => new Promise(() => {}), 20), "error");
});

test("without a database the shop is not ready", async () => {
  delete process.env.DATABASE_URL;
  assert.equal(await checkDatabase(), "not_configured");
  assert.deepEqual(await checkHealth(async () => "not_configured"), {
    status: "error",
    checks: { database: "not_configured" },
  });
  assert.deepEqual(await checkHealth(async () => "ok"), {
    status: "ok",
    checks: { database: "ok" },
  });
});
