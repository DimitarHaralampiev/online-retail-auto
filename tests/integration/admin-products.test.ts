import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdminProductError,
  createProduct,
  getAdminProduct,
  listAdminCategories,
  listAdminProducts,
  productHistory,
  productInputSchema,
  setProductStatus,
  updateProduct,
  type ProductInput,
} from "../../src/lib/admin-products";
import { adminProductError } from "../../src/lib/admin-product-http";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { insertCustomer, setupTestDatabase } from "./database";

let adminId = "";
let categoryId = "";
let subcategoryId = "";
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    adminId = await insertCustomer(pool, { isAdmin: true });
    const ids = await pool.query<{ id: string; parent_id: string | null }>(
      "SELECT id,parent_id FROM product_categories WHERE slug IN ('parts-consumables') OR parent_id IS NOT NULL ORDER BY parent_id NULLS FIRST",
    );
    categoryId = ids.rows[0].id;
    subcategoryId =
      ids.rows.find((r) => r.parent_id !== null)?.id ?? ids.rows[0].id;
  },
});

const input = (overrides: Partial<ProductInput> = {}): ProductInput =>
  productInputSchema.parse({
    name: { bg: "Спирачни накладки", en: "Brake pads" },
    description: { bg: "Предни накладки", en: "Front pads" },
    categoryId,
    brand: "Bosch",
    priceCents: 4590,
    ...overrides,
  });

const rejects = async (
  promise: Promise<unknown>,
  status: number,
  pattern: RegExp,
) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminProductError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
};

test("creates a draft without stock, with translations, price history and audit", async () => {
  const { pool } = db();
  const product = await createProduct(pool, adminId, "BRK-100", input());
  assert.equal(product.status, "draft");
  assert.equal(product.onHand, 0);
  assert.equal(product.version, 1);
  assert.deepEqual(product.name, { bg: "Спирачни накладки", en: "Brake pads" });
  const prices = await pool.query(
    "SELECT gross_price_cents,source,actor_id FROM product_price_history WHERE sku='BRK-100'",
  );
  assert.deepEqual(prices.rows, [
    { gross_price_cents: 4590, source: "admin", actor_id: adminId },
  ]);
  const history = await productHistory(pool, "BRK-100");
  assert.equal(history[0].action, "product.create");
  // Drafts never reach the storefront.
  assert.equal(
    await createPostgresCatalog(() => pool).getProduct("BRK-100"),
    null,
  );
});

test("refuses a duplicate code and an unknown or too-deep category", async () => {
  const { pool } = db();
  await rejects(
    createProduct(pool, adminId, "BRK-100", input()),
    409,
    /вече съществува/,
  );
  await rejects(
    createProduct(
      pool,
      adminId,
      "BRK-101",
      input({ categoryId: "00000000-0000-4000-8000-000000000000" }),
    ),
    400,
    /Непозната категория/,
  );
  const deep = await pool.query<{ id: string }>(
    "INSERT INTO product_categories(id,slug,parent_id) VALUES(gen_random_uuid(),'too-deep',$1) RETURNING id",
    [subcategoryId],
  );
  if (subcategoryId !== categoryId)
    await rejects(
      createProduct(
        pool,
        adminId,
        "BRK-102",
        input({ categoryId: deep.rows[0].id }),
      ),
      400,
      /Непозната категория/,
    );
  assert.equal(await getAdminProduct(pool, "BRK-101"), null);
});

test("publishing needs a price and an active category, then shows it to shoppers", async () => {
  const { pool } = db();
  const draft = await createProduct(
    pool,
    adminId,
    "BRK-200",
    input({ priceCents: null, categoryId: null }),
  );
  await rejects(
    setProductStatus(pool, adminId, "BRK-200", draft.version, "published"),
    400,
    /Липсва продажна цена\. Липсва категория\./,
  );
  const priced = await updateProduct(
    pool,
    adminId,
    "BRK-200",
    draft.version,
    input(),
  );
  assert.equal(priced.version, draft.version + 1);
  const published = await setProductStatus(
    pool,
    adminId,
    "BRK-200",
    priced.version,
    "published",
  );
  assert.equal(published.status, "published");
  const shown = await createPostgresCatalog(() => pool, "en").getProduct(
    "BRK-200",
  );
  assert.equal(shown?.name, "Brake pads");
  assert.equal(shown?.priceCents, 4590);
  const actions = (await productHistory(pool, "BRK-200")).map((h) => h.action);
  assert.deepEqual(actions, [
    "product.status",
    "product.update",
    "product.create",
  ]);
});

test("a published product cannot lose its price or category", async () => {
  const { pool } = db();
  const product = (await getAdminProduct(pool, "BRK-200"))!;
  await rejects(
    updateProduct(
      pool,
      adminId,
      "BRK-200",
      product.version,
      input({ priceCents: null }),
    ),
    400,
    /трябва да остане видим/,
  );
  await pool.query("UPDATE product_categories SET active=false WHERE id=$1", [
    subcategoryId,
  ]);
  try {
    await rejects(
      updateProduct(
        pool,
        adminId,
        "BRK-200",
        product.version,
        input({ categoryId: subcategoryId }),
      ),
      400,
      /Категорията не е активна/,
    );
  } finally {
    await pool.query("UPDATE product_categories SET active=true WHERE id=$1", [
      subcategoryId,
    ]);
  }
});

test("a published product stays editable after its category is deactivated", async () => {
  const { pool } = db();
  const product = (await getAdminProduct(pool, "BRK-200"))!;
  await pool.query("UPDATE product_categories SET active=false WHERE id=$1", [
    product.categoryId,
  ]);
  try {
    const saved = await updateProduct(
      pool,
      adminId,
      "BRK-200",
      product.version,
      input({ brand: "Bosch Pro" }),
    );
    assert.equal(saved.brand, "Bosch Pro");
    // Moving away from the price it had would still need a visible category.
    await rejects(
      updateProduct(
        pool,
        adminId,
        "BRK-200",
        saved.version,
        input({ brand: "Bosch Pro", priceCents: 4000 }),
      ),
      400,
      /Категорията не е активна/,
    );
    await updateProduct(pool, adminId, "BRK-200", saved.version, input());
  } finally {
    await pool.query("UPDATE product_categories SET active=true WHERE id=$1", [
      product.categoryId,
    ]);
  }
});

test("NUL characters are refused as bad input, not as an outage", async () => {
  const { pool } = db();
  const error = await createProduct(
    pool,
    adminId,
    "NUL-1",
    input({ brand: "a\u0000b" }),
  ).catch((e: unknown) => e);
  const response = adminProductError(error);
  assert.equal(response.status, 400);
  assert.equal(await getAdminProduct(pool, "NUL-1"), null);
});

test("a stale version is refused; stock movements do not change the version", async () => {
  const { pool } = db();
  const loaded = (await getAdminProduct(pool, "BRK-200"))!;
  // An order or receipt touching stock must not conflict with an admin edit.
  await pool.query(
    "UPDATE warehouse_products SET on_hand=on_hand+5, updated_at=now() WHERE sku='BRK-200'",
  );
  const saved = await updateProduct(
    pool,
    adminId,
    "BRK-200",
    loaded.version,
    input({ priceCents: 3990 }),
  );
  await rejects(
    updateProduct(pool, adminId, "BRK-200", loaded.version, input()),
    409,
    /променен междувременно/,
  );
  await rejects(
    setProductStatus(pool, adminId, "BRK-200", loaded.version, "archived"),
    409,
    /променен междувременно/,
  );
  const prices = await pool.query(
    "SELECT gross_price_cents FROM product_price_history WHERE sku='BRK-200' ORDER BY created_at",
  );
  assert.deepEqual(
    prices.rows.map((r) => r.gross_price_cents),
    [4590, 3990],
  );
  const update = (await productHistory(pool, "BRK-200"))[0];
  assert.deepEqual(update.details, {
    changes: { priceCents: { from: 4590, to: 3990 } },
  });
  assert.equal(saved.onHand, 5);
});

test("an unchanged save is a no-op without audit or version bump", async () => {
  const { pool } = db();
  const loaded = (await getAdminProduct(pool, "BRK-200"))!;
  const before = (await productHistory(pool, "BRK-200")).length;
  const same = await updateProduct(
    pool,
    adminId,
    "BRK-200",
    loaded.version,
    input({ priceCents: 3990 }),
  );
  assert.equal(same.version, loaded.version);
  assert.equal((await productHistory(pool, "BRK-200")).length, before);
});

test("archiving hides the product but keeps open reservations intact", async () => {
  const { pool } = db();
  const loaded = (await getAdminProduct(pool, "BRK-200"))!;
  await pool.query(
    "UPDATE warehouse_products SET reserved=2 WHERE sku='BRK-200'",
  );
  const archived = await setProductStatus(
    pool,
    adminId,
    "BRK-200",
    loaded.version,
    "archived",
  );
  assert.equal(archived.status, "archived");
  assert.equal(archived.reserved, 2);
  assert.equal(
    await createPostgresCatalog(() => pool).getProduct("BRK-200"),
    null,
  );
  await rejects(
    setProductStatus(pool, adminId, "NOPE", 1, "archived"),
    404,
    /не е намерен/,
  );
});

test("clearing the English name removes the translation (Bulgarian fallback)", async () => {
  const { pool } = db();
  const loaded = (await getAdminProduct(pool, "BRK-100"))!;
  const saved = await updateProduct(
    pool,
    adminId,
    "BRK-100",
    loaded.version,
    input({
      name: { bg: "Спирачни накладки", en: "" },
      description: { bg: "Предни накладки", en: "" },
    }),
  );
  assert.equal(saved.name.en, "");
  const rows = await pool.query(
    "SELECT locale FROM product_translations WHERE sku='BRK-100' ORDER BY locale",
  );
  assert.deepEqual(rows.rows, [{ locale: "bg" }]);
});

test("lists by status and search, escaping LIKE wildcards", async () => {
  const { pool } = db();
  const drafts = await listAdminProducts(pool, { status: "draft", page: 1 });
  assert.deepEqual(
    drafts.items.map((p) => p.sku),
    ["BRK-100"],
  );
  const search = await listAdminProducts(pool, { q: "накладки", page: 1 });
  assert.deepEqual(search.items.map((p) => p.sku).sort(), [
    "BRK-100",
    "BRK-200",
  ]);
  assert.equal(search.total, 2);
  const beyond = await listAdminProducts(pool, { q: "накладки", page: 9 });
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.total, 2);
  const wildcard = await listAdminProducts(pool, { q: "%", page: 1 });
  assert.equal(wildcard.total, 0);
  const all = await listAdminProducts(pool, { page: 1 });
  assert.ok(all.total >= 8);
});

test("lists categories up to two levels", async () => {
  const categories = await listAdminCategories(db().pool);
  assert.ok(categories.some((c) => c.id === categoryId));
  assert.ok(!categories.some((c) => c.name === "too-deep"));
});

test("input validation rejects bad codes, barcodes and image paths", () => {
  assert.throws(() => productInputSchema.parse({ name: { bg: "А" } }));
  assert.throws(() =>
    productInputSchema.parse({ name: { bg: "Име" }, ean: "123" }),
  );
  assert.throws(() =>
    productInputSchema.parse({
      name: { bg: "Име" },
      imagePath: "//evil.example/x.png",
    }),
  );
  assert.throws(() =>
    productInputSchema.parse({ name: { bg: "Име" }, priceCents: 10.5 }),
  );
  assert.throws(
    () =>
      productInputSchema.parse({
        name: { bg: "Име" },
        description: { en: "Only English text" },
      }),
    /Английското описание изисква и английско име/,
  );
  const parsed = productInputSchema.parse({ name: { bg: "  Име  " } });
  assert.equal(parsed.name.bg, "Име");
  assert.equal(parsed.vatBps, 2000);
});

test("parallel edits of one version: exactly one wins, the rest get 409", async () => {
  const { pool } = db();
  const loaded = (await getAdminProduct(pool, "BRK-100"))!;
  const results = await Promise.allSettled(
    ["A", "B", "C", "D"].map((brand) =>
      updateProduct(
        pool,
        adminId,
        "BRK-100",
        loaded.version,
        input({
          brand,
          name: { bg: "Спирачни накладки", en: "" },
          description: { bg: "Предни накладки", en: "" },
        }),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results)
    if (r.status === "rejected")
      assert.equal((r.reason as AdminProductError).status, 409);
});
