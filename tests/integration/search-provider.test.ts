import assert from "node:assert/strict";
import { test } from "node:test";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { createCatalogSearch } from "../../src/lib/search";
import { latinize } from "../../src/lib/search-text";
import { setupTestDatabase } from "./database";

const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
  },
});

test("latinize() matches the SQL search_latin() exactly", async () => {
  const samples = [
    "Въздушен ФИЛТЪР",
    "Щипка Юта Ябълка Цвят Хром Жега Чаша Шум Ѝ",
    "Škoda Citroën Zubehör",
    "Mercedes-Benz 2.0 TDI",
    "абвгдежзийклмнопрстуфхцчшщъьюя",
  ];
  const result = await db().pool.query<{ value: string }>(
    "SELECT search_latin(v) AS value FROM unnest($1::text[]) WITH ORDINALITY AS t(v, i) ORDER BY i",
    [samples],
  );
  assert.deepEqual(
    result.rows.map((r) => r.value),
    samples.map(latinize),
  );
});

test("PostgreSQL suggestions are typo tolerant and localised", async () => {
  const bg = createCatalogSearch(createPostgresCatalog(() => db().pool));
  const typo = await bg.suggest("филтр");
  assert.equal(typo.products[0].sku, "DEMO-003");
  assert.equal(typo.products[0].name, "Въздушен филтър");
  const en = createCatalogSearch(createPostgresCatalog(() => db().pool, "en"));
  const english = await en.suggest("filter");
  assert.equal(english.products[0].name, "Air filter");
  assert.deepEqual(
    english.categories.map((c) => c.subcategory),
    ["filters"],
  );
});
