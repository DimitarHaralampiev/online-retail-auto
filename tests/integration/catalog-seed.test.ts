import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Product } from "../../src/lib/catalog";
import { demoProducts } from "../../src/lib/catalog-demo-data";
import { DEMO_PROMOTION_ID, seedDemoCatalog } from "../../src/lib/catalog-seed";
import { setupTestDatabase } from "./database";

const db = setupTestDatabase();

// Every test starts from an empty catalog.
beforeEach(async () => {
  await db().pool.query(
    "TRUNCATE warehouse_products, product_categories, promotions CASCADE",
  );
});

async function seed(products?: readonly Product[]) {
  const client = await db().pool.connect();
  try {
    return await seedDemoCatalog(client, products);
  } finally {
    client.release();
  }
}

async function count(sql: string): Promise<number> {
  return (await db().pool.query<{ n: number }>(sql)).rows[0].n;
}

test("loads every demo product as a published demo row with price, stock and image", async () => {
  const summary = await seed();
  assert.equal(summary.products, demoProducts.length);
  assert.equal(summary.insertedProducts, demoProducts.length);
  const rows = await db().pool.query(
    `SELECT sku,status,is_demo,selling_price_cents,on_hand,reserved,image_path
     FROM warehouse_products ORDER BY sku`,
  );
  assert.deepEqual(
    rows.rows,
    demoProducts.map((p) => ({
      sku: p.sku,
      status: "published",
      is_demo: true,
      selling_price_cents: p.priceCents,
      // Seeded as the demo's available stock with nothing reserved.
      on_hand: p.stock.onHand - p.stock.reserved,
      reserved: 0,
      image_path: p.image,
    })),
  );
});

test("builds the category tree with Bulgarian and English names", async () => {
  await seed();
  const tree = await db().pool.query(
    `SELECT c.slug, p.slug AS parent, bg.name AS bg, en.name AS en
     FROM product_categories c
     LEFT JOIN product_categories p ON p.id=c.parent_id
     JOIN category_translations bg ON bg.category_id=c.id AND bg.locale='bg'
     JOIN category_translations en ON en.category_id=c.id AND en.locale='en'
     WHERE c.slug IN ('car-accessories','filters')
     ORDER BY c.slug`,
  );
  assert.deepEqual(tree.rows, [
    {
      slug: "car-accessories",
      parent: null,
      bg: "Автоаксесоари",
      en: "Car accessories",
    },
    {
      slug: "filters",
      parent: "parts-consumables",
      bg: "Филтри",
      en: "Filters",
    },
  ]);
  // Each product sits in its subcategory.
  const placement = await db().pool.query(
    `SELECT w.sku, c.slug FROM warehouse_products w
     JOIN product_categories c ON c.id=w.category_id WHERE w.sku='DEMO-003'`,
  );
  assert.deepEqual(placement.rows, [{ sku: "DEMO-003", slug: "filters" }]);
});

test("stores product translations and the demo promotion's sale prices", async () => {
  await seed();
  const names = await db().pool.query(
    "SELECT locale,name,description FROM product_translations WHERE sku='DEMO-001' ORDER BY locale",
  );
  assert.deepEqual(names.rows, [
    {
      locale: "bg",
      name: "Органайзер за багажник",
      description: "Място за всичко необходимо по пътя.",
    },
    {
      locale: "en",
      name: "Trunk organizer",
      description: "Room for everything you need on the road.",
    },
  ]);
  const lines = await db().pool.query(
    `SELECT l.sku,l.regular_price_cents,l.sale_price_cents,p.status
     FROM promotion_lines l JOIN promotions p ON p.id=l.promotion_id
     WHERE l.promotion_id=$1 ORDER BY l.sku`,
    [DEMO_PROMOTION_ID],
  );
  assert.deepEqual(
    lines.rows,
    demoProducts
      .filter((p) => p.salePriceCents !== undefined)
      .map((p) => ({
        sku: p.sku,
        regular_price_cents: p.priceCents,
        sale_price_cents: p.salePriceCents,
        status: "active",
      })),
  );
});

test("re-seeding is idempotent and never resets stock changed since", async () => {
  await seed();
  const counts = async () => ({
    products: await count("SELECT count(*)::int AS n FROM warehouse_products"),
    categories: await count(
      "SELECT count(*)::int AS n FROM product_categories",
    ),
    translations: await count(
      "SELECT count(*)::int AS n FROM product_translations",
    ),
    movements: await count("SELECT count(*)::int AS n FROM stock_movements"),
    lines: await count("SELECT count(*)::int AS n FROM promotion_lines"),
  });
  const before = await counts();
  await db().pool.query(
    "UPDATE warehouse_products SET on_hand=99 WHERE sku='DEMO-003'",
  );
  const second = await seed();
  assert.equal(second.insertedProducts, 0);
  assert.deepEqual(await counts(), before);
  const stock = await db().pool.query(
    "SELECT on_hand FROM warehouse_products WHERE sku='DEMO-003'",
  );
  assert.equal(stock.rows[0].on_hand, 99);
});

test("initial stock is recorded once in the movement ledger", async () => {
  await seed();
  await seed();
  const movements = await db().pool.query(
    "SELECT sku,kind,quantity FROM stock_movements WHERE reference_key LIKE 'demo-seed:%' ORDER BY sku",
  );
  assert.deepEqual(
    movements.rows,
    demoProducts
      .filter((p) => p.stock.onHand - p.stock.reserved > 0)
      .map((p) => ({
        sku: p.sku,
        kind: "receipt",
        quantity: p.stock.onHand - p.stock.reserved,
      })),
  );
});

test("refuses to overwrite a real product with a demo SKU and rolls back", async () => {
  // A real (non-demo) product that happens to use a demo SKU.
  await db().pool.query(
    `INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,selling_price_cents,is_demo)
     VALUES('DEMO-004','Real wipers','Bosch','A1','',1500,false)
     ON CONFLICT(sku) DO UPDATE SET name='Real wipers', brand='Bosch',
       selling_price_cents=1500, is_demo=false`,
  );
  await db().pool.query("DELETE FROM product_translations");
  await assert.rejects(seed(), /DEMO-004 belongs to a real product/);
  const real = await db().pool.query(
    "SELECT name,is_demo,selling_price_cents FROM warehouse_products WHERE sku='DEMO-004'",
  );
  assert.deepEqual(real.rows, [
    { name: "Real wipers", is_demo: false, selling_price_cents: 1500 },
  ]);
  // The whole seed rolled back: no translations were written in this run.
  assert.equal(
    await count("SELECT count(*)::int AS n FROM product_translations"),
    0,
  );
});

test("refuses to take over a real category with a demo slug and rolls back", async () => {
  await db().pool.query(
    "INSERT INTO product_categories(id,slug,active,is_demo) VALUES(gen_random_uuid(),'filters',false,false)",
  );
  await assert.rejects(seed(), /slug filters belongs to a real category/);
  const real = await db().pool.query(
    "SELECT parent_id,active,is_demo FROM product_categories WHERE slug='filters'",
  );
  assert.deepEqual(real.rows, [
    { parent_id: null, active: false, is_demo: false },
  ]);
  assert.equal(
    await count("SELECT count(*)::int AS n FROM warehouse_products"),
    0,
  );
});

test("re-seeding refreshes changed demo content and drops removed sale prices", async () => {
  await seed();
  const changed = demoProducts.map((p) =>
    p.sku === "DEMO-001"
      ? { ...p, priceCents: 3190, salePriceCents: undefined }
      : p.sku === "DEMO-003"
        ? { ...p, description: "Филтър за въздух.", salePriceCents: 1590 }
        : p,
  );
  // Use dictionary strings so the English check passes.
  changed[2] = { ...changed[2], description: "Филтри" };
  await seed(changed);
  const prices = await db().pool.query(
    "SELECT sku,selling_price_cents FROM warehouse_products WHERE sku IN ('DEMO-001','DEMO-003') ORDER BY sku",
  );
  assert.deepEqual(prices.rows, [
    { sku: "DEMO-001", selling_price_cents: 3190 },
    { sku: "DEMO-003", selling_price_cents: 1890 },
  ]);
  const lines = await db().pool.query(
    "SELECT sku,sale_price_cents FROM promotion_lines ORDER BY sku",
  );
  assert.deepEqual(
    lines.rows.map((r) => r.sku),
    ["DEMO-002", "DEMO-003", "DEMO-005"],
  );
  assert.equal(lines.rows[1].sale_price_cents, 1590);
  const text = await db().pool.query(
    "SELECT locale,description FROM product_translations WHERE sku='DEMO-003' ORDER BY locale",
  );
  assert.deepEqual(text.rows, [
    { locale: "bg", description: "Филтри" },
    { locale: "en", description: "Filters" },
  ]);
});

test("re-seeding keeps an archived product archived and an ended promotion ended", async () => {
  await seed();
  await db().pool.query(
    "UPDATE warehouse_products SET status='archived' WHERE sku='DEMO-002'",
  );
  await db().pool.query("UPDATE promotions SET status='ended' WHERE id=$1", [
    DEMO_PROMOTION_ID,
  ]);
  await seed();
  const product = await db().pool.query(
    "SELECT status FROM warehouse_products WHERE sku='DEMO-002'",
  );
  const promotion = await db().pool.query(
    "SELECT status FROM promotions WHERE id=$1",
    [DEMO_PROMOTION_ID],
  );
  assert.equal(product.rows[0].status, "archived");
  assert.equal(promotion.rows[0].status, "ended");
});

test("fails without writing when a demo string has no English translation", async () => {
  const untranslated = demoProducts.map((p, i) =>
    i === 0 ? { ...p, description: "Непреведено описание" } : p,
  );
  await assert.rejects(seed(untranslated), /Missing English translation/);
  assert.equal(
    await count("SELECT count(*)::int AS n FROM warehouse_products"),
    0,
  );
});

test("image paths must be local /images files", async () => {
  await seed();
  for (const path of [
    "//evil.example/x.png",
    "/images/../api/admin.png",
    "/images/./x.png",
    "/other/x.png",
    "/images/x.svg",
    "http://example.com/images/x.png",
  ])
    await assert.rejects(
      db().pool.query(
        "UPDATE warehouse_products SET image_path=$1 WHERE sku='DEMO-001'",
        [path],
      ),
      /warehouse_products_image_path_local/,
      path,
    );
  await db().pool.query(
    "UPDATE warehouse_products SET image_path='/images/parts/air_filter-2.webp' WHERE sku='DEMO-001'",
  );
});
