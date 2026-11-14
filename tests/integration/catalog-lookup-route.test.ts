import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../../src/app/api/catalog/products/route";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { setupTestDatabase } from "./database";

process.env.CATALOG_SOURCE = "postgres";
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
  },
});

const get = (query: string) =>
  GET(new Request(`http://localhost/api/catalog/products${query}`));

test("returns published products for the requested SKUs in order", async () => {
  const response = await get("?sku=DEMO-005&sku=NOPE&sku=DEMO-001");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(
    body.products.map((p: { sku: string }) => p.sku),
    ["DEMO-005", "DEMO-001"],
  );
  assert.equal(body.products[1].salePriceCents, 2390);
});

test("hides unpublished products", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET status='draft' WHERE sku='DEMO-002'",
  );
  const body = await (await get("?sku=DEMO-002")).json();
  assert.deepEqual(body.products, []);
});

test("rejects malformed or oversized requests", async () => {
  assert.equal((await get("?sku=")).status, 400);
  const many = Array.from({ length: 101 }, (_, i) => `sku=S${i}`).join("&");
  assert.equal((await get(`?${many}`)).status, 400);
  assert.equal((await get("")).status, 200);
});
