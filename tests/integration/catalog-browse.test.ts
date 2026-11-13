import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowseQuery, Product } from "../../src/lib/catalog";
import { demoCategories, demoProducts } from "../../src/lib/catalog-demo-data";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { createStaticCatalog } from "../../src/lib/catalog-static";
import { setupTestDatabase } from "./database";

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
const postgres = () => createPostgresCatalog(() => db().pool);
// The seed stores the demo's available stock with nothing reserved.
const reference = createStaticCatalog(
  demoProducts.map((p): Product => ({
    ...p,
    stock: { onHand: p.stock.onHand - p.stock.reserved, reserved: 0 },
  })),
  demoCategories,
);

const queries: BrowseQuery[] = [
  {},
  { category: "Автоаксесоари" },
  { category: "Части и консумативи", subcategory: "filters" },
  { subcategory: "washing" },
  { text: "филтър" },
  { text: "FILTER", locale: "en" },
  { text: "filter", locale: "bg" },
  { text: "demo-00" },
  { minPriceCents: 1000, maxPriceCents: 2000 },
  { minPriceCents: 2390 },
  { available: true },
  { promotions: true },
  { promotions: true, sort: "price-desc" },
  { compatibleSkus: ["DEMO-006", "DEMO-002", "NOPE"] },
  { compatibleSkus: [] },
  { sort: "price-asc" },
  { sort: "price-desc" },
  { sort: "name" },
  { sort: "name", locale: "en" },
  { pageSize: 4 },
  { pageSize: 4, page: 2 },
  { pageSize: 4, page: 3 },
  { pageSize: 2, page: 2, sort: "price-asc", available: true },
  // Hostile or malformed input must not reach SQL in a form it cannot type.
  { minPriceCents: Number.NaN },
  { maxPriceCents: Number.POSITIVE_INFINITY },
  { minPriceCents: 1890.5 },
  { minPriceCents: 3e9 },
  { maxPriceCents: -10 },
  { page: Number.NaN },
  { pageSize: Number.POSITIVE_INFINITY },
  { page: 1e20 },
  { text: "  филтър  " },
  { text: "ФИЛТЪР" },
  { sort: "bogus" as BrowseQuery["sort"] },
  { locale: "de" as BrowseQuery["locale"], text: "filter" },
];

for (const query of queries)
  test(`PostgreSQL browse matches the static catalog: ${JSON.stringify(query)}`, async () => {
    const [actual, expected] = await Promise.all([
      postgres().browse(query),
      reference.browse(query),
    ]);
    assert.deepEqual(
      { ...actual, items: actual.items.map((p) => p.sku) },
      { ...expected, items: expected.items.map((p) => p.sku) },
    );
    assert.deepEqual(actual.items, expected.items);
  });

test("paging input is clamped", async () => {
  const page = await postgres().browse({ page: -3, pageSize: 10_000 });
  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 96);
  assert.equal(page.items.length, 6);
});

test("text with SQL wildcards and quotes is matched literally", async () => {
  for (const text of ["%", "_", "'", "\\", "' OR 1=1 --"])
    assert.equal((await postgres().browse({ text })).total, 0, text);
});
