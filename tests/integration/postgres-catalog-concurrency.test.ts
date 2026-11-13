import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { mutateCustomerFeatures } from "../../src/lib/customer-features";
import { scanCustomerNotifications } from "../../src/lib/customer-notifications";
import { insertCustomer, setupTestDatabase } from "./database";

// With the PostgreSQL catalog, code that awaits the catalog while holding a
// transaction would need a second pool connection; more concurrent callers
// than pool connections (5) would then deadlock the pool.
Object.assign(process.env, {
  CATALOG_SOURCE: "postgres",
  APP_URL: "http://localhost:3000",
});
const db = setupTestDatabase();
const CALLERS = 8;

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

async function customerWithAlerts(): Promise<string> {
  const id = await insertCustomer(db().pool);
  await db().pool.query(
    `UPDATE customers SET notification_preferences='{"stock":true,"price":false,"reminders":false}' WHERE id=$1`,
    [id],
  );
  for (const [sku, kind] of [
    ["DEMO-001", "price"],
    ["DEMO-003", "stock"],
  ])
    await db().pool.query(
      "INSERT INTO customer_product_alerts(id,customer_id,sku,kind,last_price_cents) VALUES($1,$2,$3,$4,9999)",
      [randomUUID(), id, sku, kind],
    );
  return id;
}

function withinSeconds<T>(seconds: number, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("pool deadlock")), seconds * 1000),
    ),
  ]);
}

test("concurrent price-alert enabling does not exhaust the pool", async () => {
  const customers = await Promise.all(
    Array.from({ length: CALLERS }, customerWithAlerts),
  );
  await withinSeconds(
    8,
    Promise.all(
      customers.map((id) =>
        mutateCustomerFeatures(id, {
          action: "preferences",
          preferences: { price: true, stock: true, reminders: false },
        }),
      ),
    ),
  );
  const baselines = await db().pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM customer_product_alerts WHERE kind='price' AND last_price_cents=2390",
  );
  assert.equal(baselines.rows[0].n, CALLERS);
});

test("concurrent notification scans do not exhaust the pool", async () => {
  const customers = await Promise.all(
    Array.from({ length: CALLERS }, customerWithAlerts),
  );
  const queued = await withinSeconds(
    8,
    Promise.all(
      customers.map((id) =>
        scanCustomerNotifications(undefined, "2026-11-13", id),
      ),
    ),
  );
  // Each customer's in-stock alert for DEMO-003 is reported once.
  assert.deepEqual(queued, Array(CALLERS).fill(1));
});
