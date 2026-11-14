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
