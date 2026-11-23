import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHealth } from "../../src/lib/health";
import { setupTestDatabase } from "./database";

setupTestDatabase();

test("the readiness check reaches the real database", async () => {
  assert.deepEqual(await checkHealth(), {
    status: "ok",
    checks: { database: "ok" },
  });
});
