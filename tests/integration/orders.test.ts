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

// Demo catalog assumptions (src/lib/catalog.ts). Epic #12 moves the catalog to
// the database; these tests should then seed their own products instead.
const FILTER = { sku: "DEMO-003", priceCents: 1890 };
const ORGANIZER = { sku: "DEMO-001", salePriceCents: 2390 };
const OUT_OF_STOCK = { sku: "DEMO-004", priceCents: 2490 };
const SHIPPING_CENTS = 500;
const FILTER_TOTAL = FILTER.priceCents + SHIPPING_CENTS;

// Address delivery keeps these tests offline (office delivery loads courier data).
function checkout(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ sku: FILTER.sku, quantity: 1 }],
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
  expectedTotalCents = FILTER_TOTAL,
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
  assert.equal(created.subtotal_cents, FILTER.priceCents);
  assert.equal(created.shipping_cents, SHIPPING_CENTS);
  assert.equal(created.total_cents, FILTER_TOTAL);
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
  // Two discounted organizers exceed the 30.00 EUR free-shipping threshold.
  const subtotal = 2 * ORGANIZER.salePriceCents;
  const created = await createOrder(
    order(randomUUID(), subtotal, {
      items: [{ sku: ORGANIZER.sku, quantity: 2 }],
    }),
    null,
  );
  assert.equal(created.subtotal_cents, subtotal);
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
      order(key, FILTER_TOTAL, {
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
  await assert.rejects(
    createOrder(order(randomUUID(), FILTER.priceCents), null),
    /Сумата/,
  );
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
  const steps = [
    ["received", "confirmed"],
    ["confirmed", "preparing"],
    ["preparing", "ready"],
  ] as const;
  for (const [from, to] of steps)
    await changeOrderStatus(created.id, to, from, admin);
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
    order(randomUUID(), FILTER_TOTAL, { payment: "card" }),
    null,
  );
  assert.equal(created.payment_status, "pending");
  await assert.rejects(
    changeOrderStatus(created.id, "confirmed", "received", admin),
    /картовото плащане/,
  );
});

test("orders for unavailable stock are rejected", async () => {
  await assert.rejects(
    createOrder(
      order(randomUUID(), OUT_OF_STOCK.priceCents + SHIPPING_CENTS, {
        items: [{ sku: OUT_OF_STOCK.sku, quantity: 1 }],
      }),
      null,
    ),
    /Недостатъчна наличност/,
  );
  assert.equal(await count("orders"), 0);
});

test("a request key cannot be replayed by another customer", async () => {
  const owner = await insertCustomer(db().pool);
  const other = await insertCustomer(db().pool);
  const key = randomUUID();
  const first = await createOrder(order(key), owner);
  for (const customer of [other, null])
    await assert.rejects(
      createOrder(order(key), customer),
      /вече е използвана/,
      "another customer must not receive the owner's order",
    );
  assert.equal((await createOrder(order(key), owner)).id, first.id);
});

test("a failure after the insert rolls back and leaves the pool usable", async () => {
  const appUrl = process.env.APP_URL;
  // The queued email needs APP_URL, so this fails after the order insert.
  process.env.APP_URL = "not a url";
  try {
    await assert.rejects(createOrder(order(), null), /APP_URL|Invalid URL/);
  } finally {
    process.env.APP_URL = appUrl;
  }
  assert.equal(await count("orders"), 0);
  // Every pooled connection must be back outside a transaction.
  await Promise.all(
    Array.from({ length: 6 }, () => createOrder(order(), null)),
  );
  assert.equal(await count("orders"), 6);
});

test("card payment is refused when no card provider is configured", async () => {
  const provider = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "stripe"; // no Stripe keys configured
  try {
    await assert.rejects(
      createOrder(order(randomUUID(), FILTER_TOTAL, { payment: "card" }), null),
      /Картовото плащане още не е свързано/,
    );
  } finally {
    process.env.PAYMENT_PROVIDER = provider;
  }
  assert.equal(await count("orders"), 0);
});

test("handing over stores the trimmed tracking number", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  const created = await createOrder(order(), null);
  const steps = [
    ["received", "confirmed"],
    ["confirmed", "preparing"],
    ["preparing", "ready"],
  ] as const;
  for (const [from, to] of steps)
    await changeOrderStatus(created.id, to, from, admin);
  const handed = await changeOrderStatus(
    created.id,
    "handed_to_courier",
    "ready",
    admin,
    "  TRK123  ",
  );
  assert.equal(handed.tracking_number, "TRK123");
});

test("changing an unknown order fails cleanly", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  await assert.rejects(
    changeOrderStatus(randomUUID(), "confirmed", "received", admin),
    /не е намерена/,
  );
});
