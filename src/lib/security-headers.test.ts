import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentSecurityPolicy,
  staticSecurityHeaders,
} from "./security-headers";

test("the production policy allows only nonce scripts and no eval", () => {
  const csp = contentSecurityPolicy("abc123", { https: true });
  assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  for (const directive of [
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ])
    assert.ok(csp.includes(directive), directive);
});

test("development adds only what hot reload needs", () => {
  const csp = contentSecurityPolicy("n", { dev: true });
  assert.match(csp, /'unsafe-eval'/);
  assert.match(csp, /connect-src 'self' ws: wss:/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test("HSTS is sent only in production", () => {
  const keys = (production: boolean) =>
    staticSecurityHeaders(production).map((h) => h.key);
  assert.ok(keys(true).includes("Strict-Transport-Security"));
  assert.ok(!keys(false).includes("Strict-Transport-Security"));
  assert.ok(keys(false).includes("X-Content-Type-Options"));
});
