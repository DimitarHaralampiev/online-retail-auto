import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/account/route";
const request = (
  origin: string,
  body: string,
  contentType = "application/json",
) =>
  new Request("http://localhost:3000/api/account", {
    method: "POST",
    headers: { host: "localhost:3000", origin, "Content-Type": contentType },
    body,
  });
test("account rejects missing, malformed and cross-site origins", async () => {
  for (const origin of [
    "",
    "invalid",
    "https://evil.example",
    "file://localhost:3000",
  ]) {
    const response = await POST(request(origin, "{}"));
    assert.equal(response.status, 403);
  }
});
test("account rejects malformed JSON, unsupported content and oversized body", async () => {
  assert.equal(
    (await POST(request("http://localhost:3000", "{broken"))).status,
    400,
  );
  assert.equal(
    (await POST(request("http://localhost:3000", "{}", "text/plain"))).status,
    415,
  );
  assert.equal(
    (await POST(request("http://localhost:3000", "x".repeat(8193)))).status,
    413,
  );
});
test("account rejects unknown actions and invalid registration before database access", async () => {
  assert.equal(
    (
      await POST(
        request("http://localhost:3000", JSON.stringify({ action: "admin" })),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await POST(
        request(
          "http://localhost:3000",
          JSON.stringify({ action: "register", credentials: { email: "bad" } }),
        ),
      )
    ).status,
    400,
  );
});
