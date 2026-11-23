import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { changeOrderStatus, createOrder } from "../../src/lib/orders";
import {
  adminReturns,
  customerReturns,
  processReturn,
  requestReturn,
  RETURN_DAYS,
  ReturnError,
} from "../../src/lib/returns";
import { insertCustomer, setupTestDatabase } from "./database";

Object.assign(process.env, {
  CATALOG_SOURCE: "postgres",
  ORDERS_MODE: "test",
  TEST_SHIPPING_CENTS: "500",
  FREE_SHIPPING_ABOVE_CENTS: "3000",
  APP_URL: "http://localhost:3000",
  PAYMENT_PROVIDER: "simulator",
  ORDER_TRACKING_SECRET: "c".repeat(64),
});

let customer = "";
let other = "";
let admin = "";
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    customer = await insertCustomer(pool, { email: "ret@example.test" });
    other = await insertCustomer(pool);
    admin = await insertCustomer(pool, { isAdmin: true });
  },
});

// DEMO-003 air filter 18.90 EUR (8 in stock), DEMO-005 shampoo.
async function deliveredOrder(quantity = 2) {
  const created = await createOrder(
    {
      requestKey: randomUUID(),
      expectedTotalCents: 1890 * quantity + (1890 * quantity > 3000 ? 0 : 500),
      acknowledgeTest: true,
      checkout: {
        items: [{ sku: "DEMO-003", quantity }],
        contact: {
          name: "Иван Петров",
          email: "ret@example.test",
          phone: "0888123456",
        },
        delivery: {
          type: "address",
          courier: "speedy",
          city: "София",
          postalCode: "1000",
          street: "ул. Тестова",
          number: "1",
          details: "",
        },
        payment: "cod",
      },
    },
    customer,
  );
  const steps = [
    "confirmed",
    "preparing",
    "ready",
    "handed_to_courier",
    "delivered",
  ] as const;
  let current = "received";
  for (const next of steps) {
    await changeOrderStatus(created.id, next, current as never, admin, "TRK-1");
    current = next;
  }
  return created.id;
}

const stock = async () =>
  (
    await db().pool.query(
      "SELECT on_hand, reserved FROM warehouse_products WHERE sku='DEMO-003'",
    )
  ).rows[0];

const refused = (promise: Promise<unknown>, status: number, pattern: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ReturnError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });

test("delivery records the date; a delivered order can no longer be cancelled", async () => {
  const id = await deliveredOrder();
  const order = (
    await db().pool.query(
      "SELECT status, delivered_at FROM orders WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(order.status, "delivered");
  assert.ok(order.delivered_at);
  await assert.rejects(
    changeOrderStatus(id, "cancelled", "delivered", admin),
    /Невалидна промяна/,
  );
});

test("the full return: request, approve, receive back into stock", async () => {
  const id = await deliveredOrder(2);
  const before = await stock();
  const requestId = await requestReturn(customer, id, {
    lines: [{ lineNumber: 1, quantity: 1 }],
    reason: "Не става",
  });
  // Only one open request per order.
  await refused(
    requestReturn(customer, id, {
      lines: [{ lineNumber: 1, quantity: 1 }],
      reason: "",
    }),
    409,
    /Вече има заявка/,
  );
  assert.equal(
    await processReturn(admin, requestId, {
      action: "approve",
      note: "Изпрати до офис.",
    }),
    "approved",
  );
  await refused(
    processReturn(admin, requestId, { action: "approve", note: "" }),
    409,
    /вече е обработена/,
  );
  assert.equal(
    await processReturn(admin, requestId, { action: "receive", note: "" }),
    "received",
  );
  const after = await stock();
  assert.equal(after.on_hand, before.on_hand + 1);
  const movement = await db().pool.query(
    "SELECT kind, quantity FROM stock_movements WHERE reference_key=$1",
    [`return:${requestId}:DEMO-003`],
  );
  assert.deepEqual(movement.rows, [{ kind: "return", quantity: 1 }]);
  const [summary] = await customerReturns(customer, id);
  assert.equal(summary.status, "received");
  assert.equal(summary.refundCents, 1890);
  assert.equal(summary.adminNote, "Изпрати до офис.");
  // The goods value waits in the refund queue for an admin to pay out.
  const queued = await db().pool.query(
    "SELECT order_id, amount_cents, reason, status FROM refunds WHERE return_request_id=$1",
    [requestId],
  );
  assert.deepEqual(queued.rows, [
    { order_id: id, amount_cents: 1890, reason: "return", status: "requested" },
  ]);
  // Customer emails: request received, approved, goods received.
  const emails = await db().pool.query(
    "SELECT body FROM order_email_outbox WHERE order_id=$1 ORDER BY created_at",
    [id],
  );
  assert.ok(
    emails.rows.some((e) => /Получихме заявката ти за връщане/.test(e.body)),
  );
  assert.ok(
    emails.rows.some((e) => /Получихме върнатите артикули/.test(e.body)),
  );
  const audit = await db().pool.query(
    "SELECT details FROM admin_audit_log WHERE entity_id=$1 ORDER BY created_at",
    [requestId],
  );
  assert.deepEqual(
    audit.rows.map((r) => r.details.to),
    ["approved", "received"],
  );
  // The remaining unit can still be returned; the returned one cannot again.
  await refused(
    requestReturn(customer, id, {
      lines: [{ lineNumber: 1, quantity: 2 }],
      reason: "",
    }),
    400,
    /до 1 бр\./,
  );
  assert.ok(
    await requestReturn(customer, id, {
      lines: [{ lineNumber: 1, quantity: 1 }],
      reason: "",
    }),
  );
});

test("a rejected request frees its quantities", async () => {
  const id = await deliveredOrder(1);
  const requestId = await requestReturn(customer, id, {
    lines: [{ lineNumber: 1, quantity: 1 }],
    reason: "",
  });
  assert.equal(
    await processReturn(admin, requestId, {
      action: "reject",
      note: "Използван продукт.",
    }),
    "rejected",
  );
  await refused(
    processReturn(admin, requestId, { action: "receive", note: "" }),
    409,
    /вече е обработена/,
  );
  assert.ok(
    await requestReturn(customer, id, {
      lines: [{ lineNumber: 1, quantity: 1 }],
      reason: "",
    }),
  );
});

test("only the customer's own delivered orders within 14 days", async () => {
  const id = await deliveredOrder(1);
  await refused(
    requestReturn(other, id, {
      lines: [{ lineNumber: 1, quantity: 1 }],
      reason: "",
    }),
    404,
    /не е намерена/,
  );
  await refused(
    requestReturn(customer, randomUUID(), {
      lines: [{ lineNumber: 1, quantity: 1 }],
      reason: "",
    }),
    404,
    /не е намерена/,
  );
  await refused(
    requestReturn(customer, id, {
      lines: [{ lineNumber: 2, quantity: 1 }],
      reason: "",
    }),
    400,
    /Непознат артикул/,
  );
  await refused(
    requestReturn(customer, id, {
      lines: [
        { lineNumber: 1, quantity: 1 },
        { lineNumber: 1, quantity: 1 },
      ],
      reason: "",
    }),
    400,
    /веднъж/,
  );
  const late = new Date(Date.now() + (RETURN_DAYS + 1) * 86_400_000);
  await refused(
    requestReturn(
      customer,
      id,
      { lines: [{ lineNumber: 1, quantity: 1 }], reason: "" },
      late,
    ),
    400,
    /Срокът от 14 дни/,
  );
  // Not delivered yet.
  await db().pool.query(
    "UPDATE orders SET status='handed_to_courier', delivered_at=NULL WHERE id=$1",
    [id],
  );
  await refused(
    requestReturn(customer, id, {
      lines: [{ lineNumber: 1, quantity: 1 }],
      reason: "",
    }),
    400,
    /след доставката/,
  );
  assert.deepEqual(await customerReturns(other, id), []);
});

test("the admin list shows open requests first", async () => {
  const all = await adminReturns();
  assert.ok(all.length >= 3);
  const firstClosed = all.findIndex(
    (r) => r.status === "received" || r.status === "rejected",
  );
  const lastOpen = all
    .map((r) => r.status === "requested" || r.status === "approved")
    .lastIndexOf(true);
  assert.ok(lastOpen < firstClosed || firstClosed === -1);
  assert.ok(
    (await adminReturns("rejected")).every((r) => r.status === "rejected"),
  );
});
