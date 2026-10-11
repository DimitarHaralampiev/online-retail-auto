import test from "node:test";
import assert from "node:assert/strict";
import {
  validateTransition,
  nextOrderStatuses,
  validPayment,
} from "./order-state";
import { simulatorEnabled, orderConfig } from "./order-config";
const cod = {
  status: "received" as const,
  payment_method: "cod" as const,
  payment_status: "due_on_delivery" as const,
};
test("orders move forward one stage and terminal stages cannot change", () => {
  assert.doesNotThrow(() => validateTransition(cod, "confirmed"));
  assert.throws(() => validateTransition(cod, "ready"));
  assert.deepEqual(nextOrderStatuses("handed_to_courier"), []);
  assert.deepEqual(nextOrderStatuses("cancelled"), []);
  assert.throws(() =>
    validateTransition({ ...cod, status: "cancelled" }, "confirmed"),
  );
});
test("card orders require confirmed payment and cannot use the COD cancellation shortcut", () => {
  assert.throws(() =>
    validateTransition(
      { ...cod, payment_method: "card", payment_status: "pending" },
      "confirmed",
    ),
  );
  assert.doesNotThrow(() =>
    validateTransition(
      { ...cod, payment_method: "card", payment_status: "paid" },
      "confirmed",
    ),
  );
  assert.throws(() =>
    validateTransition(
      { ...cod, payment_method: "card", payment_status: "paid" },
      "cancelled",
    ),
  );
});
test("handover requires a tracking number", () => {
  assert.throws(() =>
    validateTransition({ ...cod, status: "ready" }, "handed_to_courier", " "),
  );
  assert.doesNotThrow(() =>
    validateTransition(
      { ...cod, status: "ready" },
      "handed_to_courier",
      "TEST-123",
    ),
  );
});
test("payment confirmation must match order, session, amount, currency and test mode", () => {
  const order = {
    id: "order-123",
    total_cents: 2890,
    stripe_session_id: "cs_test_123",
  };
  const session = {
    id: "cs_test_123",
    livemode: false,
    currency: "eur",
    amount_total: 2890,
    payment_status: "paid",
    metadata: { orderId: order.id },
    client_reference_id: order.id,
  };
  assert.equal(validPayment(order, session), true);
  for (const change of [
    { id: "other" },
    { amount_total: 1 },
    { currency: "usd" },
    { livemode: true },
    { payment_status: "unpaid" },
    { metadata: { orderId: "other" } },
    { client_reference_id: "other" },
  ])
    assert.equal(validPayment(order, { ...session, ...change }), false);
});
test("local simulator is disabled in production and for non-local application URLs", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    APP_URL: process.env.APP_URL,
    TEST_SHIPPING_CENTS: process.env.TEST_SHIPPING_CENTS,
  };
  try {
    Object.assign(process.env, {
      NODE_ENV: "development",
      PAYMENT_PROVIDER: "simulator",
      APP_URL: "http://127.0.0.1:3008",
    });
    assert.equal(simulatorEnabled(), true);
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.equal(simulatorEnabled(), false);
    Object.assign(process.env, { NODE_ENV: "development" });
    process.env.APP_URL = "https://shop.example";
    assert.equal(simulatorEnabled(), false);
    process.env.TEST_SHIPPING_CENTS = "";
    assert.equal(orderConfig().shippingCents, null);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
