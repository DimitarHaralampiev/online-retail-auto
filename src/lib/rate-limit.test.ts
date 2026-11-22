import assert from "node:assert/strict";
import { test } from "node:test";
import { clientKey, createRateLimiter } from "./rate-limit";

test("allows up to the limit per window, then reports when to retry", () => {
  const limiter = createRateLimiter(3, 10_000);
  const at = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(limiter.take("a", at).allowed, true);
  const blocked = limiter.take("a", at + 2_500);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 8);
  // Other clients are independent; a new window starts afresh.
  assert.equal(limiter.take("b", at).allowed, true);
  assert.equal(limiter.take("a", at + 10_000).allowed, true);
});

test("memory stays bounded under many distinct clients", () => {
  const limiter = createRateLimiter(1, 60_000);
  for (let i = 0; i < 10_050; i++) limiter.take(`ip-${i}`, 5);
  assert.ok(limiter.size() <= 10_000);
});

test("client key comes from the proxy headers", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost/", { headers });
  assert.equal(
    clientKey(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    "203.0.113.7",
  );
  assert.equal(
    clientKey(request({ "x-real-ip": "198.51.100.2" })),
    "198.51.100.2",
  );
  assert.equal(clientKey(request({})), "unknown");
});
