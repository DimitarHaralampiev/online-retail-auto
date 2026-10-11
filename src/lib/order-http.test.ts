import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "./order-http";
import { POST as webhook } from "../app/api/payments/webhook/route";
import Stripe from "stripe";
const request = (
  body: string,
  origin = "http://localhost:3000",
  type = "application/json",
) =>
  new Request("http://localhost:3000/api/orders", {
    method: "POST",
    headers: { host: "localhost:3000", origin, "Content-Type": type },
    body,
  });
test("order mutations reject cross-site, malformed and oversized input", async () => {
  await assert.rejects(requestJson(request("{}", "https://evil.example")));
  await assert.rejects(requestJson(request("{}", "file://localhost:3000")));
  await assert.rejects(requestJson(request("{broken")));
  await assert.rejects(
    requestJson(request("{}", "http://localhost:3000", "text/plain")),
  );
  await assert.rejects(requestJson(request("x".repeat(16385))));
  assert.deepEqual(await requestJson(request('{"action":"test"}')), {
    action: "test",
  });
});
test("payment webhook rejects a missing or invalid signature", async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit_test";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_test";
    assert.equal(
      (
        await webhook(
          new Request("http://localhost/api/payments/webhook", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await webhook(
          new Request("http://localhost/api/payments/webhook", {
            method: "POST",
            headers: { "stripe-signature": "bad" },
            body: "{}",
          }),
        )
      ).status,
      400,
    );
    const stripe = new Stripe("sk_test_unit_test");
    const payload = JSON.stringify({
      id: "evt_test",
      object: "event",
      type: "customer.updated",
      livemode: false,
      data: { object: {} },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_unit_test",
    });
    assert.equal(
      stripe.webhooks.constructEvent(payload, signature, "whsec_unit_test").id,
      "evt_test",
    );
    assert.throws(() =>
      stripe.webhooks.constructEvent(
        payload + " ",
        signature,
        "whsec_unit_test",
      ),
    );
  } finally {
    if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = key;
    if (secret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = secret;
  }
});
