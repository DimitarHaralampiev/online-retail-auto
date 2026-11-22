import assert from "node:assert/strict";
import { test } from "node:test";
import { saveFitment } from "../../src/lib/admin-fitments";
import {
  generationsOfModel,
  makeBySlug,
  makesWithCounts,
  modelBySlug,
  modelProductSkus,
  modelsOfMake,
} from "../../src/lib/car-pages";
import { importVehicles } from "../../src/lib/vehicle-import";
import { insertCustomer, setupTestDatabase } from "./database";

const ids: Record<string, string> = {};
const db = setupTestDatabase({
  async prepare({ pool }) {
    const admin = await insertCustomer(pool, { isAdmin: true });
    // Fictional reference data.
    await importVehicles(
      pool,
      admin,
      [
        "make;model;generation;year_from;year_to;engine;fuel",
        "Testmake;Alpha;Alpha I;2010;2016;1.6 diesel;diesel",
        "Testmake;Alpha;Alpha II;2016;;;",
        "Testmake;Beta;Beta I;2005;2011;;",
        "Hiddenmake;Gamma;Gamma I;2000;2004;;",
      ].join("\n"),
      { apply: true },
    );
    const rows = await pool.query<{ name: string; id: string }>(
      "SELECT name, id FROM vehicle_generations",
    );
    for (const row of rows.rows) ids[row.name] = row.id;
    for (const [sku, status] of [
      ["CAR-1", "published"],
      ["CAR-2", "published"],
      ["CAR-DRAFT", "draft"],
    ])
      await pool.query(
        "INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,status) VALUES($1,$1,'','','',$2)",
        [sku, status],
      );
    const fit = (sku: string, generation: string) =>
      saveFitment(pool, admin, sku, {
        generationId: ids[generation],
        engineId: null,
        yearFrom: null,
        yearTo: null,
        notes: "",
        source: "Test catalogue",
      });
    // CAR-1 fits two generations of Alpha: counted once.
    await fit("CAR-1", "Alpha I");
    await fit("CAR-1", "Alpha II");
    await fit("CAR-2", "Alpha I");
    await fit("CAR-DRAFT", "Alpha I");
    await fit("CAR-2", "Gamma I");
    await pool.query(
      "UPDATE vehicle_makes SET active=false WHERE slug='hiddenmake'",
    );
  },
});

test("makes list active makes with distinct published product counts", async () => {
  assert.deepEqual(
    (await makesWithCounts(db().pool)).map((m) => [
      m.slug,
      m.models,
      m.products,
    ]),
    [["testmake", 2, 2]],
  );
  assert.equal(await makeBySlug(db().pool, "hiddenmake"), null);
});

test("models show years, production state and product counts", async () => {
  const make = (await makeBySlug(db().pool, "testmake"))!;
  assert.deepEqual(
    (await modelsOfMake(db().pool, make.id)).map((m) => [
      m.slug,
      m.yearFrom,
      m.current,
      m.products,
    ]),
    [
      ["alpha", 2010, true, 2],
      ["beta", 2005, false, 0],
    ],
  );
});

test("a model page lists generations and its fitted products", async () => {
  const { pool } = db();
  const make = (await makeBySlug(pool, "testmake"))!;
  const alpha = (await modelBySlug(pool, make.id, "alpha"))!;
  assert.equal(await modelBySlug(pool, make.id, "nope"), null);
  assert.deepEqual(
    (await generationsOfModel(pool, alpha.id)).map((g) => [g.name, g.engines]),
    [
      ["Alpha I", 1],
      ["Alpha II", 0],
    ],
  );
  assert.deepEqual(await modelProductSkus(pool, alpha.id), {
    skus: ["CAR-1", "CAR-2"],
    total: 2,
  });
  assert.deepEqual(await modelProductSkus(pool, alpha.id, 1), {
    skus: ["CAR-1"],
    total: 2,
  });
});
