import assert from "node:assert/strict";
import { test } from "node:test";
import {
  referenceTree,
  setReferenceActive,
} from "../../src/lib/admin-vehicles";
import { importVehicles } from "../../src/lib/vehicle-import";
import { slugify } from "../../src/lib/vehicle-reference";
import {
  listEngines,
  listGenerations,
  listMakes,
  listModels,
} from "../../src/lib/vehicles";
import { insertCustomer, setupTestDatabase } from "./database";

let adminId = "";
const db = setupTestDatabase({
  async prepare({ pool }) {
    adminId = await insertCustomer(pool, { isAdmin: true });
  },
});

const run = (csv: string, apply = false) =>
  importVehicles(db().pool, adminId, csv, { apply, filename: "ref.csv" });

// Fictional reference rows: tests never use real vehicle data.
const REFERENCE = [
  "make;model;generation;year_from;year_to;engine;fuel;displacement_cc;power_kw;engine_code",
  "Testmake;Alpha;Alpha I;2010;2016;1.6 diesel;diesel;1600;85;TD16",
  "Testmake;Alpha;Alpha I;2010;2016;1.4 petrol;petrol;1400;90;",
  "Testmake;Alpha;Alpha II;2016;;;;;;",
  "Škoda-Test;Gamma;Gamma I;2001;2005;;;;;",
].join("\n");

test("slugs come from Latin names", () => {
  assert.equal(slugify("Mercedes-Benz"), "mercedes-benz");
  assert.equal(slugify("Škoda"), "skoda");
  assert.equal(slugify("  Alfa  Romeo "), "alfa-romeo");
  assert.equal(slugify("Лада"), "");
});

test("a check reports rows and changes nothing", async () => {
  const report = await run(REFERENCE);
  assert.equal(report.applied, false);
  assert.deepEqual(report.summary, {
    create: 4,
    update: 0,
    unchanged: 0,
    error: 0,
  });
  // Later rows reuse what earlier rows created within the same check.
  assert.equal(report.rows[1].key, "Testmake · Alpha · Alpha I · 1.4 petrol");
  assert.deepEqual(await listMakes(db().pool), []);
});

test("apply builds the tree; a re-import is unchanged", async () => {
  const { pool } = db();
  const report = await run(REFERENCE, true);
  assert.equal(report.applied, true);
  const makes = await listMakes(pool);
  assert.deepEqual(
    makes.map((m) => m.slug),
    ["skoda-test", "testmake"],
  );
  const testmake = makes.find((m) => m.slug === "testmake")!;
  const [alpha] = await listModels(pool, testmake.id);
  const generations = await listGenerations(pool, alpha.id);
  assert.deepEqual(
    generations.map((g) => [g.name, g.yearFrom, g.yearTo]),
    [
      ["Alpha I", 2010, 2016],
      ["Alpha II", 2016, null],
    ],
  );
  const engines = await listEngines(pool, generations[0].id);
  assert.deepEqual(
    engines.map((e) => [e.name, e.fuel, e.engineCode]),
    [
      ["1.6 diesel", "diesel", "TD16"],
      ["1.4 petrol", "petrol", ""],
    ],
  );
  const again = await run(REFERENCE, true);
  assert.deepEqual(again.summary, {
    create: 0,
    update: 0,
    unchanged: 4,
    error: 0,
  });
  const audit = await pool.query(
    "SELECT count(*)::int n FROM admin_audit_log WHERE action='vehicle.import'",
  );
  assert.equal(audit.rows[0].n, 2);
});

test("corrections update years and engine data", async () => {
  const { pool } = db();
  const report = await run(
    [
      "make,model,generation,year_from,year_to,engine,fuel,power_kw",
      "Testmake,Alpha,Alpha I,2010,2015,1.6 diesel,diesel,88",
    ].join("\n"),
    true,
  );
  assert.deepEqual(report.summary, {
    create: 0,
    update: 1,
    unchanged: 0,
    error: 0,
  });
  const testmake = (await listMakes(pool)).find((m) => m.slug === "testmake")!;
  const [alpha] = await listModels(pool, testmake.id);
  const [first] = await listGenerations(pool, alpha.id);
  assert.equal(first.yearTo, 2015);
  const diesel = (await listEngines(pool, first.id)).find(
    (e) => e.name === "1.6 diesel",
  )!;
  assert.equal(diesel.powerKw, 88);
  // A row is the full record: a column left out becomes unknown.
  assert.equal(diesel.displacementCc, null);
});

test("row errors block the apply and are reported per row", async () => {
  const csv = [
    "make,model,generation,year_from,year_to,engine,fuel,displacement_cc",
    "Newmake,One,One I,2010,,1.0,petrol,1000",
    ",One,One I,2010,,,,",
    "Newmake,One,One II,,,,,",
    "Newmake,One,One III,2010,2009,,,",
    "Newmake,One,One IV,1900,,,,",
    "Newmake,One,One I,2010,,1.2,steam,",
    "Newmake,One,One I,2010,,,petrol,",
    "Лада,Нива,I,1977,,,,",
    "Newmake,One,One I,2010,,1.0,petrol,1000",
    "Newmake,One,One I,2010,,1.3,diesel,99999",
  ].join("\n");
  const report = await run(csv, true);
  assert.equal(report.applied, false);
  const errors = report.rows.map((r) => r.errors.join(" "));
  assert.equal(report.rows[0].action, "create");
  assert.match(errors[1], /Липсва марка/);
  assert.match(errors[2], /начална година/);
  assert.match(errors[3], /преди началната/);
  assert.match(errors[4], /от 1950 до 2100/);
  assert.match(errors[5], /Горивото/);
  assert.match(errors[6], /без име на двигател/);
  assert.match(errors[7], /латински букви/);
  assert.match(errors[8], /повтаря \(ред 2\)/);
  assert.match(errors[9], /Обемът/);
  assert.equal(
    (await listMakes(db().pool)).some((m) => m.slug === "newmake"),
    false,
  );
});

test("a file must describe each make, model and generation consistently", async () => {
  const report = await run(
    [
      "make,make_slug,model,generation,year_from,year_to,engine,fuel",
      "VW Test,vw-test,Delta,Delta I,2000,2004,1.0,petrol",
      "Volkswagen Test,vw-test,Delta,Delta I,2000,2004,1.2,petrol",
      "VW Test,vw-test,Delta,Delta I,2000,2005,1.4,petrol",
    ].join("\n"),
  );
  assert.equal(report.rows[0].action, "create");
  assert.match(report.rows[1].errors[0], /марката се различава от ред 2/);
  assert.match(report.rows[2].errors[0], /поколението се различава от ред 2/);
});

test("an explicit slug allows Cyrillic names", async () => {
  const report = await run(
    "make,make_slug,model,model_slug,generation,year_from\nЛада,lada-test,Нива,niva-test,I,1977\n",
    true,
  );
  assert.equal(report.applied, true);
  assert.ok((await listMakes(db().pool)).some((m) => m.name === "Лада"));
});

test("file-level problems", async () => {
  assert.match(
    (await run("make,model\nA,B")).error!,
    /Липсва колона generation/,
  );
  assert.match(
    (await run("make,model,generation,year_from,colour\nA,B,C,2000,red"))
      .error!,
    /Непознати колони: colour/,
  );
  assert.match((await run("make\n�")).error!, /UTF-8/);
});

test("the overview counts the tree; hiding a model is audited", async () => {
  const { pool } = db();
  const tree = await referenceTree(pool);
  const testmake = tree.find((m) => m.slug === "testmake")!;
  assert.deepEqual(
    testmake.models.map((m) => [m.slug, m.generations, m.engines, m.fitments]),
    [["alpha", 2, 2, 0]],
  );
  const alpha = testmake.models[0];
  await setReferenceActive(pool, adminId, "model", alpha.id, false);
  // Unchanged visibility writes no second audit entry.
  await setReferenceActive(pool, adminId, "model", alpha.id, false);
  assert.deepEqual(await listModels(pool, testmake.id), []);
  const audit = await pool.query(
    "SELECT details FROM admin_audit_log WHERE action='vehicle.visibility'",
  );
  assert.deepEqual(
    audit.rows.map((r) => r.details),
    [{ active: { from: true, to: false } }],
  );
  await assert.rejects(
    setReferenceActive(
      pool,
      adminId,
      "make",
      "00000000-0000-4000-8000-000000000000",
      true,
    ),
    /не е намерена/,
  );
});
