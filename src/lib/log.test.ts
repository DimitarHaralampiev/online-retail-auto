import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLog, logError } from "./log";
import { requestIdFrom } from "./request-id";

test("log lines are JSON with level, message and fields", () => {
  const line = JSON.parse(
    formatLog(
      "info",
      "Order placed",
      { orderId: "o-1", count: 2 },
      new Date("2026-01-02T03:04:05Z"),
    ),
  );
  assert.deepEqual(line, {
    time: "2026-01-02T03:04:05.000Z",
    level: "info",
    msg: "Order placed",
    orderId: "o-1",
    count: 2,
  });
});

test("secret-looking fields are redacted, also when nested", () => {
  const line = JSON.parse(
    formatLog("warn", "x", {
      password: "hunter2",
      nested: { apiKey: "sk-1", sessionToken: "t", cookie: "c", ok: "visible" },
    }),
  );
  assert.equal(line.password, "[redacted]");
  assert.deepEqual(line.nested, {
    apiKey: "[redacted]",
    sessionToken: "[redacted]",
    cookie: "[redacted]",
    ok: "visible",
  });
});

test("errors keep name, code and stack but lose personal data", () => {
  const error = Object.assign(
    new Error("No customer ana@example.test with phone +359888123456"),
    {
      code: "23505",
    },
  );
  const { error: logged } = JSON.parse(formatLog("error", "failed", { error }));
  assert.equal(logged.name, "Error");
  assert.equal(logged.code, "23505");
  assert.equal(logged.message, "No customer [email] with phone [number]");
  assert.match(logged.stack, /log\.test\.ts/);
  assert.doesNotMatch(logged.stack, /ana@example/);
});

test("request ids from upstream are kept only when they look safe", () => {
  assert.equal(requestIdFrom("abc-123_DEF.456"), "abc-123_DEF.456");
  for (const bad of [
    null,
    "",
    "short",
    "has space in it",
    "x".repeat(101),
    "<script>alert(1)</script>",
  ])
    assert.match(requestIdFrom(bad), /^[0-9a-f-]{36}$/);
});

test("logError logs and reports, and never throws", async () => {
  const reported: unknown[] = [];
  const original = console.error;
  const lines: string[] = [];
  console.error = (line: string) => lines.push(line);
  try {
    await logError(
      "Order service failed",
      new Error("boom"),
      { orderId: "o-1" },
      async (e, c) => {
        reported.push(e, c.label, c.extra);
        return true;
      },
    );
    await logError("Refund needed", null, {}, async (e) => {
      reported.push((e as Error).message);
      throw new Error("tracker down");
    });
  } finally {
    console.error = original;
  }
  const first = JSON.parse(lines[0]);
  assert.equal(first.msg, "Order service failed");
  assert.equal(first.orderId, "o-1");
  assert.equal(first.error.message, "boom");
  assert.equal(JSON.parse(lines[1]).error, undefined);
  assert.equal((reported[0] as Error).message, "boom");
  assert.equal(reported[1], "Order service failed");
  assert.deepEqual(reported[2], { orderId: "o-1" });
  assert.equal(
    reported[3],
    "Refund needed",
    "a missing error is reported by its label",
  );
});
