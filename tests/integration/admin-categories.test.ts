import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
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

/**
 * A pool whose transactions each pause right before their first row-lock
 * statement until `parties` of them got there, so they really overlap.
 */
function overlappingPool(pool: pg.Pool, parties: number) {
  let waiting: (() => void)[] = [];
  const barrier = () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length === parties) {
        for (const release of waiting) release();
        waiting = [];
      }
    });
  return {
    query: pool.query.bind(pool),
    async connect() {
      const client = await pool.connect();
      const query = client.query.bind(client) as (
        text: string,
        values?: unknown[],
      ) => Promise<pg.QueryResult>;
      let paused = false;
      return new Proxy(client, {
        get(target, key) {
          if (key === "query")
            return async (text: string, values?: unknown[]) => {
              if (!paused && /FOR (UPDATE|KEY SHARE)/.test(text)) {
                paused = true;
                await barrier();
              }
              return query(text, values);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  } as unknown as pg.Pool;
}

const depthThreeRows = async () =>
  (
    await db().pool.query(
      `SELECT 1 FROM product_categories c JOIN product_categories p ON p.id=c.parent_id
       WHERE p.parent_id IS NOT NULL`,
    )
  ).rowCount;

const onlyOneWins = (results: PromiseSettledResult<unknown>[]) => {
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected")!;
  // A clean validation refusal, not a deadlock or other database error.
  assert.ok(lost.reason instanceof AdminProductError, String(lost.reason));
  assert.equal(lost.reason.status, 400);
};

test("two admins moving categories under each other: one wins, no deadlock", async () => {
  const { pool } = db();
  const a = await createCategory(pool, adminId, "race-a", input());
  const b = await createCategory(pool, adminId, "race-b", input());
  const racing = overlappingPool(pool, 2);
  onlyOneWins(
    await Promise.allSettled([
      updateCategory(
        racing,
        adminId,
        a.id,
        a.version,
        input({ parentId: b.id }),
      ),
      updateCategory(
        racing,
        adminId,
        b.id,
        b.version,
        input({ parentId: a.id }),
      ),
    ]),
  );
  assert.equal(await depthThreeRows(), 0);
});

test("creating a subcategory while its parent moves cannot build a third level", async () => {
  const { pool } = db();
  const p = await createCategory(pool, adminId, "race-p", input());
  const q = await createCategory(pool, adminId, "race-q", input());
  const racing = overlappingPool(pool, 2);
  onlyOneWins(
    await Promise.allSettled([
      createCategory(racing, adminId, "race-child", input({ parentId: p.id })),
      updateCategory(
        racing,
        adminId,
        p.id,
        p.version,
        input({ parentId: q.id }),
      ),
    ]),
  );
  assert.equal(await depthThreeRows(), 0);
});

test("the subtree count covers products in subcategories", async () => {
  const top = await byslug("brakes");
  assert.equal(top.products.published, 0);
  // CAT-1 is published in brake-pads, a subcategory of brakes, but its
  // category was deactivated above; publishing state still counts.
  assert.equal(top.products.publishedInTree, 1);
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
