import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowseQuery } from "../../src/lib/catalog";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { setupTestDatabase } from "./database";

const PRODUCTS = 10_000;
// Generous budget so the test catches pathological plans, not slow CI hosts.
const BUDGET_MS = 1500;

const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    // Spread synthetic products over the six demo subcategories; every fifth
    // is on sale and every seventh is out of stock.
    await pool.query(`
      INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,on_hand,
        category_id,status,selling_price_cents)
      SELECT 'SYN-' || lpad(i::text, 5, '0'), 'Синтетичен продукт ' || i, 'SYN',
             'M' || i, '', CASE WHEN i % 7 = 0 THEN 0 ELSE 5 END,
             (SELECT id FROM product_categories WHERE parent_id IS NOT NULL
              ORDER BY slug OFFSET (i % 6) LIMIT 1),
             'published', 500 + (i * 37) % 9500
      FROM generate_series(1, ${PRODUCTS}) AS i`);
    await pool.query(`
      INSERT INTO product_translations(sku,locale,name,description)
      SELECT sku, 'bg', name, 'Описание ' || sku FROM warehouse_products WHERE sku LIKE 'SYN-%'`);
    await pool.query(`
      INSERT INTO promotion_lines(promotion_id,sku,regular_price_cents,sale_price_cents)
      SELECT '00000000-0000-4000-8000-00000000d0e0', sku, selling_price_cents,
             selling_price_cents - 100
      FROM warehouse_products
      WHERE sku LIKE 'SYN-%' AND right(sku, 5)::int % 5 = 0 AND selling_price_cents > 600`);
    await pool.query("ANALYZE");
  },
});
const store = () => createPostgresCatalog(() => db().pool);

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await work();
  const ms = Math.round(performance.now() - started);
  console.log(`  ${label}: ${ms} ms`);
  assert.ok(ms < BUDGET_MS, `${label} took ${ms} ms`);
  return result;
}

test("common catalog queries stay within budget at 10k products", async () => {
  const queries: [string, BrowseQuery][] = [
    ["first page", {}],
    ["category", { category: "parts-consumables" }],
    ["subcategory, price sort", { subcategory: "filters", sort: "price-asc" }],
    ["text search", { text: "продукт 42" }],
    ["promotions, available", { promotions: true, available: true }],
    [
      "price range, page 20",
      { minPriceCents: 2000, maxPriceCents: 5000, page: 20 },
    ],
    ["name sort, en", { sort: "name", locale: "en", page: 50 }],
  ];
  for (const [label, query] of queries)
    await timed(label, () => store().browse(query));
  await timed("taxonomy", () => store().taxonomy());
  await timed("getProducts(100)", () =>
    store().getProducts(
      Array.from(
        { length: 100 },
        (_, i) => `SYN-${String(i * 97 + 1).padStart(5, "0")}`,
      ),
    ),
  );
});

test("paging through a filtered result returns every match exactly once", async () => {
  const query: BrowseQuery = {
    subcategory: "filters",
    sort: "price-desc",
    pageSize: 96,
  };
  const first = await store().browse(query);
  const seen = new Set<string>();
  for (let page = 1; page <= first.pageCount; page++)
    for (const product of (await store().browse({ ...query, page })).items) {
      assert.equal(seen.has(product.sku), false, `duplicate ${product.sku}`);
      seen.add(product.sku);
    }
  assert.equal(seen.size, first.total);
  const expected = await db().pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM warehouse_products w
     JOIN product_categories c ON c.id = w.category_id
     WHERE c.slug = 'filters' AND w.status = 'published'`,
  );
  assert.equal(first.total, expected.rows[0].n);
});

test("taxonomy counts add up to every published product", async () => {
  const taxonomy = await store().taxonomy();
  const total = taxonomy.reduce((sum, c) => sum + c.productCount, 0);
  const published = await db().pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM warehouse_products WHERE status = 'published'",
  );
  assert.equal(total, published.rows[0].n);
  for (const category of taxonomy)
    assert.equal(
      category.subcategories.reduce((sum, s) => sum + s.productCount, 0),
      category.productCount,
    );
});

test("a page past the end is empty but reports the real total", async () => {
  const page = await store().browse({ subcategory: "wipers", page: 10_000 });
  assert.deepEqual(page.items, []);
  assert.ok(page.total > 1000);
});
