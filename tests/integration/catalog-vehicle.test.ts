import assert from "node:assert/strict";
import { test } from "node:test";
import { saveFitment } from "../../src/lib/admin-fitments";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { importVehicles } from "../../src/lib/vehicle-import";
import { fitStatuses } from "../../src/lib/vehicles";
import { insertCustomer, setupTestDatabase } from "./database";

const ids: Record<string, string> = {};
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    const admin = await insertCustomer(pool, { isAdmin: true });
    // Fictional reference data and fitments on demo products.
    await importVehicles(
      pool,
      admin,
      [
        "make;model;generation;year_from;year_to;engine;fuel",
        "Testmake;Alpha;Alpha I;2010;2016;1.6 diesel;diesel",
        "Testmake;Alpha;Alpha I;2010;2016;1.4 petrol;petrol",
        "Testmake;Alpha;Alpha II;2016;;;",
      ].join("\n"),
      { apply: true },
    );
    const rows = await pool.query<{ name: string; id: string }>(
      `SELECT name, id FROM vehicle_generations
       UNION ALL SELECT name, id FROM vehicle_engines`,
    );
    for (const row of rows.rows) ids[row.name] = row.id;
    const fit = (
      sku: string,
      engine: string | null,
      years: [number | null, number | null] = [null, null],
    ) =>
      saveFitment(pool, admin, sku, {
        generationId: ids["Alpha I"],
        engineId: engine && ids[engine],
        yearFrom: years[0],
        yearTo: years[1],
        notes: "",
        source: "Test catalogue",
      });
    await fit("DEMO-003", null); // whole generation
    await fit("DEMO-004", "1.6 diesel"); // one engine
    await fit("DEMO-005", null, [2013, 2016]); // after a facelift
    await pool.query(
      "UPDATE warehouse_products SET universal_fit = true WHERE sku = 'DEMO-006'",
    );
  },
});

const browseSkus = async (vehicle: {
  generationId: string;
  engineId: string | null;
  year: number | null;
}) =>
  (
    await createPostgresCatalog(() => db().pool).browse({
      vehicle,
      pageSize: 96,
    })
  ).items
    .map((p) => p.sku)
    .sort();

test("the catalog filter keeps verified and universal products only", async () => {
  assert.deepEqual(
    await browseSkus({
      generationId: ids["Alpha I"],
      engineId: ids["1.6 diesel"],
      year: 2014,
    }),
    ["DEMO-003", "DEMO-004", "DEMO-005", "DEMO-006"],
  );
  assert.deepEqual(
    await browseSkus({
      generationId: ids["Alpha I"],
      engineId: ids["1.4 petrol"],
      year: 2011,
    }),
    ["DEMO-003", "DEMO-006"],
  );
  // Without engine and year, limited fitments are not claimed to fit.
  assert.deepEqual(
    await browseSkus({
      generationId: ids["Alpha I"],
      engineId: null,
      year: null,
    }),
    ["DEMO-003", "DEMO-006"],
  );
  assert.deepEqual(
    await browseSkus({
      generationId: ids["Alpha II"],
      engineId: null,
      year: 2020,
    }),
    ["DEMO-006"],
  );
  // No vehicle: the whole catalog.
  const all = await createPostgresCatalog(() => db().pool).browse({
    pageSize: 96,
  });
  assert.equal(all.total, 6);
});

test("fit statuses: fits, universal and check — and no claim otherwise", async () => {
  const { pool } = db();
  const skus = ["DEMO-001", "DEMO-003", "DEMO-004", "DEMO-005", "DEMO-006"];
  assert.deepEqual(
    await fitStatuses(pool, skus, {
      generationId: ids["Alpha I"],
      engineId: null,
      year: null,
    }),
    {
      "DEMO-003": "fits",
      "DEMO-004": "check",
      "DEMO-005": "check",
      "DEMO-006": "universal",
    },
  );
  assert.deepEqual(
    await fitStatuses(pool, skus, {
      generationId: ids["Alpha I"],
      engineId: ids["1.4 petrol"],
      year: 2011,
    }),
    { "DEMO-003": "fits", "DEMO-006": "universal" },
  );
  assert.deepEqual(
    await fitStatuses(pool, skus, {
      generationId: ids["Alpha I"],
      engineId: ids["1.6 diesel"],
      year: 2014,
    }),
    {
      "DEMO-003": "fits",
      "DEMO-004": "fits",
      "DEMO-005": "fits",
      "DEMO-006": "universal",
    },
  );
  assert.deepEqual(
    await fitStatuses(pool, [], {
      generationId: ids["Alpha I"],
      engineId: null,
      year: null,
    }),
    {},
  );
});

test("an invalid vehicle is refused before reaching SQL", async () => {
  await assert.rejects(
    createPostgresCatalog(() => db().pool).browse({
      vehicle: { generationId: "x", engineId: null, year: null },
    }),
    /reference ids/,
  );
});
