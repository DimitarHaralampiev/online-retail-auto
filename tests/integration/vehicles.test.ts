import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  compatibleSkus,
  listEngines,
  listGenerations,
  listMakes,
  listModels,
  productFitments,
} from "../../src/lib/vehicles";
import { insertCustomer, setupTestDatabase } from "./database";

// Fictional fixtures: tests never use real vehicle data.
const ids = {
  make: randomUUID(),
  inactiveMake: randomUUID(),
  model: randomUUID(),
  inactiveModel: randomUUID(),
  gen1: randomUUID(),
  gen2: randomUUID(),
  hiddenGen: randomUUID(),
  petrol: randomUUID(),
  diesel: randomUUID(),
  otherGenEngine: randomUUID(),
};

const FITMENT =
  "INSERT INTO product_vehicle_fitments(id,sku,generation_id,engine_id,year_from,year_to,source,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)";

const db = setupTestDatabase({
  async prepare({ pool }) {
    await pool.query(
      `INSERT INTO vehicle_makes(id,slug,name,active) VALUES
         ($1,'testmake','Testmake',true),($2,'oldmake','Oldmake',false)`,
      [ids.make, ids.inactiveMake],
    );
    await pool.query(
      `INSERT INTO vehicle_models(id,make_id,slug,name,active) VALUES
         ($1,$3,'alpha','Alpha',true),($2,$3,'beta','Beta',false)`,
      [ids.model, ids.inactiveModel, ids.make],
    );
    await pool.query(
      `INSERT INTO vehicle_generations(id,model_id,name,year_from,year_to) VALUES
         ($1,$4,'Alpha I',2010,2016),($2,$4,'Alpha II',2016,NULL),
         ($3,$5,'Beta I',2012,2018)`,
      [ids.gen1, ids.gen2, ids.hiddenGen, ids.model, ids.inactiveModel],
    );
    await pool.query(
      `INSERT INTO vehicle_engines(id,generation_id,name,fuel,displacement_cc,power_kw) VALUES
         ($1,$4,'1.6 diesel','diesel',1600,85),($2,$4,'1.4 petrol','petrol',1400,90),
         ($3,$5,'2.0 petrol','petrol',2000,140)`,
      [ids.diesel, ids.petrol, ids.otherGenEngine, ids.gen1, ids.gen2],
    );
    const products: [string, string, boolean][] = [
      ["FIT-GEN", "published", false],
      ["FIT-DIESEL", "published", false],
      ["FIT-FACELIFT", "published", false],
      ["FIT-UNI", "published", true],
      ["FIT-BOTH", "published", true],
      ["FIT-DRAFT", "draft", false],
      ["FIT-DRAFT-UNI", "draft", true],
      ["FIT-ARCHIVED", "archived", false],
      ["FIT-HIDDEN", "published", false],
      ["FIT-NONE", "published", false],
    ];
    for (const [sku, status, universal] of products)
      await pool.query(
        "INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,status,universal_fit) VALUES($1,$1,'','','',$2,$3)",
        [sku, status, universal],
      );
    const fit = (
      sku: string,
      generation: string,
      engine: string | null = null,
      years: [number | null, number | null] = [null, null],
      notes = "",
    ) =>
      pool.query(FITMENT, [
        randomUUID(),
        sku,
        generation,
        engine,
        years[0],
        years[1],
        "test catalog",
        notes,
        null,
      ]);
    await fit("FIT-GEN", ids.gen1);
    await fit("FIT-DIESEL", ids.gen1, ids.diesel, [null, null], "Front axle");
    // Only after the (fictional) facelift.
    await fit("FIT-FACELIFT", ids.gen1, null, [2013, 2016]);
    // Universal and also fitted: listed once.
    await fit("FIT-BOTH", ids.gen1);
    await fit("FIT-DRAFT", ids.gen1);
    await fit("FIT-ARCHIVED", ids.gen1);
    // Fitted to a generation of an inactive model.
    await fit("FIT-HIDDEN", ids.hiddenGen);
  },
});

test("lookups cascade and hide inactive makes and models", async () => {
  const { pool } = db();
  assert.deepEqual(
    (await listMakes(pool)).map((m) => m.slug),
    ["testmake"],
  );
  assert.deepEqual(
    (await listModels(pool, ids.make)).map((m) => m.name),
    ["Alpha"],
  );
  assert.deepEqual(await listModels(pool, ids.inactiveMake), []);
  assert.deepEqual(await listGenerations(pool, ids.model), [
    { id: ids.gen1, name: "Alpha I", yearFrom: 2010, yearTo: 2016 },
    { id: ids.gen2, name: "Alpha II", yearFrom: 2016, yearTo: null },
  ]);
  // Below an inactive model nothing is listed, even when asked by id.
  assert.deepEqual(await listGenerations(pool, ids.inactiveModel), []);
  assert.deepEqual(
    (await listEngines(pool, ids.gen1)).map((e) => [e.name, e.fuel]),
    [
      ["1.6 diesel", "diesel"],
      ["1.4 petrol", "petrol"],
    ],
  );
  assert.deepEqual(await listEngines(pool, ids.hiddenGen), []);
});

test("compatible SKUs: published only, generation-wide, engine and year aware", async () => {
  const { pool } = db();
  const fits = (selection: Parameters<typeof compatibleSkus>[1]) =>
    compatibleSkus(pool, selection);
  assert.deepEqual(
    await fits({ generationId: ids.gen1, engineId: ids.diesel, year: 2014 }),
    ["FIT-BOTH", "FIT-DIESEL", "FIT-FACELIFT", "FIT-GEN", "FIT-UNI"],
  );
  // Before the facelift, and with another engine.
  assert.deepEqual(
    await fits({ generationId: ids.gen1, engineId: ids.petrol, year: 2011 }),
    ["FIT-BOTH", "FIT-GEN", "FIT-UNI"],
  );
  // Without engine or year, limited fitments are not claimed to fit.
  assert.deepEqual(await fits({ generationId: ids.gen1 }), [
    "FIT-BOTH",
    "FIT-GEN",
    "FIT-UNI",
  ]);
  // An engine of another generation only matches generation-wide fitments.
  assert.deepEqual(
    await fits({ generationId: ids.gen1, engineId: ids.otherGenEngine }),
    ["FIT-BOTH", "FIT-GEN", "FIT-UNI"],
  );
  assert.deepEqual(await fits({ generationId: ids.gen2 }), [
    "FIT-BOTH",
    "FIT-UNI",
  ]);
  // A generation of an inactive model matches only universal products.
  assert.deepEqual(await fits({ generationId: ids.hiddenGen }), [
    "FIT-BOTH",
    "FIT-UNI",
  ]);
});

test("product fitment table lists the verified vehicles", async () => {
  const { pool } = db();
  assert.deepEqual(await productFitments(pool, "FIT-DIESEL"), [
    {
      make: "Testmake",
      model: "Alpha",
      generation: "Alpha I",
      yearFrom: 2010,
      yearTo: 2016,
      engine: "1.6 diesel",
      fitYearFrom: null,
      fitYearTo: null,
      notes: "Front axle",
    },
  ]);
  const facelift = await productFitments(pool, "FIT-FACELIFT");
  assert.deepEqual(
    [facelift[0].fitYearFrom, facelift[0].fitYearTo],
    [2013, 2016],
  );
  assert.deepEqual(await productFitments(pool, "FIT-HIDDEN"), []);
  assert.deepEqual(await productFitments(pool, "FIT-NONE"), []);
});

test("constraints keep the reference consistent", async () => {
  const { pool } = db();
  const fails = (sql: string, params: unknown[], code: string) =>
    assert.rejects(pool.query(sql, params), (e: { code?: string }) => {
      assert.equal(e.code, code);
      return true;
    });
  const row = (
    sku: string,
    generation: string,
    engine: string | null,
    years: [number | null, number | null] = [null, null],
    source = "x",
  ) => [randomUUID(), sku, generation, engine, ...years, source, "", null];
  // An engine of another generation.
  await fails(FITMENT, row("FIT-NONE", ids.gen1, ids.otherGenEngine), "23503");
  // Duplicates, with and without an engine (NULLs count as equal).
  await fails(FITMENT, row("FIT-GEN", ids.gen1, null), "23505");
  await fails(FITMENT, row("FIT-DIESEL", ids.gen1, ids.diesel), "23505");
  // A source is required; fitment years must be ordered.
  await fails(
    FITMENT,
    row("FIT-NONE", ids.gen1, null, [null, null], " "),
    "23514",
  );
  await fails(FITMENT, row("FIT-NONE", ids.gen1, null, [2015, 2012]), "23514");
  await fails(
    "INSERT INTO vehicle_generations(id,model_id,name,year_from,year_to) VALUES($1,$2,'Bad',2020,2019)",
    [randomUUID(), ids.model],
    "23514",
  );
  await fails(
    "INSERT INTO vehicle_makes(id,slug,name) VALUES($1,'Bad Slug','X')",
    [randomUUID()],
    "23514",
  );
  await fails(
    "INSERT INTO vehicle_engines(id,generation_id,name,fuel) VALUES($1,$2,'X','steam')",
    [randomUUID(), ids.gen1],
    "23514",
  );
  // Verified reference rows cannot be deleted while fitments use them.
  await fails("DELETE FROM vehicle_engines WHERE id=$1", [ids.diesel], "23503");
  await fails(
    "DELETE FROM vehicle_generations WHERE id=$1",
    [ids.gen1],
    "23503",
  );
});

test("deleting a product removes its fitments; deleting its author keeps them", async () => {
  const { pool } = db();
  const author = await insertCustomer(pool);
  await pool.query(
    "INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,status) VALUES('FIT-TEMP','FIT-TEMP','','','','published')",
  );
  await pool.query(FITMENT, [
    randomUUID(),
    "FIT-TEMP",
    ids.gen2,
    null,
    null,
    null,
    "test catalog",
    "",
    author,
  ]);
  await pool.query("DELETE FROM customers WHERE id=$1", [author]);
  const kept = await pool.query(
    "SELECT created_by FROM product_vehicle_fitments WHERE sku='FIT-TEMP'",
  );
  assert.deepEqual(kept.rows, [{ created_by: null }]);
  await pool.query("DELETE FROM warehouse_products WHERE sku='FIT-TEMP'");
  const gone = await pool.query(
    "SELECT 1 FROM product_vehicle_fitments WHERE sku='FIT-TEMP'",
  );
  assert.equal(gone.rowCount, 0);
});
