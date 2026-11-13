import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { changeOrderStatus, createOrder } from "../../src/lib/orders";
import { insertCustomer, setupTestDatabase } from "./database";

// Read by src/lib/order-config.ts at call time, so setting it here is enough.
Object.assign(process.env, {
  ORDERS_MODE: "test",
  TEST_SHIPPING_CENTS: "500",
  FREE_SHIPPING_ABOVE_CENTS: "3000",
  APP_URL: "http://localhost:3000",
  PAYMENT_PROVIDER: "simulator",
  ORDER_TRACKING_SECRET: "a".repeat(64),
});

const db = setupTestDatabase();

// Address delivery keeps these tests offline (office delivery loads courier data).
function checkout(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ sku: "DEMO-003", quantity: 1 }],
    contact: {
      name: "Иван Петров",
      email: "buyer@example.test",
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
    ...overrides,
  };
}

function order(
  requestKey: string = randomUUID(),
  expectedTotalCents = 2390,
  checkoutOverrides: Record<string, unknown> = {},
) {
  return {
    requestKey,
    expectedTotalCents,
    acknowledgeTest: true,
    checkout: checkout(checkoutOverrides),
  };
}

async function count(table: string): Promise<number> {
  const result = await db().pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table}`,
  );
  return result.rows[0].n;
}

beforeEach(async () => {
  await db().pool.query("TRUNCATE orders CASCADE");
});

test("creates an order with server-side prices, history and a queued email", async () => {
  const created = await createOrder(order(), null);
  assert.equal(created.status, "received");
  assert.equal(created.payment_status, "due_on_delivery");
  // DEMO-003 costs 18.90 EUR; 5.00 EUR shipping below the free threshold.
  assert.equal(created.subtotal_cents, 1890);
  assert.equal(created.shipping_cents, 500);
  assert.equal(created.total_cents, 2390);
  const history = await db().pool.query(
    "SELECT status FROM order_history WHERE order_id=$1",
    [created.id],
  );
  assert.deepEqual(
    history.rows.map((row) => row.status),
    ["received"],
  );
  const emails = await db().pool.query(
    "SELECT recipient,body FROM order_email_outbox WHERE order_id=$1",
    [created.id],
  );
  assert.equal(emails.rowCount, 1);
  assert.equal(emails.rows[0].recipient, "buyer@example.test");
  assert.match(emails.rows[0].body, /#token=[a-f0-9]{64}/);
});

test("shipping is free above the threshold and uses discounted prices", async () => {
  // 2 × 23.90 EUR (discounted organizer) = 47.80 EUR > 30.00 EUR.
  const created = await createOrder(
    order(randomUUID(), 4780, { items: [{ sku: "DEMO-001", quantity: 2 }] }),
    null,
  );
  assert.equal(created.subtotal_cents, 4780);
  assert.equal(created.shipping_cents, 0);
});

test("repeating a request key with the same data returns the same order", async () => {
  const key = randomUUID();
  const first = await createOrder(order(key), null);
  const second = await createOrder(order(key), null);
  assert.equal(second.id, first.id);
  assert.equal(await count("orders"), 1);
  assert.equal(await count("order_email_outbox"), 1);
});

test("concurrent submissions of one request create exactly one order", async () => {
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 6 }, () => createOrder(order(key), null)),
  );
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(await count("orders"), 1);
  assert.equal(await count("order_history"), 1);
  assert.equal(await count("order_email_outbox"), 1);
});

test("reusing a request key with different data is rejected", async () => {
  const key = randomUUID();
  await createOrder(order(key), null);
  await assert.rejects(
    createOrder(
      order(key, 2390, {
        contact: {
          name: "Друг Човек",
          email: "other@example.test",
          phone: "0888123456",
        },
      }),
      null,
    ),
    /вече е използвана/,
  );
  assert.equal(await count("orders"), 1);
});

test("a stale expected total is rejected without writing anything", async () => {
  await assert.rejects(createOrder(order(randomUUID(), 1890), null), /Сумата/);
  assert.equal(await count("orders"), 0);
  assert.equal(await count("order_email_outbox"), 0);
});

test("status changes follow the workflow and are recorded with the actor", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  const created = await createOrder(order(), null);
  const confirmed = await changeOrderStatus(
    created.id,
    "confirmed",
    "received",
    admin,
  );
  assert.equal(confirmed.status, "confirmed");
  const history = await db().pool.query(
    "SELECT status,actor_id FROM order_history WHERE order_id=$1 ORDER BY created_at",
    [created.id],
  );
  assert.deepEqual(history.rows, [
    { status: "received", actor_id: null },
    { status: "confirmed", actor_id: admin },
  ]);
  assert.equal(await count("order_email_outbox"), 2);
});

test("a stale or invalid status change rolls back completely", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  const created = await createOrder(order(), null);
  await assert.rejects(
    changeOrderStatus(created.id, "preparing", "confirmed", admin),
    /вече е променен/,
  );
  await assert.rejects(
    changeOrderStatus(created.id, "ready", "received", admin),
    /Невалидна промяна/,
  );
  for (const status of ["confirmed", "preparing", "ready"] as const)
    await changeOrderStatus(
      created.id,
      status,
      status === "confirmed"
        ? "received"
        : status === "preparing"
          ? "confirmed"
          : "preparing",
      admin,
    );
  await assert.rejects(
    changeOrderStatus(created.id, "handed_to_courier", "ready", admin, " "),
    /товарителница/,
  );
  const row = await db().pool.query(
    "SELECT status,tracking_number FROM orders WHERE id=$1",
    [created.id],
  );
  assert.deepEqual(row.rows[0], { status: "ready", tracking_number: null });
  assert.equal(await count("order_history"), 4);
});

test("only one of two concurrent status changes succeeds", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  const created = await createOrder(order(), null);
  const results = await Promise.allSettled([
    changeOrderStatus(created.id, "confirmed", "received", admin),
    changeOrderStatus(created.id, "cancelled", "received", admin),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(await count("order_history"), 2);
});

test("card orders cannot progress before payment is confirmed", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  const created = await createOrder(
    order(randomUUID(), 2390, { payment: "card" }),
    null,
  );
  assert.equal(created.payment_status, "pending");
  await assert.rejects(
    changeOrderStatus(created.id, "confirmed", "received", admin),
    /картовото плащане/,
  );
});

test("orders for unavailable stock are rejected", async () => {
  // DEMO-004 has no free stock in the demo catalog.
  await assert.rejects(
    createOrder(
      order(randomUUID(), 2990, { items: [{ sku: "DEMO-004", quantity: 1 }] }),
      null,
    ),
    /Недостатъчна наличност/,
  );
  assert.equal(await count("orders"), 0);
});
