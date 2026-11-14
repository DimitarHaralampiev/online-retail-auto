import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCategory,
  categoryInputSchema,
} from "../../src/lib/admin-categories";
import { getAdminProduct } from "../../src/lib/admin-products";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { importProducts, MAX_IMPORT_ROWS } from "../../src/lib/product-import";
import { insertCustomer, setupTestDatabase } from "./database";

let adminId = "";
const db = setupTestDatabase({
  async prepare({ pool }) {
    adminId = await insertCustomer(pool, { isAdmin: true });
    await createCategory(
      pool,
      adminId,
      "filters",
      categoryInputSchema.parse({ name: { bg: "Филтри", en: "Filters" } }),
    );
  },
});

const run = (csv: string, apply = false) =>
  importProducts(db().pool, adminId, csv, { apply, filename: "test.csv" });

const count = async (sql: string, params: unknown[] = []) =>
  Number((await db().pool.query(sql, params)).rows[0].n);

const GOOD = [
  "sku;name_bg;name_en;category;price;vat;status;stock;unit_cost",
  "IMP-2;Маслен филтър;Oil filter;filters;12,90;20;published;5;6,00",
  "IMP-1;Въздушен филтър;;filters;9,50;;draft;;",
].join("\n");

test("a dry run reports every row and changes nothing", async () => {
  const report = await run(GOOD);
  assert.equal(report.applied, false);
  assert.deepEqual(report.summary, {
    create: 2,
    update: 0,
    unchanged: 0,
    error: 0,
  });
  // Results keep file order although rows are processed in SKU order.
  assert.deepEqual(
    report.rows.map((r) => [r.line, r.sku, r.action]),
    [
      [2, "IMP-2", "create"],
      [3, "IMP-1", "create"],
    ],
  );
  assert.equal(await count("SELECT count(*) n FROM warehouse_products"), 0);
  assert.equal(await count("SELECT count(*) n FROM admin_audit_log"), 1);
});

test("apply creates products, opening stock, translations and audit", async () => {
  const report = await run(GOOD, true);
  assert.equal(report.applied, true);
  const oil = (await getAdminProduct(db().pool, "IMP-2"))!;
  assert.equal(oil.status, "published");
  assert.equal(oil.priceCents, 1290);
  assert.equal(oil.onHand, 5);
  const value = await db().pool.query(
    "SELECT inventory_value_cents::int v FROM warehouse_products WHERE sku='IMP-2'",
  );
  assert.equal(value.rows[0].v, 3000);
  assert.equal(
    await count(
      "SELECT count(*) n FROM stock_movements WHERE sku='IMP-2' AND kind='receipt' AND quantity=5",
    ),
    1,
  );
  const shown = await createPostgresCatalog(() => db().pool, "en").getProduct(
    "IMP-2",
  );
  assert.equal(shown?.name, "Oil filter");
  assert.equal((await getAdminProduct(db().pool, "IMP-1"))!.status, "draft");
  assert.equal(
    await count(
      "SELECT count(*) n FROM admin_audit_log WHERE action='product.import'",
    ),
    1,
  );
});

test("re-importing the same file is unchanged; empty cells keep values", async () => {
  const again = await run(GOOD.replace(";5;6,00", ";;"), true);
  assert.deepEqual(again.summary, {
    create: 0,
    update: 0,
    unchanged: 2,
    error: 0,
  });
  const update = await run("sku,price\nIMP-1,10.00\n", true);
  assert.deepEqual(update.summary, {
    create: 0,
    update: 1,
    unchanged: 0,
    error: 0,
  });
  const product = (await getAdminProduct(db().pool, "IMP-1"))!;
  assert.equal(product.priceCents, 1000);
  assert.equal(product.name.bg, "Въздушен филтър");
});

test("any row error blocks the whole apply and is reported per row", async () => {
  const csv = [
    "sku,name_bg,category,price,stock,status",
    "IMP-3,Нов продукт,filters,5.00,,",
    "IMP-1,,,,4,",
    "IMP-4,Без категория,nope,1,,",
    "IMP-5,Х,,,,",
    "IMP-6,Без цена,filters,,,published",
    "IMP-3,Дубликат,,,,",
    ",Без код,,,,",
    "bad sku,Лош код,,,,",
    "IMP-7,Цена,filters,abc,,",
    "IMP-8,Статус,filters,1,,sold",
  ].join("\n");
  const report = await run(csv, true);
  assert.equal(report.applied, false);
  const errors = Object.fromEntries(
    report.rows.map((r) => [r.line, r.errors.join(" ")]),
  );
  assert.equal(report.rows[0].action, "create");
  assert.match(errors[3], /само чрез фактури/);
  assert.match(errors[4], /Непозната категория/);
  assert.match(errors[5], /име на български/);
  assert.match(errors[6], /Липсва продажна цена/);
  assert.match(errors[7], /повтаря \(ред 2\)/);
  assert.match(errors[8], /Липсва продуктов код/);
  assert.match(errors[9], /латински букви/);
  assert.match(errors[10], /сума в евро/);
  assert.match(errors[11], /draft, published или archived/);
  assert.equal(report.summary.error, 9);
  assert.equal(await getAdminProduct(db().pool, "IMP-3"), null);
  assert.equal((await getAdminProduct(db().pool, "IMP-1"))!.onHand, 0);
});

test("file-level problems are reported without touching rows", async () => {
  assert.match(
    (await run("sku,colour\nA,red")).error!,
    /Непознати колони: colour/,
  );
  assert.match((await run("name_bg\nИме")).error!, /Липсва колона sku/);
  assert.match((await run("sku,sku\nA,B")).error!, /повторени колони/);
  assert.match((await run("sku\n")).error!, /няма редове/);
  assert.match((await run('sku\n"open')).error!, /незатворени/);
  const big = "sku\n" + "X\n".repeat(MAX_IMPORT_ROWS + 1);
  assert.match(
    (await run(big)).error!,
    new RegExp(`над ${MAX_IMPORT_ROWS} реда`),
  );
});

test("a NUL character is a row error, not an outage", async () => {
  const report = await run("sku,name_bg\nIMP-9,Име\u0000x\n");
  assert.equal(report.rows[0].action, "error");
  assert.match(report.rows[0].errors[0], /недопустими знаци/);
});

test("a check holds no row locks: checkout is never blocked by it", async () => {
  const { pool } = db();
  let blocked: string | null = "not run";
  // Before the check's final ROLLBACK, another session updates an imported
  // product with a short lock timeout, like a checkout would.
  const watching = {
    async connect() {
      const client = await pool.connect();
      const query = client.query.bind(client) as (
        text: string,
        values?: unknown[],
      ) => Promise<unknown>;
      return new Proxy(client, {
        get(target, key) {
          if (key === "query")
            return async (text: string, values?: unknown[]) => {
              if (text === "ROLLBACK" && blocked === "not run") {
                const other = await pool.connect();
                try {
                  await other.query("BEGIN");
                  await other.query("SET LOCAL lock_timeout = '200ms'");
                  await other.query(
                    "UPDATE warehouse_products SET reserved = reserved WHERE sku = 'IMP-1'",
                  );
                  await other.query("COMMIT");
                  blocked = null;
                } catch (error) {
                  await other.query("ROLLBACK");
                  blocked = (error as Error).message;
                } finally {
                  other.release();
                }
              }
              return query(text, values);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  } as unknown as Parameters<typeof importProducts>[0];
  const report = await importProducts(
    watching,
    adminId,
    "sku,price\nIMP-1,11.00\nIMP-2,13.00\n",
    { apply: false },
  );
  assert.deepEqual(report.summary, {
    create: 0,
    update: 2,
    unchanged: 0,
    error: 0,
  });
  assert.equal(blocked, null);
});

test("unpublishing and moving to an inactive category work in one row", async () => {
  const { pool } = db();
  const hidden = await createCategory(
    pool,
    adminId,
    "hidden",
    categoryInputSchema.parse({ name: { bg: "Скрита" }, active: false }),
  );
  assert.ok(hidden.id);
  const report = await run("sku,category,status\nIMP-2,hidden,draft\n", true);
  assert.deepEqual(report.summary, {
    create: 0,
    update: 1,
    unchanged: 0,
    error: 0,
  });
  const product = (await getAdminProduct(pool, "IMP-2"))!;
  assert.equal(product.status, "draft");
  assert.equal(product.categoryId, hidden.id);
});

test("opening stock needs a cost and records who booked it", async () => {
  const noCost = await run("sku,name_bg,stock\nIMP-10,Без цена,3\n");
  assert.match(noCost.rows[0].errors[0], /изисква себестойност/);
  const zeroCost = await run(
    "sku,name_bg,stock,unit_cost\nIMP-10,Подарък,3,0\n",
    true,
  );
  assert.equal(zeroCost.applied, true);
  const movement = await db().pool.query(
    "SELECT actor_id, unit_cost_cents FROM stock_movements WHERE sku='IMP-10'",
  );
  assert.deepEqual(movement.rows, [{ actor_id: adminId, unit_cost_cents: 0 }]);
  // Re-importing the creation file with the same stock is fine.
  const again = await run("sku,name_bg,stock,unit_cost\nIMP-10,Подарък,3,0\n");
  assert.equal(again.summary.error, 0);
  const changed = await run("sku,stock\nIMP-10,4\n");
  assert.match(changed.rows[0].errors[0], /само чрез фактури/);
});

test("spreadsheet quirks: trailing delimiters and delimiter-only rows", async () => {
  const report = await run("sku;price;\r\nIMP-1;11,00;\r\n;;\r\n;;;\r\n");
  assert.equal(report.error, undefined);
  assert.deepEqual(
    report.rows.map((r) => [r.sku, r.action]),
    [["IMP-1", "update"]],
  );
  const extra = await run("sku,price\nIMP-1,11.00,surprise\n");
  assert.match(extra.rows[0].errors[0], /повече клетки/);
});

test("non-UTF-8 files are refused before any row is checked", async () => {
  const report = await run("sku,name_bg\nIMP-11,���\n");
  assert.match(report.error!, /UTF-8/);
  assert.deepEqual(report.rows, []);
});

test("only one import runs at a time", async () => {
  const { pool } = db();
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(
      "SELECT pg_advisory_xact_lock(hashtext('product-import'))",
    );
    const report = await run("sku,price\nIMP-1,12.00\n", true);
    assert.match(report.error!, /друг импорт/);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
});
