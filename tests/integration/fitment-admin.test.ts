import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listAdminFitments,
  removeFitmentById,
  saveFitment,
} from "../../src/lib/admin-fitments";
import {
  AdminProductError,
  productHistory,
} from "../../src/lib/admin-products";
import { importFitments } from "../../src/lib/fitment-import";
import { importVehicles } from "../../src/lib/vehicle-import";
import { compatibleSkus } from "../../src/lib/vehicles";
import { insertCustomer, setupTestDatabase } from "./database";

let adminId = "";
const ids: Record<string, string> = {};
const db = setupTestDatabase({
  async prepare({ pool }) {
    adminId = await insertCustomer(pool, { isAdmin: true });
    // Fictional reference data.
    const reference = await importVehicles(
      pool,
      adminId,
      [
        "make;model;generation;year_from;year_to;engine;fuel",
        "Testmake;Alpha;Alpha I;2010;2016;1.6 diesel;diesel",
        "Testmake;Alpha;Alpha I;2010;2016;1.4 petrol;petrol",
        "Testmake;Alpha;Alpha II;2016;;2.0 petrol;petrol",
      ].join("\n"),
      { apply: true },
    );
    assert.equal(reference.applied, true);
    const rows = await pool.query<{ name: string; id: string }>(
      `SELECT g.name, g.id FROM vehicle_generations g
       UNION ALL SELECT e.name, e.id FROM vehicle_engines e`,
    );
    for (const row of rows.rows) ids[row.name] = row.id;
    for (const sku of ["PAD-1", "PAD-2"])
      await pool.query(
        "INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,status) VALUES($1,$1,'','','','published')",
        [sku],
      );
  },
});

const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminProductError, String(error));
    assert.match(error.message, pattern);
    return true;
  });

test("the editor adds, updates and removes fitments with audit", async () => {
  const { pool } = db();
  const base = {
    generationId: ids["Alpha I"],
    engineId: ids["1.6 diesel"],
    yearFrom: null,
    yearTo: null,
    notes: "",
    source: "Test catalogue p. 12",
  };
  assert.equal(await saveFitment(pool, adminId, "PAD-1", base), "create");
  assert.equal(await saveFitment(pool, adminId, "PAD-1", base), "unchanged");
  assert.equal(
    await saveFitment(pool, adminId, "PAD-1", { ...base, notes: "Front" }),
    "update",
  );
  const [fitment] = await listAdminFitments(pool, "PAD-1");
  assert.equal(fitment.engine, "1.6 diesel");
  assert.deepEqual(fitment.generationYears, [2010, 2016]);
  assert.deepEqual(
    await compatibleSkus(pool, {
      generationId: ids["Alpha I"],
      engineId: ids["1.6 diesel"],
    }),
    ["PAD-1"],
  );
  await removeFitmentById(pool, adminId, "PAD-1", fitment.id);
  assert.deepEqual(await listAdminFitments(pool, "PAD-1"), []);
  const actions = (await productHistory(pool, "PAD-1")).map((h) => h.action);
  assert.deepEqual(actions, [
    "fitment.remove",
    "fitment.update",
    "fitment.add",
  ]);
  await rejects(
    removeFitmentById(pool, adminId, "PAD-2", fitment.id),
    /не е намерена/,
  );
});

test("the editor refuses fitments that are not consistent", async () => {
  const { pool } = db();
  const base = {
    generationId: ids["Alpha I"],
    engineId: null,
    yearFrom: null,
    yearTo: null,
    notes: "",
    source: "Test catalogue",
  };
  await rejects(
    saveFitment(pool, adminId, "PAD-1", {
      ...base,
      engineId: ids["2.0 petrol"],
    }),
    /не е от това поколение/,
  );
  await rejects(
    saveFitment(pool, adminId, "PAD-1", { ...base, yearFrom: 2008 }),
    /периода на поколението \(2010–2016\)/,
  );
  await rejects(
    saveFitment(pool, adminId, "NOPE", base),
    /Продуктът не е намерен/,
  );
  await rejects(
    saveFitment(pool, adminId, "PAD-1", {
      ...base,
      generationId: "00000000-0000-4000-8000-000000000000",
    }),
    /Непознато поколение/,
  );
});

test("fitment CSV: check, apply, re-import and removal", async () => {
  const { pool } = db();
  const csv = [
    "sku;make;model;generation;engine;year_from;year_to;notes;source",
    "PAD-2;Testmake;Alpha;Alpha I;;;;;Test catalogue",
    "PAD-2;Testmake;Alpha;Alpha II;2.0 petrol;2018;;Rear;Test catalogue",
  ].join("\n");
  const check = await importFitments(pool, adminId, csv, { apply: false });
  assert.deepEqual(check.summary, {
    create: 2,
    update: 0,
    unchanged: 0,
    remove: 0,
    error: 0,
  });
  assert.deepEqual(await listAdminFitments(pool, "PAD-2"), []);
  const applied = await importFitments(pool, adminId, csv, { apply: true });
  assert.equal(applied.applied, true);
  assert.equal((await listAdminFitments(pool, "PAD-2")).length, 2);
  const again = await importFitments(pool, adminId, csv, { apply: true });
  assert.equal(again.summary.unchanged, 2);
  const removal = await importFitments(
    pool,
    adminId,
    "sku,make,model,generation,remove\nPAD-2,Testmake,Alpha,Alpha I,yes\n",
    { apply: true },
  );
  assert.equal(removal.summary.remove, 1);
  assert.equal((await listAdminFitments(pool, "PAD-2")).length, 1);
});

test("fitment CSV: row errors block the apply", async () => {
  const { pool } = db();
  const csv = [
    "sku,make,model,generation,engine,year_from,source,remove",
    "PAD-1,Testmake,Alpha,Alpha I,,,Test catalogue,",
    "PAD-1,Testmake,Alpha,Alpha III,,,Test catalogue,",
    "PAD-1,Testmake,Alpha,Alpha I,9.9 jet,,Test catalogue,",
    "PAD-1,Testmake,Alpha,Alpha I,1.4 petrol,,,",
    "NOPE,Testmake,Alpha,Alpha I,,,Test catalogue,",
    "PAD-1,Testmake,Alpha,Alpha I,1.4 petrol,20xx,Test catalogue,",
    "PAD-1,Testmake,Alpha,Alpha II,,,,yes",
    "PAD-1,Testmake,Alpha,Alpha I,,,Test catalogue,",
    "PAD-1,Testmake,Alpha,Alpha I,1.6 diesel,,Test catalogue,maybe",
  ].join("\n");
  const report = await importFitments(pool, adminId, csv, { apply: true });
  assert.equal(report.applied, false);
  const errors = report.rows.map((r) => r.errors.join(" "));
  assert.equal(report.rows[0].action, "create");
  assert.match(errors[1], /Няма такова поколение/);
  assert.match(errors[2], /не е в това поколение/);
  assert.match(errors[3], /Посочи източника/);
  assert.match(errors[4], /Продуктът не е намерен/);
  assert.match(errors[5], /четирицифрено/);
  assert.match(errors[6], /Няма такава съвместимост/);
  assert.match(errors[7], /повтаря \(ред 2\)/);
  assert.match(errors[8], /remove е yes или no/);
  assert.deepEqual(await listAdminFitments(pool, "PAD-1"), []);
});
