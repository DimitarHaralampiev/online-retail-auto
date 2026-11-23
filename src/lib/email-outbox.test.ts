import assert from "node:assert/strict";
import { test } from "node:test";
import { permanentFailure, retryDelaySeconds } from "./email-outbox";

test("only recipient rejections are permanent", () => {
  assert.equal(permanentFailure({ responseCode: 550 }), true);
  assert.equal(permanentFailure({ responseCode: 553 }), true);
  assert.equal(permanentFailure({ code: "EENVELOPE" }), true);
  // Authentication, throttling and connection problems are worth retrying.
  for (const error of [
    { responseCode: 535 },
    { responseCode: 421 },
    { responseCode: 452 },
    { code: "ECONNECTION" },
    new Error("x"),
    null,
  ])
    assert.equal(permanentFailure(error), false);
});

test("retry delays grow and are capped", () => {
  let previous = 0;
  for (let attempt = 1; attempt <= 12; attempt++) {
    const delay = retryDelaySeconds(attempt);
    assert.ok(delay >= previous);
    assert.ok(delay <= 6 * 3600);
    previous = delay;
  }
});
