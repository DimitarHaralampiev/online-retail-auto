import assert from "node:assert/strict";
import { test } from "node:test";
import { errorCode, reportCaughtError } from "./caught-error";

test("only a plain code from the server is shown", () => {
  assert.equal(
    errorCode(Object.assign(new Error("x"), { digest: "973317724" })),
    "973317724",
  );
  for (const error of [
    null,
    undefined,
    "text",
    new Error("no digest"),
    { digest: 5 },
    { digest: "<script>" },
    { digest: "NEXT_REDIRECT;replace;/a" },
    { digest: "x".repeat(65) },
  ])
    assert.equal(errorCode(error), null);
});

test("reporting never throws, also without a browser", () => {
  assert.doesNotThrow(() => reportCaughtError(new Error("x")));
});
