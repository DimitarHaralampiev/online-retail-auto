import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Product } from "../../src/lib/catalog";
import { demoCategories, demoProducts } from "../../src/lib/catalog-demo-data";
import {
  createPostgresCatalog,
  FALLBACK_PRODUCT_IMAGE,
  MAX_PRODUCTS_PER_LOOKUP,
} from "../../src/lib/catalog-postgres";
import { DEMO_PROMOTION_ID, seedDemoCatalog } from "../../src/lib/catalog-seed";
import { createStaticCatalog } from "../../src/lib/catalog-static";
import { setupTestDatabase } from "./database";

const db = setupTestDatabase();
const store = () => createPostgresCatalog(() => db().pool);

// The seed stores the demo's available stock with nothing reserved.
const seededDemo: Product[] = demoProducts.map((p) => ({
  ...p,
  stock: { onHand: p.stock.onHand - p.stock.reserved, reserved: 0 },
}));
const reference = createStaticCatalog(
  seededDemo,
  demoCategories.map((c) => c.id),
);

beforeEach(async () => {
  await db().pool.query(
    "TRUNCATE warehouse_products, product_categories, promotions CASCADE",
  );
  const client = await db().pool.connect();
  try {
    await seedDemoCatalog(client);
  } finally {
    client.release();
  }
});

test("returns the same products and taxonomy as the static demo catalog", async () => {
  assert.deepEqual(
    await store().listProducts(),
    await reference.listProducts(),
  );
  assert.deepEqual(await store().taxonomy(), await reference.taxonomy());
});

test("finds products by SKU in request order and skips unknown ones", async () => {
  assert.deepEqual(
    (
      await store().getProducts(["DEMO-005", "NOPE", "DEMO-001", "DEMO-005"])
    ).map((p) => p.sku),
    ["DEMO-005", "DEMO-001", "DEMO-005"],
  );
  assert.deepEqual(await store().getProducts([]), []);
  assert.deepEqual(
    await store().getProduct("DEMO-003"),
    await reference.getProduct("DEMO-003"),
  );
  assert.equal(await store().getProduct("NOPE"), null);
  await assert.rejects(
    store().getProducts(
      Array.from({ length: MAX_PRODUCTS_PER_LOOKUP + 1 }, (_, i) => `SKU-${i}`),
    ),
    /at most/,
  );
});

test("hides unpublished products and products in inactive categories", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET status='draft' WHERE sku='DEMO-002'",
  );
  await db().pool.query(
    "UPDATE product_categories SET active=false WHERE slug='car-care'",
  );
  const skus = (await store().listProducts()).map((p) => p.sku);
  assert.deepEqual(skus, ["DEMO-001", "DEMO-003", "DEMO-004"]);
  assert.equal(await store().getProduct("DEMO-002"), null);
  assert.deepEqual(
    (await store().taxonomy()).map((c) => c.name),
    ["Автоаксесоари", "Части и консумативи"],
  );
});

test("sale prices come only from live promotions, lowest price wins", async () => {
  const sale = async (sku: string) =>
    (await store().getProduct(sku))?.salePriceCents;
  assert.equal(await sale("DEMO-001"), 2390);

  // A second live promotion with a lower price wins.
  await db().pool.query(
    `INSERT INTO promotions(id,name,status) VALUES(gen_random_uuid(),'Flash','active') RETURNING id`,
  );
  await db().pool.query(
    `INSERT INTO promotion_lines(promotion_id,sku,regular_price_cents,sale_price_cents)
     SELECT id,'DEMO-001',2990,1990 FROM promotions WHERE name='Flash'`,
  );
  assert.equal(await sale("DEMO-001"), 1990);

  // Not yet started and already ended promotions do not apply.
  await db().pool.query(
    "UPDATE promotions SET starts_at=now()+interval '1 day' WHERE name='Flash'",
  );
  assert.equal(await sale("DEMO-001"), 2390);
  await db().pool.query("UPDATE promotions SET status='ended' WHERE id=$1", [
    DEMO_PROMOTION_ID,
  ]);
  assert.equal(await sale("DEMO-001"), undefined);

  // A "sale" at or above the regular price is ignored.
  await db().pool.query(
    "UPDATE warehouse_products SET selling_price_cents=1100 WHERE sku='DEMO-002'",
  );
  await db().pool.query("UPDATE promotions SET status='active' WHERE id=$1", [
    DEMO_PROMOTION_ID,
  ]);
  assert.equal(await sale("DEMO-002"), undefined);
});

test("uses translated names and a fallback image when none is set", async () => {
  await db().pool.query(
    "UPDATE product_translations SET name='Нов органайзер' WHERE sku='DEMO-001' AND locale='bg'",
  );
  await db().pool.query(
    "UPDATE warehouse_products SET image_path=NULL WHERE sku='DEMO-001'",
  );
  const product = await store().getProduct("DEMO-001");
  assert.equal(product?.name, "Нов органайзер");
  assert.equal(product?.image, FALLBACK_PRODUCT_IMAGE);
});

test("reflects stock changes immediately", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET on_hand=7, reserved=2 WHERE sku='DEMO-003'",
  );
  assert.deepEqual((await store().getProduct("DEMO-003"))?.stock, {
    onHand: 7,
    reserved: 2,
  });
});

test("hides products in an inactive subcategory and products without a price", async () => {
  await db().pool.query(
    "UPDATE product_categories SET active=false WHERE slug='filters'",
  );
  await db().pool.query(
    "UPDATE warehouse_products SET selling_price_cents=NULL WHERE sku='DEMO-002'",
  );
  const skus = (await store().listProducts()).map((p) => p.sku);
  assert.deepEqual(skus, ["DEMO-001", "DEMO-004", "DEMO-005", "DEMO-006"]);
});

test("promotions past their end date and sales equal to the price do not apply", async () => {
  await db().pool.query(
    "UPDATE promotions SET ends_at=now()-interval '1 minute' WHERE id=$1",
    [DEMO_PROMOTION_ID],
  );
  assert.equal(
    (await store().getProduct("DEMO-001"))?.salePriceCents,
    undefined,
  );
  await db().pool.query("UPDATE promotions SET ends_at=NULL WHERE id=$1", [
    DEMO_PROMOTION_ID,
  ]);
  // DEMO-002 is on sale for 11.90 EUR; a regular price of 11.90 removes the sale.
  await db().pool.query(
    "UPDATE warehouse_products SET selling_price_cents=1190 WHERE sku='DEMO-002'",
  );
  assert.equal(
    (await store().getProduct("DEMO-002"))?.salePriceCents,
    undefined,
  );
});

test("accepts exactly the maximum number of SKUs per lookup", async () => {
  const skus = Array.from({ length: MAX_PRODUCTS_PER_LOOKUP }, (_, i) =>
    i === 0 ? "DEMO-001" : `SKU-${i}`,
  );
  assert.deepEqual(
    (await store().getProducts(skus)).map((p) => p.sku),
    ["DEMO-001"],
  );
});

test("orders products within a subcategory by SKU and excludes deeper categories", async () => {
  await db().pool.query(
    `INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,category_id,status,selling_price_cents)
     SELECT 'DEMO-0035','Втори филтър','B','M','',id,'published',990 FROM product_categories WHERE slug='filters'`,
  );
  await db().pool.query(
    `INSERT INTO product_categories(id,slug,parent_id,active)
     SELECT gen_random_uuid(),'too-deep',id,true FROM product_categories WHERE slug='filters'`,
  );
  await db().pool.query(
    `INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,category_id,status,selling_price_cents)
     SELECT 'DEEP-1','Дълбок','B','M','',id,'published',990 FROM product_categories WHERE slug='too-deep'`,
  );
  const skus = (await store().listProducts()).map((p) => p.sku);
  assert.deepEqual(skus.slice(2, 5), ["DEMO-003", "DEMO-0035", "DEMO-004"]);
  assert.equal(skus.includes("DEEP-1"), false);
});

test("falls back to the English category name before the slug", async () => {
  await db().pool.query(
    `DELETE FROM category_translations WHERE locale='bg'
     AND category_id IN (SELECT id FROM product_categories WHERE slug IN ('car-care','washing'))`,
  );
  const shampoo = await store().getProduct("DEMO-005");
  assert.deepEqual(shampoo?.category, { id: "car-care", name: "Car care" });
  assert.deepEqual(shampoo?.subcategory, {
    id: "washing",
    name: "Washing & cleaners",
  });
  assert.equal((await store().taxonomy()).at(-1)?.name, "Car care");
});

test("in English, names come from English translations and match the static catalog", async () => {
  const en = createPostgresCatalog(() => db().pool, "en");
  const referenceEn = createStaticCatalog(
    seededDemo,
    demoCategories.map((c) => c.id),
    "en",
  );
  assert.deepEqual(await en.listProducts(), await referenceEn.listProducts());
  assert.deepEqual(await en.taxonomy(), await referenceEn.taxonomy());
  const filter = await en.getProduct("DEMO-003");
  assert.equal(filter?.name, "Air filter");
  assert.deepEqual(filter?.category, {
    id: "parts-consumables",
    name: "Parts and consumables",
  });
  assert.deepEqual(filter?.subcategory, { id: "filters", name: "Filters" });
});

test("in English, a product without an English translation falls back to Bulgarian", async () => {
  await db().pool.query(
    "DELETE FROM product_translations WHERE sku='DEMO-001' AND locale='en'",
  );
  const en = createPostgresCatalog(() => db().pool, "en");
  assert.equal(
    (await en.getProduct("DEMO-001"))?.name,
    "Органайзер за багажник",
  );
});
