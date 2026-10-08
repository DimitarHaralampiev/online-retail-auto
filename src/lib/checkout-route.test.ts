import { it } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/checkout/preview/route";

const input = {
  items: [{ sku: "DEMO-001", quantity: 1 }],
  contact: { name: "Тест", email: "test@example.com", phone: "0888123456" },
  delivery: {
    type: "office",
    courier: "speedy",
    city: "София",
    officeId: "DEMO-speedy-0-1",
  },
  payment: "cod",
};
const request = (body: string, type = "application/json") =>
  new Request("http://localhost/api/checkout/preview", {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });

it("returns a non-cacheable preview without creating an order", async () => {
  const response = await POST(request(JSON.stringify(input)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).orderCreated, false);
});
it("rejects malformed JSON and unsupported content types", async () => {
  assert.equal((await POST(request("{"))).status, 400);
  assert.equal((await POST(request("{}", "text/plain"))).status, 415);
});
it("rejects oversized UTF-8 bodies", async () => {
  assert.equal(
    (await POST(request(JSON.stringify({ value: "я".repeat(10_000) })))).status,
    413,
  );
});
it("rejects tampered checkout data", async () => {
  assert.equal(
    (
      await POST(
        request(
          JSON.stringify({
            ...input,
            items: [{ sku: "DEMO-002", quantity: 5 }],
          }),
        ),
      )
    ).status,
    400,
  );
});
