import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { changeOrderStatus, createOrder } from "../../src/lib/orders";
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
  // total from the old price, waits for the row, then sees the new price.
  const admin = await db().pool.connect();
  try {
    await admin.query("BEGIN");
    await admin.query(
      "UPDATE warehouse_products SET selling_price_cents=2490 WHERE sku=$1",
      [SKU],
    );
    const pending = createOrder(order(1), null);
    // Let the order reach the locked row, then commit the price change.
    await new Promise((resolve) => setTimeout(resolve, 300));
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
