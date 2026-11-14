import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryInputSchema,
  categorySlugSchema,
  createCategory,
  listAdminCategories,
  updateCategory,
  type CategoryInput,
} from "../../src/lib/admin-categories";
import {
  AdminProductError,
  createProduct,
  productInputSchema,
  setProductStatus,
} from "../../src/lib/admin-products";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { insertCustomer, setupTestDatabase } from "./database";

let adminId = "";
const db = setupTestDatabase({
  async prepare({ pool }) {
    adminId = await insertCustomer(pool, { isAdmin: true });
  },
});

const input = (overrides: Partial<CategoryInput> = {}): CategoryInput =>
  categoryInputSchema.parse({
    name: { bg: "Спирачна система", en: "Brakes" },
    ...overrides,
  });

const rejects = async (
  promise: Promise<unknown>,
  status: number,
  pattern: RegExp,
) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminProductError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });

const byslug = async (slug: string) =>
  (await listAdminCategories(db().pool)).find((c) => c.slug === slug)!;

test("creates top-level and subcategories with translations and audit", async () => {
  const { pool } = db();
  const top = await createCategory(pool, adminId, "brakes", input());
  assert.equal(top.name, "Спирачна система");
  assert.equal(top.nameEn, "Brakes");
  assert.equal(top.version, 1);
  const sub = await createCategory(
    pool,
    adminId,
    "brake-pads",
    input({ name: { bg: "Накладки", en: "" }, parentId: top.id }),
  );
  assert.equal(sub.parentId, top.id);
  assert.equal(sub.nameEn, "");
  const audit = await pool.query(
    "SELECT action FROM admin_audit_log WHERE entity_type='category' ORDER BY created_at",
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["category.create", "category.create"],
  );
  const list = await listAdminCategories(pool);
  assert.deepEqual(
    list.map((c) => c.slug),
    ["brakes", "brake-pads"],
  );
  assert.equal(list[0].subcategories, 1);
});

test("refuses duplicate slugs and parents that are not top-level", async () => {
  const { pool } = db();
  await rejects(
    createCategory(pool, adminId, "brakes", input()),
    409,
    /вече съществува/,
  );
  const sub = await byslug("brake-pads");
  await rejects(
    createCategory(pool, adminId, "too-deep", input({ parentId: sub.id })),
    400,
    /основна категория/,
  );
  await rejects(
    createCategory(
      pool,
      adminId,
      "orphan",
      input({ parentId: "00000000-0000-4000-8000-000000000000" }),
    ),
    400,
    /Непозната/,
  );
  const top = await byslug("brakes");
  await rejects(
    updateCategory(
      pool,
      adminId,
      top.id,
      top.version,
      input({ parentId: top.id }),
    ),
    400,
    /себе си/,
  );
  // A category with subcategories stays top-level.
  const other = await createCategory(pool, adminId, "filters", input());
  await rejects(
    updateCategory(
      pool,
      adminId,
      top.id,
      top.version,
      input({ parentId: other.id }),
    ),
    400,
    /подкатегории остава основна/,
  );
});

test("renames, reorders and deactivates; the storefront follows", async () => {
  const { pool } = db();
  const sub = await byslug("brake-pads");
  await createProduct(
    pool,
    adminId,
    "CAT-1",
    productInputSchema.parse({
      name: { bg: "Накладки Bosch" },
      categoryId: sub.id,
      priceCents: 1000,
    }),
  );
  await setProductStatus(pool, adminId, "CAT-1", 1, "published");
  const store = createPostgresCatalog(() => pool, "en");
  assert.equal(
    (await store.getProduct("CAT-1"))?.subcategory?.name,
    "Накладки",
  );
  const renamed = await updateCategory(
    pool,
    adminId,
    sub.id,
    sub.version,
    input({
      name: { bg: "Накладки", en: "Brake pads" },
      parentId: sub.parentId,
    }),
  );
  assert.equal(renamed.version, sub.version + 1);
  assert.equal(renamed.products.published, 1);
  assert.equal(
    (await store.getProduct("CAT-1"))?.subcategory?.name,
    "Brake pads",
  );
  const hidden = await updateCategory(
    pool,
    adminId,
    sub.id,
    renamed.version,
    input({
      name: { bg: "Накладки", en: "Brake pads" },
      parentId: sub.parentId,
      active: false,
    }),
  );
  assert.equal(hidden.active, false);
  assert.equal(await store.getProduct("CAT-1"), null);
  const changes = await pool.query(
    "SELECT details FROM admin_audit_log WHERE entity_id=$1 AND action='category.update' ORDER BY created_at DESC LIMIT 1",
    [sub.id],
  );
  assert.deepEqual(changes.rows[0].details, {
    changes: { active: { from: true, to: false } },
  });
});

test("stale versions get 409; unchanged saves are no-ops", async () => {
  const { pool } = db();
  const top = await byslug("filters");
  const same = await updateCategory(
    pool,
    adminId,
    top.id,
    top.version,
    input(),
  );
  assert.equal(same.version, top.version);
  const moved = await updateCategory(
    pool,
    adminId,
    top.id,
    top.version,
    input({ sortOrder: 5 }),
  );
  await rejects(
    updateCategory(pool, adminId, top.id, top.version, input({ sortOrder: 6 })),
    409,
    /променена междувременно/,
  );
  await rejects(
    updateCategory(
      pool,
      adminId,
      "00000000-0000-4000-8000-000000000001",
      1,
      input(),
    ),
    404,
    /не е намерена/,
  );
  assert.equal(moved.sortOrder, 5);
});

test("concurrent moves cannot build a third level", async () => {
  const { pool } = db();
  const a = await createCategory(pool, adminId, "race-a", input());
  const b = await createCategory(pool, adminId, "race-b", input());
  // a under b and b under a at the same time: at most one may succeed.
  const results = await Promise.allSettled([
    updateCategory(pool, adminId, a.id, a.version, input({ parentId: b.id })),
    updateCategory(pool, adminId, b.id, b.version, input({ parentId: a.id })),
  ]);
  assert.ok(results.filter((r) => r.status === "fulfilled").length <= 1);
  const deep = await pool.query(
    `SELECT 1 FROM product_categories c JOIN product_categories p ON p.id=c.parent_id
     WHERE p.parent_id IS NOT NULL`,
  );
  assert.equal(deep.rowCount, 0);
});

test("slugs and names are validated", () => {
  for (const slug of ["Brakes", "a", "brake pads", "-x", "x-", "x--y", "ш"])
    assert.ok(!categorySlugSchema.safeParse(slug).success, slug);
  assert.ok(categorySlugSchema.safeParse("brake-pads-2").success);
  assert.throws(() => categoryInputSchema.parse({ name: { bg: "Б" } }));
  assert.throws(() => categoryInputSchema.parse({ name: { bg: "Име\u0000" } }));
  assert.throws(() =>
    categoryInputSchema.parse({ name: { bg: "Име" }, sortOrder: 1.5 }),
  );
});
