import assert from "node:assert/strict";
import { test } from "node:test";
import { mutateCustomerFeatures } from "../../src/lib/customer-features";
import { insertCustomer, setupTestDatabase } from "./database";

const db = setupTestDatabase();

// A product from the store catalog (static demo catalog until epic #12).
const KNOWN_SKU = "DEMO-001";

async function favorites(customerId: string): Promise<string[]> {
  const result = await db().pool.query<{ sku: string }>(
    "SELECT sku FROM customer_favorites WHERE customer_id=$1 ORDER BY sku",
    [customerId],
  );
  return result.rows.map((row) => row.sku);
}

test("favourites accept catalog products", async () => {
  const customer = await insertCustomer(db().pool);
  await mutateCustomerFeatures(customer, {
    action: "favorite",
    sku: KNOWN_SKU,
    enabled: true,
  });
  assert.deepEqual(await favorites(customer), [KNOWN_SKU]);
});

test("actions with SKUs outside the catalog are rejected without writes", async () => {
  const customer = await insertCustomer(db().pool);
  for (const action of [
    { action: "favorite", sku: "UNKNOWN", enabled: true },
    { action: "import-favorites", skus: [KNOWN_SKU, "UNKNOWN"] },
    { action: "alert", sku: "UNKNOWN", kind: "stock", enabled: true },
  ])
    await assert.rejects(
      mutateCustomerFeatures(customer, action),
      /Непознат продукт/,
      JSON.stringify(action),
    );
  assert.deepEqual(await favorites(customer), []);
  const alerts = await db().pool.query(
    "SELECT 1 FROM customer_product_alerts WHERE customer_id=$1",
    [customer],
  );
  assert.equal(alerts.rowCount, 0);
});
