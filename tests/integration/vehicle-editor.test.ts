import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { saveFitment } from "../../src/lib/admin-fitments";
import { AdminProductError } from "../../src/lib/admin-products";
import {
  createReference,
  createReferenceSchemas,
  isReferenceKind,
  referenceModel,
  referenceSchemas,
  referenceTree,
  setReferenceActive,
  updateReference,
} from "../../src/lib/admin-vehicles";
import {
  generationsOfModel,
  makesWithCounts,
  modelProductSkus,
  modelsOfMake,
} from "../../src/lib/car-pages";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { importVehicles } from "../../src/lib/vehicle-import";
import { resolveSelection } from "../../src/lib/vehicle-selection";
import {
  compatibleSkus,
  fitStatuses,
  listEngines,
  listGenerations,
  productFitments,
} from "../../src/lib/vehicles";
import { insertCustomer, setupTestDatabase } from "./database";

// Fictional vehicles only.
let admin = "";
const ids = { make: "", model: "", generation: "", engine: "", other: "" };
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    admin = await insertCustomer(pool, { isAdmin: true });
    const add = (kind: keyof typeof createReferenceSchemas, input: object) =>
      createReference(
        pool,
        admin,
        kind,
        createReferenceSchemas[kind].parse(input),
      );
    ids.make = await add("make", { name: "  Testmake   Motors " });
    ids.model = await add("model", { name: "Alpha", parentId: ids.make });
    ids.generation = await add("generation", {
      name: "Alpha I",
      parentId: ids.model,
      yearFrom: 2010,
      yearTo: 2016,
    });
    ids.engine = await add("engine", {
      name: "1.6 d",
      parentId: ids.generation,
      fuel: "diesel",
      displacementCc: 1598,
      powerKw: 77,
    });
    ids.other = await add("engine", {
      name: "1.4",
      parentId: ids.generation,
      fuel: "petrol",
    });
    const fit = (
      sku: string,
      engineId: string | null,
      yearFrom: number | null = null,
    ) =>
      saveFitment(pool, admin, sku, {
        generationId: ids.generation,
        engineId,
        yearFrom,
        yearTo: null,
        notes: "",
        source: "Test catalogue",
      });
    await fit("DEMO-003", null);
    await fit("DEMO-004", ids.engine);
    await fit("DEMO-005", null, 2013);
  },
});

const refused = (promise: Promise<unknown>, status: number, message: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminProductError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, message);
    return true;
  });
const add = (kind: keyof typeof createReferenceSchemas, input: object) =>
  createReference(
    db().pool,
    admin,
    kind,
    createReferenceSchemas[kind].parse(input),
  );
const hide = (
  kind: "make" | "model" | "generation" | "engine",
  id: string,
  active = false,
) => setReferenceActive(db().pool, admin, kind, id, active);
const skus = async () => (await modelProductSkus(db().pool, ids.model)).skus;

test("entries are added under their parent with derived addresses", async () => {
  const [make] = await referenceTree(db().pool);
  assert.equal(make.name, "Testmake Motors");
  assert.equal(make.slug, "testmake-motors");
  assert.equal(make.models[0].engines, 2);
  const model = (await referenceModel(db().pool, ids.model))!;
  assert.equal(model.make, "Testmake Motors");
  assert.deepEqual(
    model.generations[0].engines.map((e) => [e.name, e.fuel, e.fitments]),
    [
      ["1.6 d", "diesel", 1],
      ["1.4", "petrol", 0],
    ],
  );
  assert.equal(model.generations[0].fitments, 2);
  assert.equal(await referenceModel(db().pool, randomUUID()), null);
  // A name without Latin letters needs an address.
  await refused(add("make", { name: "Лада" }), 400, /латински/);
  const cyrillic = await add("make", { name: "Тест", slug: "test-bg" });
  assert.ok(cyrillic);
});

test("duplicates and missing parents are refused", async () => {
  await refused(
    add("make", { name: "testmake motors" }),
    409,
    /Вече има марка/,
  );
  await refused(
    add("model", { name: "ALPHA", parentId: ids.make }),
    409,
    /вече има модел/,
  );
  await refused(
    add("generation", {
      name: "Alpha I",
      parentId: ids.model,
      yearFrom: 2000,
    }),
    409,
    /вече има поколение/,
  );
  await refused(
    add("engine", { name: "1.4", parentId: ids.generation, fuel: "lpg" }),
    409,
    /вече има двигател/,
  );
  for (const [kind, input] of [
    ["model", { name: "X" }],
    ["generation", { name: "X", yearFrom: 2000 }],
    ["engine", { name: "X", fuel: "lpg" }],
  ] as const)
    await refused(
      add(kind, { ...input, parentId: randomUUID() }),
      404,
      /не е намерен/,
    );
});

test("input rules", () => {
  for (const [kind, input] of [
    ["make", { name: " " }],
    ["make", { name: "x".repeat(101) }],
    ["make", { name: "a\u0000b" }],
    ["make", { name: "X", slug: "Not A Slug" }],
    ["model", { name: "X" }],
    ["model", { name: "X", parentId: "1" }],
    ["generation", { name: "X", parentId: randomUUID() }],
    ["generation", { name: "X", parentId: randomUUID(), yearFrom: 1800 }],
    [
      "generation",
      { name: "X", parentId: randomUUID(), yearFrom: 2010, yearTo: 2009 },
    ],
    ["engine", { name: "X", parentId: randomUUID(), fuel: "steam" }],
    ["engine", { name: "X", parentId: randomUUID(), fuel: "lpg", powerKw: 0 }],
    [
      "engine",
      { name: "X", parentId: randomUUID(), fuel: "lpg", displacementCc: 1.5 },
    ],
  ] as const)
    assert.equal(
      createReferenceSchemas[kind].safeParse(input).success,
      false,
      JSON.stringify(input),
    );
  assert.equal(isReferenceKind("engine"), true);
  for (const kind of ["makes", "constructor", "", "toString"])
    assert.equal(isReferenceKind(kind), false);
});

test("edits bump the version, refuse stale copies and are audited", async () => {
  const { pool } = db();
  const id = await add("make", { name: "Editme" });
  await updateReference(
    pool,
    admin,
    "make",
    id,
    1,
    referenceSchemas.make.parse({ name: "Edited" }),
  );
  await refused(
    updateReference(pool, admin, "make", id, 1, { name: "Late" }),
    409,
    /междувременно/,
  );
  await refused(
    updateReference(pool, admin, "make", randomUUID(), 1, { name: "X" }),
    404,
    /не е намерена/,
  );
  const make = (await referenceTree(pool)).find((m) => m.id === id)!;
  // The address is a URL: it does not follow the name.
  assert.deepEqual(
    [make.name, make.slug, make.version],
    ["Edited", "editme", 2],
  );
  // Saving without changes is not a change.
  await updateReference(pool, admin, "make", id, 2, { name: "Edited" });
  const audit = await pool.query(
    "SELECT action, details FROM admin_audit_log WHERE entity_type = 'vehicle_make' AND entity_id = $1 ORDER BY created_at",
    [id],
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["vehicle.create", "vehicle.update"],
  );
  assert.deepEqual(audit.rows[1].details.changes, {
    name: { from: "Editme", to: "Edited" },
  });
  // Renaming onto a sibling's name is refused.
  const other = await add("engine", {
    name: "2.0",
    parentId: ids.generation,
    fuel: "petrol",
  });
  await refused(
    updateReference(pool, admin, "engine", other, 1, {
      name: "1.4",
      fuel: "petrol",
      engineCode: "",
    }),
    409,
    /вече има двигател/,
  );
  // A CSV import counts as a newer version too.
  await importVehicles(
    pool,
    admin,
    "make;make_slug;model;generation;year_from\nEdited by CSV;editme;M;G;2000\n",
    { apply: true },
  );
  await refused(
    updateReference(pool, admin, "make", id, 2, { name: "Late" }),
    409,
    /междувременно/,
  );
});

test("a generation's years cannot leave a verified fitment outside", async () => {
  const { pool } = db();
  const years = (yearFrom: number, yearTo: number | null) =>
    referenceSchemas.generation.parse({ name: "Alpha I", yearFrom, yearTo });
  await refused(
    updateReference(
      pool,
      admin,
      "generation",
      ids.generation,
      1,
      years(2014, 2016),
    ),
    409,
    /DEMO-005/,
  );
  await refused(
    updateReference(
      pool,
      admin,
      "generation",
      ids.generation,
      1,
      years(2010, 2012),
    ),
    409,
    /DEMO-005/,
  );
  // The CSV import follows the same rule and applies nothing.
  const report = await importVehicles(
    pool,
    admin,
    "make;model;generation;year_from;year_to\nTestmake Motors;Alpha;Alpha I;2014;2016\n",
    { apply: true },
  );
  assert.equal(report.applied, false);
  assert.match(report.rows[0].errors.join(" "), /DEMO-005/);
  // Wider years and years that keep the fitment inside are fine.
  await updateReference(
    pool,
    admin,
    "generation",
    ids.generation,
    1,
    years(2009, null),
  );
  await updateReference(
    pool,
    admin,
    "generation",
    ids.generation,
    2,
    years(2010, 2016),
  );
  const unchanged = await importVehicles(
    pool,
    admin,
    "make;model;generation;year_from;year_to\nTestmake Motors;Alpha;Alpha I;2010;2016\n",
    { apply: true },
  );
  assert.equal(unchanged.rows[0].action, "unchanged");
});

test("a hidden engine disappears for shoppers, with its fitments", async () => {
  const { pool } = db();
  const selection = {
    generationId: ids.generation,
    engineId: ids.engine,
    year: 2014,
  };
  assert.ok(await resolveSelection(pool, selection));
  assert.deepEqual(await skus(), ["DEMO-003", "DEMO-004", "DEMO-005"]);
  await hide("engine", ids.engine);
  try {
    assert.ok(
      !(await listEngines(pool, ids.generation)).some(
        (e) => e.id === ids.engine,
      ),
    );
    assert.equal(await resolveSelection(pool, selection), null);
    assert.ok(
      await resolveSelection(pool, { ...selection, engineId: ids.other }),
    );
    assert.deepEqual(await skus(), ["DEMO-003", "DEMO-005"]);
    assert.deepEqual(await productFitments(pool, "DEMO-004"), []);
    assert.ok(!(await compatibleSkus(pool, selection)).includes("DEMO-004"));
    assert.deepEqual(
      await fitStatuses(pool, ["DEMO-003", "DEMO-004"], {
        ...selection,
        engineId: null,
      }),
      { "DEMO-003": "fits" },
    );
  } finally {
    await hide("engine", ids.engine, true);
  }
  assert.deepEqual(await skus(), ["DEMO-003", "DEMO-004", "DEMO-005"]);
  assert.equal((await productFitments(pool, "DEMO-004")).length, 1);
});

test("a hidden generation disappears for shoppers, with everything below", async () => {
  const { pool } = db();
  await hide("generation", ids.generation);
  try {
    assert.deepEqual(await listGenerations(pool, ids.model), []);
    assert.deepEqual(await listEngines(pool, ids.generation), []);
    assert.deepEqual(await generationsOfModel(pool, ids.model), []);
    assert.equal(
      await resolveSelection(pool, {
        generationId: ids.generation,
        engineId: null,
        year: null,
      }),
      null,
    );
    assert.deepEqual(await skus(), []);
    assert.deepEqual(await productFitments(pool, "DEMO-003"), []);
    const [model] = await modelsOfMake(pool, ids.make);
    assert.deepEqual([model.yearFrom, model.products], [null, 0]);
    const make = (await makesWithCounts(pool)).find((m) => m.id === ids.make)!;
    assert.equal(make.products, 0);
  } finally {
    await hide("generation", ids.generation, true);
  }
  const [model] = await modelsOfMake(pool, ids.make);
  assert.deepEqual([model.yearFrom, model.products], [2010, 3]);
  // The admin still sees hidden ones; hiding is audited.
  const audit = await pool.query(
    "SELECT details FROM admin_audit_log WHERE action = 'vehicle.visibility' AND entity_id = $1 ORDER BY created_at",
    [ids.generation],
  );
  assert.deepEqual(
    audit.rows.map((r) => r.details.active.to),
    [false, true],
  );
  await refused(hide("generation", randomUUID()), 404, /не е намерено/);
});
