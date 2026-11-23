// Observability (#52): request ids and health probes. The browser tests run
// without a database, so readiness reports it as not configured.
import { expect, test } from "@playwright/test";

const ID = /^[0-9a-f-]{36}$/;

test("pages and API responses carry a request id", async ({ request }) => {
  expect((await request.get("/catalog")).headers()["x-request-id"]).toMatch(ID);
  const api = await request.get("/api/health?probe=live");
  expect(api.headers()["x-request-id"]).toMatch(ID);
  const kept = await request.get("/", {
    headers: { "x-request-id": "lb-request-12345" },
  });
  expect(kept.headers()["x-request-id"]).toBe("lb-request-12345");
  const unsafe = await request.get("/", {
    headers: { "x-request-id": "bad id" },
  });
  expect(unsafe.headers()["x-request-id"]).toMatch(ID);
});

test("liveness answers without dependencies; readiness needs the database", async ({
  request,
}) => {
  const live = await request.get("/api/health?probe=live");
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: "ok" });
  const ready = await request.get("/api/health");
  expect(ready.status()).toBe(503);
  expect(ready.headers()["cache-control"]).toContain("no-store");
  expect(await ready.json()).toEqual({
    status: "error",
    checks: { database: "not_configured" },
  });
});
