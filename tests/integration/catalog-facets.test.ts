import assert from "node:assert/strict";
import { test } from "node:test";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { brandKey } from "../../src/lib/search-text";
import { setupTestDatabase } from "./database";

const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    // Spellings as they arrive from invoices and admins.
    for (const [sku, brand] of [
      ["DEMO-001", "Bosch"],
      ["DEMO-002", "BOSCH "],
      ["DEMO-003", "bosch"],
      ["DEMO-004", "Valeo"],
      ["DEMO-005", "Мотул"],
      ["DEMO-006", ""],
    ])
      await pool.query("UPDATE warehouse_products SET brand=$2 WHERE sku=$1", [
        sku,
        brand,
      ]);
  },
});

const store = () => createPostgresCatalog(() => db().pool);

test("brandKey() matches the SQL brand_key() exactly", async () => {
  const samples = [
    "Bosch",
    "BOSCH ",
    "Bosch Car-Service",
    "Мотул",
    "Škoda Parts",
    " -x- ",
    "",
  ];
  const result = await db().pool.query<{ key: string }>(
    "SELECT brand_key(v) AS key FROM unnest($1::text[]) WITH ORDINALITY AS t(v, i) ORDER BY i",
    [samples],
  );
  assert.deepEqual(
    result.rows.map((r) => r.key),
    samples.map(brandKey),
  );
});

test("brand facets group spellings, count and skip empty brands", async () => {
  assert.deepEqual((await store().facets({})).brands, [
    { key: "bosch", name: "Bosch", count: 3 },
    { key: "motul", name: "Мотул", count: 1 },
    { key: "valeo", name: "Valeo", count: 1 },
  ]);
});

test("brand filters combine as OR and keep the other brands' counts", async () => {
  const filtered = await store().browse({
    brands: ["bosch", "valeo"],
    pageSize: 96,
  });
  assert.deepEqual(filtered.items.map((p) => p.sku).sort(), [
    "DEMO-001",
    "DEMO-002",
    "DEMO-003",
    "DEMO-004",
  ]);
  // Choosing brands does not change the brand counts (disjunctive facets)...
  assert.deepEqual(
    (await store().facets({ brands: ["bosch"] })).brands.map((b) => [
      b.key,
      b.count,
    ]),
    [
      ["bosch", 3],
      ["motul", 1],
      ["valeo", 1],
    ],
  );
  // ...but every other filter does.
  assert.deepEqual(
    (await store().facets({ category: "parts-consumables" })).brands.map(
      (b) => [b.key, b.count],
    ),
    [
      ["bosch", 1],
      ["valeo", 1],
    ],
  );
  assert.deepEqual(
    (await store().facets({ search: "филтър" })).brands.map((b) => b.key),
    ["bosch"],
  );
});

test("invalid brand keys are dropped before SQL", async () => {
  const all = await store().browse({ pageSize: 96 });
  const junk = await store().browse({
    brands: ["Bosch", "'; DROP", "", "a".repeat(61)],
    pageSize: 96,
  });
  assert.equal(junk.total, all.total);
  assert.equal((await store().browse({ brands: ["nope"] })).total, 0);
});
