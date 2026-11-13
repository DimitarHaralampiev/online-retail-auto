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
const reference = createStaticCatalog(seededDemo, demoCategories);

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
    (await store().getProduct(sku))?.demoSalePriceCents;
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
