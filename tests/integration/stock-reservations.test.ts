import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { changeOrderStatus, createOrder } from "../../src/lib/orders";
import { recordPaymentEvent } from "../../src/lib/order-payments";
import {
  keepReservations,
  releaseExpiredReservations,
} from "../../src/lib/stock-reservations";
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

const db = setupTestDatabase();

// DEMO-003 (air filter): 18.90 EUR, 8 in stock after seeding.
const SKU = "DEMO-003";
const PRICE = 1890;
const SHIPPING = 500;

beforeEach(async () => {
  await db().pool.query(
    "TRUNCATE orders, warehouse_products, product_categories, promotions CASCADE",
  );
  const client = await db().pool.connect();
  try {
    await seedDemoCatalog(client);
  } finally {
    client.release();
  }
});

function order(quantity = 1, payment: "cod" | "card" = "cod", total?: number) {
  return {
    requestKey: randomUUID(),
    expectedTotalCents:
      total ?? PRICE * quantity + (PRICE * quantity > 3000 ? 0 : SHIPPING),
    acknowledgeTest: true,
    checkout: {
      items: [{ sku: SKU, quantity }],
      contact: {
        name: "Иван Петров",
        email: "res@example.test",
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
      payment,
    },
  };
}

async function stock() {
  const row = await db().pool.query<{ on_hand: number; reserved: number }>(
    "SELECT on_hand, reserved FROM warehouse_products WHERE sku=$1",
    [SKU],
  );
  return row.rows[0];
}

async function reservations(orderId: string) {
  const rows = await db().pool.query<{
    status: string;
    quantity: number;
    open: boolean;
  }>(
    "SELECT status, quantity, expires_at = 'infinity' AS open FROM stock_reservations WHERE order_id=$1",
    [orderId],
  );
  return rows.rows;
}

async function movements(orderId: string) {
  const rows = await db().pool.query<{ kind: string; quantity: number }>(
    "SELECT kind, quantity FROM stock_movements WHERE order_id=$1 ORDER BY created_at, kind",
    [orderId],
  );
  return rows.rows.map((r) => `${r.kind}:${r.quantity}`);
}

test("an order reserves its stock and records it in the ledger", async () => {
  const created = await createOrder(order(2), null);
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 2 });
  assert.deepEqual(await reservations(created.id), [
    { status: "active", quantity: 2, open: true },
  ]);
  assert.deepEqual(await movements(created.id), ["reserve:2"]);
});

test("two orders for the last unit: exactly one succeeds", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET on_hand=1, reserved=0 WHERE sku=$1",
    [SKU],
  );
  const results = await Promise.allSettled([
    createOrder(order(1), null),
    createOrder(order(1), null),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  assert.equal(fulfilled.length, 1);
  const rejected = results.find((r) => r.status === "rejected");
  assert.match(
    String((rejected as PromiseRejectedResult).reason),
    /Недостатъчна наличност/,
  );
  assert.deepEqual(await stock(), { on_hand: 1, reserved: 1 });
  const orders = await db().pool.query("SELECT count(*)::int AS n FROM orders");
  assert.equal(orders.rows[0].n, 1);
});

test("insufficient stock rolls the whole order back", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET on_hand=3, reserved=2 WHERE sku=$1",
    [SKU],
  );
  // The preview sees 1 free unit for an order of 1, but another order takes
  // it first: simulate by reserving it after the preview would run.
  await db().pool.query(
    "UPDATE warehouse_products SET reserved=3 WHERE sku=$1",
    [SKU],
  );
  await assert.rejects(createOrder(order(1), null), /Недостатъчна наличност/);
  const orders = await db().pool.query("SELECT count(*)::int AS n FROM orders");
  assert.equal(orders.rows[0].n, 0);
  assert.deepEqual(await stock(), { on_hand: 3, reserved: 3 });
});

test("cancelling releases the stock; handing over consumes it", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  const cancelled = await createOrder(order(2), null);
  await changeOrderStatus(cancelled.id, "cancelled", "received", admin);
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 0 });
  assert.deepEqual(await reservations(cancelled.id), [
    { status: "released", quantity: 2, open: true },
  ]);
  assert.deepEqual((await movements(cancelled.id)).sort(), [
    "release:2",
    "reserve:2",
  ]);

  const shipped = await createOrder(order(3), null);
  const steps = [
    ["received", "confirmed"],
    ["confirmed", "preparing"],
    ["preparing", "ready"],
  ] as const;
  for (const [from, to] of steps)
    await changeOrderStatus(shipped.id, to, from, admin);
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 3 });
  await changeOrderStatus(
    shipped.id,
    "handed_to_courier",
    "ready",
    admin,
    "TRK-1",
  );
  assert.deepEqual(await stock(), { on_hand: 5, reserved: 0 });
  assert.equal((await reservations(shipped.id))[0].status, "consumed");
  assert.deepEqual((await movements(shipped.id)).sort(), [
    "reserve:3",
    "sale:3",
  ]);
});

test("unpaid card orders release their stock after the payment window", async () => {
  const unpaid = await createOrder(order(1, "card"), null);
  const paid = await createOrder(order(2, "card"), null);
  assert.equal((await reservations(unpaid.id))[0].open, false);
  // The paid order keeps its stock without a deadline.
  const client = await db().pool.connect();
  try {
    await client.query("UPDATE orders SET payment_status='paid' WHERE id=$1", [
      paid.id,
    ]);
    await keepReservations(client, paid.id);
  } finally {
    client.release();
  }
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 3 });
  // Nothing is due yet.
  assert.equal(await releaseExpiredReservations(db().pool), 0);
  await db().pool.query(
    "UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id=$1",
    [unpaid.id],
  );
  assert.equal(await releaseExpiredReservations(db().pool), 1);
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 2 });
  const row = await db().pool.query(
    "SELECT status, payment_status FROM orders WHERE id=$1",
    [unpaid.id],
  );
  assert.deepEqual(row.rows[0], {
    status: "cancelled",
    payment_status: "failed",
  });
  assert.equal((await reservations(unpaid.id))[0].status, "expired");
  // Running again changes nothing.
  assert.equal(await releaseExpiredReservations(db().pool), 0);
});

test("a price change committed during checkout rejects the order", async () => {
  // An admin's price update holds the product row; the order computes its
  // total from the old price, blocks on the row inside its transaction, then
  // sees the new price. We wait until the order is actually blocked behind
  // the admin's lock, so the in-transaction check is what fires.
  const admin = await db().pool.connect();
  try {
    await admin.query("BEGIN");
    const pid = (await admin.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    await admin.query(
      "UPDATE warehouse_products SET selling_price_cents=2490 WHERE sku=$1",
      [SKU],
    );
    const pending = createOrder(order(1), null);
    const deadline = Date.now() + 10_000;
    for (;;) {
      const blocked = await db().pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
        [pid],
      );
      if (blocked.rowCount) break;
      if (Date.now() > deadline) throw new Error("order never blocked");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await admin.query("COMMIT");
    await assert.rejects(pending, /Сумата е променена/);
  } finally {
    admin.release();
  }
  const orders = await db().pool.query("SELECT count(*)::int AS n FROM orders");
  assert.equal(orders.rows[0].n, 0);
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 0 });
});

test("a payment that arrives as the window ends keeps the order", async () => {
  // The payment was recorded after the expiry job listed the order but
  // before it locked it: the job must re-check and leave the order alone.
  const order1 = await createOrder(order(1, "card"), null);
  await db().pool.query(
    "UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id=$1",
    [order1.id],
  );
  await db().pool.query("UPDATE orders SET payment_status='paid' WHERE id=$1", [
    order1.id,
  ]);
  assert.equal(await releaseExpiredReservations(db().pool), 0);
  const row = await db().pool.query("SELECT status FROM orders WHERE id=$1", [
    order1.id,
  ]);
  assert.equal(row.rows[0].status, "received");
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 1 });
});

async function orderRow(id: string) {
  const row = await db().pool.query(
    "SELECT status, payment_status FROM orders WHERE id=$1",
    [id],
  );
  return row.rows[0];
}

async function emails(id: string) {
  const rows = await db().pool.query<{ body: string }>(
    "SELECT body FROM order_email_outbox WHERE order_id=$1 ORDER BY created_at",
    [id],
  );
  return rows.rows.map((r) => r.body);
}

// A checkout session event as Stripe would send it for the order.
function stripeEvent(
  type: "checkout.session.completed" | "checkout.session.expired",
  created: { id: string; total_cents: number },
) {
  return {
    id: `evt_${randomUUID()}`,
    type,
    livemode: false,
    data: {
      object: {
        id: `cs_test_${created.id}`,
        livemode: false,
        currency: "eur",
        amount_total: created.total_cents,
        payment_status:
          type === "checkout.session.completed" ? "paid" : "unpaid",
        metadata: { orderId: created.id },
        client_reference_id: created.id,
      },
    },
  } as unknown as Parameters<typeof recordPaymentEvent>[0];
}

async function withSession(id: string) {
  await db().pool.query("UPDATE orders SET stripe_session_id=$1 WHERE id=$2", [
    `cs_test_${id}`,
    id,
  ]);
}

test("the expiry job cancels the order, records history and emails the customer", async () => {
  const unpaid = await createOrder(order(1, "card"), null);
  await db().pool.query(
    "UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id=$1",
    [unpaid.id],
  );
  assert.equal(await releaseExpiredReservations(db().pool), 1);
  const history = await db().pool.query(
    "SELECT status FROM order_history WHERE order_id=$1 ORDER BY created_at",
    [unpaid.id],
  );
  assert.deepEqual(
    history.rows.map((r) => r.status),
    ["received", "cancelled"],
  );
  assert.match(
    (await emails(unpaid.id)).at(-1) ?? "",
    /изтече и поръчката е отказана/,
  );
});

test("a Stripe payment keeps the stock; an expired session cancels the order", async () => {
  const paid = await createOrder(order(1, "card"), null);
  await withSession(paid.id);
  await recordPaymentEvent(stripeEvent("checkout.session.completed", paid));
  assert.deepEqual(await orderRow(paid.id), {
    status: "received",
    payment_status: "paid",
  });
  assert.equal((await reservations(paid.id))[0].open, true);

  const expired = await createOrder(order(2, "card"), null);
  await withSession(expired.id);
  await recordPaymentEvent(stripeEvent("checkout.session.expired", expired));
  assert.deepEqual(await orderRow(expired.id), {
    status: "cancelled",
    payment_status: "failed",
  });
  assert.equal((await reservations(expired.id))[0].status, "expired");
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 1 });
});

test("a payment for an already cancelled order keeps it cancelled and asks for a refund", async () => {
  const late = await createOrder(order(2, "card"), null);
  await withSession(late.id);
  await db().pool.query(
    "UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id=$1",
    [late.id],
  );
  assert.equal(await releaseExpiredReservations(db().pool), 1);
  await recordPaymentEvent(stripeEvent("checkout.session.completed", late));
  assert.deepEqual(await orderRow(late.id), {
    status: "cancelled",
    payment_status: "paid",
  });
  assert.equal((await reservations(late.id))[0].status, "expired");
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 0 });
  assert.match((await emails(late.id)).at(-1) ?? "", /Ще възстановим сумата/);
});

test("a multi-line order with one short line reserves nothing", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET on_hand=1 WHERE sku='DEMO-005'",
  );
  const multi = order(1);
  multi.checkout.items = [
    { sku: SKU, quantity: 2 },
    { sku: "DEMO-005", quantity: 2 },
  ];
  // 2 × 18.90 + 2 × 6.90 (sale) = 51.60 EUR, free shipping.
  multi.expectedTotalCents = 2 * PRICE + 2 * 690;
  await assert.rejects(createOrder(multi, null), /Недостатъчна наличност/);
  assert.deepEqual(await stock(), { on_hand: 8, reserved: 0 });
});

test("handover without a reservation takes the stock directly, or refuses", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  const legacy = await createOrder(order(2), null);
  // Simulate an order created before reservations existed.
  await db().pool.query("DELETE FROM stock_movements WHERE order_id=$1", [
    legacy.id,
  ]);
  await db().pool.query("DELETE FROM stock_reservations WHERE order_id=$1", [
    legacy.id,
  ]);
  await db().pool.query(
    "UPDATE warehouse_products SET reserved=0 WHERE sku=$1",
    [SKU],
  );
  const steps = [
    ["received", "confirmed"],
    ["confirmed", "preparing"],
    ["preparing", "ready"],
  ] as const;
  for (const [from, to] of steps)
    await changeOrderStatus(legacy.id, to, from, admin);
  await db().pool.query(
    "UPDATE warehouse_products SET on_hand=1 WHERE sku=$1",
    [SKU],
  );
  await assert.rejects(
    changeOrderStatus(legacy.id, "handed_to_courier", "ready", admin, "TRK-2"),
    /Недостатъчна наличност за предаване/,
  );
  await db().pool.query(
    "UPDATE warehouse_products SET on_hand=8 WHERE sku=$1",
    [SKU],
  );
  await changeOrderStatus(
    legacy.id,
    "handed_to_courier",
    "ready",
    admin,
    "TRK-2",
  );
  assert.deepEqual(await stock(), { on_hand: 6, reserved: 0 });
  assert.deepEqual(await movements(legacy.id), ["sale:2"]);
});

test("shipping reduces the inventory value at average cost", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  await db().pool.query(
    "UPDATE warehouse_products SET inventory_value_cents=8000 WHERE sku=$1",
    [SKU],
  );
  const shipped = await createOrder(order(2), null);
  const steps = [
    ["received", "confirmed"],
    ["confirmed", "preparing"],
    ["preparing", "ready"],
  ] as const;
  for (const [from, to] of steps)
    await changeOrderStatus(shipped.id, to, from, admin);
  await changeOrderStatus(
    shipped.id,
    "handed_to_courier",
    "ready",
    admin,
    "TRK-3",
  );
  const value = await db().pool.query(
    "SELECT inventory_value_cents::int AS v FROM warehouse_products WHERE sku=$1",
    [SKU],
  );
  // 8 units worth 80.00 EUR; 2 shipped at 10.00 EUR each.
  assert.equal(value.rows[0].v, 6000);
});
