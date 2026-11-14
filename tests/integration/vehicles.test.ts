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
import { setupTestDatabase } from "./database";

// Fictional fixtures: tests never use real vehicle data.
const ids = {
  make: randomUUID(),
  inactiveMake: randomUUID(),
  model: randomUUID(),
  gen1: randomUUID(),
  gen2: randomUUID(),
  petrol: randomUUID(),
  diesel: randomUUID(),
  otherGenEngine: randomUUID(),
};

const db = setupTestDatabase({
  async prepare({ pool }) {
    await pool.query(
      `INSERT INTO vehicle_makes(id,slug,name,active) VALUES
         ($1,'testmake','Testmake',true),($2,'oldmake','Oldmake',false)`,
      [ids.make, ids.inactiveMake],
    );
    await pool.query(
      "INSERT INTO vehicle_models(id,make_id,slug,name) VALUES($1,$2,'alpha','Alpha')",
      [ids.model, ids.make],
    );
    await pool.query(
      `INSERT INTO vehicle_generations(id,model_id,name,year_from,year_to) VALUES
         ($1,$3,'Alpha I',2010,2016),($2,$3,'Alpha II',2016,NULL)`,
      [ids.gen1, ids.gen2, ids.model],
    );
    await pool.query(
      `INSERT INTO vehicle_engines(id,generation_id,name,fuel,displacement_cc,power_kw) VALUES
         ($1,$4,'1.6 diesel','diesel',1600,85),($2,$4,'1.4 petrol','petrol',1400,90),
         ($3,$5,'2.0 petrol','petrol',2000,140)`,
      [ids.diesel, ids.petrol, ids.otherGenEngine, ids.gen1, ids.gen2],
    );
    for (const sku of ["FIT-GEN", "FIT-DIESEL", "FIT-UNI", "FIT-NONE"])
      await pool.query(
        "INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,universal_fit) VALUES($1,$1,'','','',$2)",
        [sku, sku === "FIT-UNI"],
      );
    await pool.query(
      `INSERT INTO product_vehicle_fitments(id,sku,generation_id,engine_id,source,notes) VALUES
         ($1,'FIT-GEN',$3,NULL,'test catalog',''),
         ($2,'FIT-DIESEL',$3,$4,'test catalog','Front axle')`,
      [randomUUID(), randomUUID(), ids.gen1, ids.diesel],
    );
  },
});

test("lookups cascade and hide inactive makes", async () => {
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
  assert.deepEqual(
    (await listEngines(pool, ids.gen1)).map((e) => e.name),
    ["1.6 diesel", "1.4 petrol"],
  );
});

test("compatible SKUs: generation-wide, engine-specific and universal", async () => {
  const { pool } = db();
  assert.deepEqual(
    await compatibleSkus(pool, {
      generationId: ids.gen1,
      engineId: ids.diesel,
    }),
    ["FIT-DIESEL", "FIT-GEN", "FIT-UNI"],
  );
  assert.deepEqual(
    await compatibleSkus(pool, {
      generationId: ids.gen1,
      engineId: ids.petrol,
    }),
    ["FIT-GEN", "FIT-UNI"],
  );
  // Without an engine, engine-specific parts are not claimed to fit.
  assert.deepEqual(await compatibleSkus(pool, { generationId: ids.gen1 }), [
    "FIT-GEN",
    "FIT-UNI",
  ]);
  assert.deepEqual(await compatibleSkus(pool, { generationId: ids.gen2 }), [
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
      notes: "Front axle",
    },
  ]);
  assert.deepEqual(await productFitments(pool, "FIT-NONE"), []);
});

test("constraints keep the reference consistent", async () => {
  const { pool } = db();
  const fails = (sql: string, params: unknown[], code: string) =>
    assert.rejects(pool.query(sql, params), (e: { code?: string }) => {
      assert.equal(e.code, code);
      return true;
    });
  const fitment =
    "INSERT INTO product_vehicle_fitments(id,sku,generation_id,engine_id,source) VALUES($1,$2,$3,$4,$5)";
  // An engine of another generation.
  await fails(
    fitment,
    [randomUUID(), "FIT-NONE", ids.gen1, ids.otherGenEngine, "x"],
    "23503",
  );
  // Duplicate generation-wide fitment (NULL engine counts as equal).
  await fails(fitment, [randomUUID(), "FIT-GEN", ids.gen1, null, "x"], "23505");
  // A source is required.
  await fails(
    fitment,
    [randomUUID(), "FIT-NONE", ids.gen1, null, " "],
    "23514",
  );
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
  // Deleting a product removes its fitments.
  await pool.query("DELETE FROM warehouse_products WHERE sku='FIT-DIESEL'");
  assert.deepEqual(await productFitments(pool, "FIT-DIESEL"), []);
});
