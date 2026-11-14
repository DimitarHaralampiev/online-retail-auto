import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowseQuery, CatalogRepository } from "../../src/lib/catalog";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { createStaticCatalog } from "../../src/lib/catalog-static";
import { setupTestDatabase } from "./database";

// Edge cases the demo data does not contain. The reference is the static
// adapter over the products PostgreSQL lists (whose pricing and visibility
// rules are covered in catalog-postgres.test.ts), so this suite pins the
// browse filters, sorts and paging in SQL to the shared filterProducts.
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    const product = (
      sku: string,
      categorySlug: string,
      price: number,
      stock: [number, number],
      bg: [string, string],
      en?: [string, string],
    ) =>
      pool.query(
        `WITH p AS (
           INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,on_hand,reserved,category_id,status,selling_price_cents)
           SELECT $1,$5,'B','M','',$3,$4,id,'published',$2 FROM product_categories WHERE slug=$9
           RETURNING sku)
         INSERT INTO product_translations(sku,locale,name,description)
         SELECT sku,'bg',$5,$6 FROM p
         UNION ALL SELECT sku,'en',$7,$8 FROM p WHERE $7::text IS NOT NULL`,
        [
          sku,
          price,
          stock[0],
          stock[1],
          bg[0],
          bg[1],
          en?.[0] ?? null,
          en?.[1] ?? null,
          categorySlug,
        ],
      );
    // Directly in a top-level category; ties DEMO-003 on price (18.90 EUR).
    await product(
      "TOP-1",
      "parts-consumables",
      1890,
      [4, 0],
      ["Ремък", "Уникално описание"],
      ["Belt", "Unique description"],
    );
    // Fully reserved: not available.
    await product(
      "RES-1",
      "filters",
      1500,
      [2, 2],
      ["Резервиран филтър", "Описание"],
    );
    // Mixed scripts and leading spaces for name collation.
    await product(
      "MIX-1",
      "wipers",
      990,
      [3, 0],
      ["  Ъгъл", "x"],
      ["  Corner", "x"],
    );
    await product("MIX-2", "wipers", 990, [3, 0], ["Éclair", "x"]);
    await product("MIX-3", "wipers", 990, [3, 0], ["alpha", "x"]);
    // A sale equal to the current price is not a promotion.
    await pool.query(
      `INSERT INTO promotion_lines(promotion_id,sku,regular_price_cents,sale_price_cents)
       VALUES('00000000-0000-4000-8000-00000000d0e0','MIX-2',1000,990)`,
    );
    // A promotion line above the current price: the regular price applies.
    await pool.query(
      `INSERT INTO promotion_lines(promotion_id,sku,regular_price_cents,sale_price_cents)
       VALUES('00000000-0000-4000-8000-00000000d0e0','MIX-1',2000,1500)`,
    );
  },
});

let reference: CatalogRepository;
async function both(query: BrowseQuery) {
  const postgres = createPostgresCatalog(() => db().pool);
  reference ??= createStaticCatalog(
    await postgres.listProducts(),
    (await postgres.taxonomy()).map((c) => c.id),
  );
  return Promise.all([postgres.browse(query), reference.browse(query)]);
}

const queries: [string, BrowseQuery][] = [
  ["top-level product in its category", { category: "parts-consumables" }],
  ["top-level slug is not a subcategory", { subcategory: "parts-consumables" }],
  ["minimum uses the price paid", { minPriceCents: 2500 }],
  ["exact maximum is included", { maxPriceCents: 1890 }],
  ["exact minimum is included", { minPriceCents: 1890, maxPriceCents: 1890 }],
  ["bounds use the price paid", { minPriceCents: 2300, maxPriceCents: 2400 }],
  ["sale above the price is ignored", { promotions: true }],
  [
    "reserved stock is unavailable",
    { available: true, subcategory: "filters" },
  ],
  ["price ties keep listing order", { sort: "price-asc" }],
  ["price ties, descending", { sort: "price-desc", pageSize: 3, page: 2 }],
  ["description matches", { text: "уникално ОПИСАНИЕ" }],
  ["English text does not match in bg", { text: "unique description" }],
  ["name collation, bg", { sort: "name", subcategory: "wipers" }],
  ["name collation, en", { sort: "name", locale: "en", subcategory: "wipers" }],
  [
    "past the end, small total",
    { subcategory: "filters", page: 5, pageSize: 1 },
  ],
];

for (const [label, query] of queries)
  test(label, async () => {
    const [actual, expected] = await both(query);
    assert.deepEqual(
      { ...actual, items: actual.items.map((p) => p.sku) },
      { ...expected, items: expected.items.map((p) => p.sku) },
    );
    assert.deepEqual(actual.items, expected.items);
  });

test("edge fixtures behave as intended", async () => {
  const [ties] = await both({ maxPriceCents: 1890, minPriceCents: 1890 });
  // Products directly in a top-level category list before its subcategories.
  assert.deepEqual(
    ties.items.map((p) => p.sku),
    ["TOP-1", "DEMO-003"],
  );
  const [noSale] = await both({ text: "Ъгъл" });
  assert.equal(noSale.items[0].salePriceCents, undefined);
  const [names] = await both({ sort: "name", subcategory: "wipers" });
  assert.deepEqual(
    names.items.map((p) => p.sku),
    ["MIX-1", "MIX-3", "MIX-2", "DEMO-004"],
  );
  const [past] = await both({ subcategory: "filters", page: 5, pageSize: 1 });
  assert.deepEqual([past.items.length, past.total], [0, 2]);
});

test("English text matches database translations in en", async () => {
  // The static reference only knows the built-in dictionary, so this path is
  // asserted directly (localised product fields arrive with #73).
  const postgres = createPostgresCatalog(() => db().pool);
  const en = await postgres.browse({
    text: "UNIQUE description",
    locale: "en",
  });
  assert.deepEqual(
    en.items.map((p) => p.sku),
    ["TOP-1"],
  );
  const bg = await postgres.browse({ text: "unique description" });
  assert.equal(bg.total, 0);
});

test("taxonomy counts products placed directly in a top-level category", async () => {
  const postgres = createPostgresCatalog(() => db().pool);
  const parts = (await postgres.taxonomy()).find(
    (c) => c.name === "Части и консумативи",
  );
  // DEMO-003, RES-1 (filters), DEMO-004, MIX-1..3 (wipers) and TOP-1.
  assert.equal(parts?.productCount, 7);
  assert.deepEqual(
    parts?.subcategories.map((s) => [s.id, s.productCount]),
    [
      ["filters", 2],
      ["wipers", 4],
    ],
  );
});
