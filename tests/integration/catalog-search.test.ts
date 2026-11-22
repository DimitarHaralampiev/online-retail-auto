import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowseQuery } from "../../src/lib/catalog";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { setupTestDatabase } from "./database";

const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    // Codes as suppliers write them: spaces, dashes, dots.
    await pool.query(
      "UPDATE warehouse_products SET manufacturer_code='0 986-494.120', ean='3165143456789' WHERE sku='DEMO-001'",
    );
  },
});

const store = () => createPostgresCatalog(() => db().pool);
const skus = async (query: BrowseQuery) =>
  (await store().browse({ pageSize: 96, ...query })).items.map((p) => p.sku);

test("Bulgarian, English and transliterated Latin find the same product", async () => {
  for (const search of [
    "филтър",
    "въздушен филтър",
    "air filter",
    "filtar",
    "vazdushen filtar",
  ])
    assert.equal((await skus({ search }))[0], "DEMO-003", search);
});

test("typos and partial words still match", async () => {
  assert.equal((await skus({ search: "филтр" }))[0], "DEMO-003");
  assert.equal((await skus({ search: "въздушн филтер" }))[0], "DEMO-003");
  assert.equal((await skus({ search: "чистачк" }))[0], "DEMO-004");
  assert.equal((await skus({ search: "шампуан" }))[0], "DEMO-005");
  assert.equal((await skus({ search: "microfiber" }))[0], "DEMO-006");
});

test("exact SKU, manufacturer code and EAN rank first", async () => {
  // An exact code shows only that product, not similar-looking codes.
  assert.deepEqual(await skus({ search: "demo-004" }), ["DEMO-004"]);
  assert.deepEqual(await skus({ search: "DEMO 004" }), ["DEMO-004"]);
  assert.equal((await skus({ search: "0986494120" }))[0], "DEMO-001");
  assert.equal((await skus({ search: "0 986 494 120" }))[0], "DEMO-001");
  assert.equal((await skus({ search: "3165143456789" }))[0], "DEMO-001");
});

test("unrelated words find nothing", async () => {
  assert.deepEqual(await skus({ search: "zzqxw" }), []);
  assert.deepEqual(await skus({ search: "турбокомпресор" }), []);
});

test("search combines with filters and an explicit order", async () => {
  assert.deepEqual(await skus({ search: "филтър", category: "car-care" }), []);
  const byPrice = await store().browse({
    search: "demo",
    sort: "price-asc",
    pageSize: 96,
  });
  const prices = byPrice.items.map((p) => p.salePriceCents ?? p.priceCents);
  assert.deepEqual(
    prices,
    [...prices].sort((a, b) => a - b),
  );
  assert.equal(byPrice.total, 6);
});

test("search finds at least everything the literal text filter finds", async () => {
  for (const text of ["филтър", "FILTER", "demo-00", "Стойка", "кърпа"]) {
    const literal = await skus({ text, locale: "en" });
    const searched = await skus({ search: text, locale: "en" });
    for (const sku of literal)
      assert.ok(searched.includes(sku), `${text}: ${sku}`);
  }
});

test("edits are reindexed by the triggers", async () => {
  const { pool } = db();
  await pool.query(
    "UPDATE product_translations SET name='Багажна мрежа' WHERE sku='DEMO-001' AND locale='bg'",
  );
  assert.equal((await skus({ search: "мрежа" }))[0], "DEMO-001");
  await pool.query(
    "UPDATE warehouse_products SET brand='Zubehörwerk' WHERE sku='DEMO-002'",
  );
  assert.equal((await skus({ search: "zubehorwerk" }))[0], "DEMO-002");
  // Stock changes (every order) do not rewrite the search document.
  const before = await pool.query(
    "SELECT xmin::text FROM product_search WHERE sku='DEMO-002'",
  );
  await pool.query(
    "UPDATE warehouse_products SET reserved = reserved WHERE sku='DEMO-002'",
  );
  const after = await pool.query(
    "SELECT xmin::text FROM product_search WHERE sku='DEMO-002'",
  );
  assert.equal(after.rows[0].xmin, before.rows[0].xmin);
});

test("hostile input is searched literally and safely", async () => {
  for (const search of [
    "%",
    "_",
    "'",
    "\\",
    "' OR 1=1 --",
    "a:*",
    "!&|",
    "\u0000x",
  ])
    await assert.doesNotReject(store().browse({ search }), search);
  assert.deepEqual(await skus({ search: "%" }), []);
});
