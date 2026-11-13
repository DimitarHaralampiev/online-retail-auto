import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { createOrder } from "../../src/lib/orders";
import { setupTestDatabase } from "./database";

// Orders priced and checked through the PostgreSQL catalog adapter.
Object.assign(process.env, {
  CATALOG_SOURCE: "postgres",
  ORDERS_MODE: "test",
  TEST_SHIPPING_CENTS: "500",
  FREE_SHIPPING_ABOVE_CENTS: "3000",
  APP_URL: "http://localhost:3000",
  PAYMENT_PROVIDER: "simulator",
  ORDER_TRACKING_SECRET: "b".repeat(64),
});

const db = setupTestDatabase();

// beforeEach runs after the database hook; seed once for the whole file.
let seeded = false;
beforeEach(async () => {
  if (seeded) return;
  seeded = true;
  const client = await db().pool.connect();
  try {
    await seedDemoCatalog(client);
  } finally {
    client.release();
  }
});

function order(sku: string, quantity: number, expectedTotalCents: number) {
  return {
    requestKey: randomUUID(),
    expectedTotalCents,
    acknowledgeTest: true,
    checkout: {
      items: [{ sku, quantity }],
      contact: {
        name: "Иван Петров",
        email: "pg@example.test",
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
  };
}

test("orders use prices from the database", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET selling_price_cents=2000 WHERE sku='DEMO-003'",
  );
  const created = await createOrder(order("DEMO-003", 1, 2500), null);
  assert.equal(created.subtotal_cents, 2000);
  assert.deepEqual(
    created.lines.map((l: { sku: string; unitPriceCents: number }) => [
      l.sku,
      l.unitPriceCents,
    ]),
    [["DEMO-003", 2000]],
  );
});

test("orders use live promotions and database stock", async () => {
  // DEMO-001 sells at the demo promotion price of 23.90 EUR.
  const created = await createOrder(order("DEMO-001", 1, 2890), null);
  assert.equal(created.subtotal_cents, 2390);
  await db().pool.query(
    "UPDATE warehouse_products SET on_hand=0, reserved=0 WHERE sku='DEMO-005'",
  );
  await assert.rejects(
    createOrder(order("DEMO-005", 1, 1190), null),
    /Недостатъчна наличност/,
  );
});

test("unpublished products cannot be ordered", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET status='archived' WHERE sku='DEMO-002'",
  );
  await assert.rejects(
    createOrder(order("DEMO-002", 1, 1690), null),
    /непознат продукт/,
  );
});
