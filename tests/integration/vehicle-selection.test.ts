import assert from "node:assert/strict";
import { test } from "node:test";
import { importVehicles } from "../../src/lib/vehicle-import";
import {
  garageSelection,
  parseSelectionCookie,
  resolveSelection,
  saveToGarage,
  selectionCookieValue,
  vehicleFromCookie,
} from "../../src/lib/vehicle-selection";
import { insertCustomer, setupTestDatabase } from "./database";

const ids: Record<string, string> = {};
let customer = "";
let other = "";
const db = setupTestDatabase({
  async prepare({ pool }) {
    const admin = await insertCustomer(pool, { isAdmin: true });
    customer = await insertCustomer(pool);
    other = await insertCustomer(pool);
    // Fictional reference data.
    await importVehicles(
      pool,
      admin,
      [
        "make;model;generation;year_from;year_to;engine;fuel",
        "Testmake;Alpha;Alpha I;2010;2016;1.6 diesel;diesel",
        "Testmake;Alpha;Alpha II;2016;;2.0 petrol;petrol",
        "Testmake;Beta;Beta I;2012;2018;;",
      ].join("\n"),
      { apply: true },
    );
    const rows = await pool.query<{ name: string; id: string }>(
      `SELECT g.name, g.id FROM vehicle_generations g
       UNION ALL SELECT e.name, e.id FROM vehicle_engines e
       UNION ALL SELECT m.name, m.id FROM vehicle_models m`,
    );
    for (const row of rows.rows) ids[row.name] = row.id;
  },
});

test("the cookie round-trips and rejects junk", () => {
  const selection = {
    generationId: "11111111-1111-4111-8111-111111111111",
    engineId: null,
    year: 2014,
  };
  assert.deepEqual(
    parseSelectionCookie(selectionCookieValue(selection)),
    selection,
  );
  assert.equal(parseSelectionCookie(undefined), null);
  assert.equal(parseSelectionCookie("not json"), null);
  assert.equal(
    parseSelectionCookie(encodeURIComponent('{"generationId":"x"}')),
    null,
  );
});

test("selections resolve against the active reference only", async () => {
  const { pool } = db();
  const resolved = await resolveSelection(pool, {
    generationId: ids["Alpha I"],
    engineId: ids["1.6 diesel"],
    year: 2014,
  });
  assert.equal(resolved?.label, "Testmake Alpha Alpha I, 2014, 1.6 diesel");
  // Engine of another generation, year outside the generation, unknown id.
  assert.equal(
    await resolveSelection(pool, {
      generationId: ids["Alpha I"],
      engineId: ids["2.0 petrol"],
      year: null,
    }),
    null,
  );
  assert.equal(
    await resolveSelection(pool, {
      generationId: ids["Alpha I"],
      engineId: null,
      year: 2018,
    }),
    null,
  );
  assert.equal(
    await resolveSelection(pool, {
      generationId: "00000000-0000-4000-8000-000000000000",
      engineId: null,
      year: null,
    }),
    null,
  );
  // An open-ended generation accepts recent years; a hidden model does not resolve.
  assert.ok(
    await resolveSelection(pool, {
      generationId: ids["Alpha II"],
      engineId: null,
      year: 2024,
    }),
  );
  await pool.query("UPDATE vehicle_models SET active=false WHERE id=$1", [
    ids["Beta"],
  ]);
  assert.equal(
    await resolveSelection(pool, {
      generationId: ids["Beta I"],
      engineId: null,
      year: 2014,
    }),
    null,
  );
});

test("saving to the garage reuses identical vehicles and selects them", async () => {
  const { pool } = db();
  const vehicle = (await resolveSelection(pool, {
    generationId: ids["Alpha I"],
    engineId: ids["1.6 diesel"],
    year: 2014,
  }))!;
  const first = await saveToGarage(pool, customer, vehicle);
  const again = await saveToGarage(pool, customer, vehicle);
  assert.equal(first, again);
  const rows = await pool.query(
    "SELECT make, model, year, engine, is_selected FROM garage_vehicles WHERE customer_id=$1",
    [customer],
  );
  assert.deepEqual(rows.rows, [
    {
      make: "Testmake",
      model: "Alpha Alpha I",
      year: 2014,
      engine: "1.6 diesel",
      is_selected: true,
    },
  ]);
  assert.deepEqual(await garageSelection(pool, customer, first), {
    generationId: ids["Alpha I"],
    engineId: ids["1.6 diesel"],
    year: 2014,
  });
  // Another customer cannot use this garage vehicle.
  assert.equal(await garageSelection(pool, other, first), null);
  await assert.rejects(
    saveToGarage(pool, customer, { ...vehicle, year: null }),
    /Избери година/,
  );
});

test("the garage keeps at most ten vehicles", async () => {
  const { pool } = db();
  for (let year = 2010; year <= 2016; year++)
    await saveToGarage(
      pool,
      other,
      (await resolveSelection(pool, {
        generationId: ids["Alpha I"],
        engineId: null,
        year,
      }))!,
    );
  for (let year = 2016; year <= 2018; year++)
    await saveToGarage(
      pool,
      other,
      (await resolveSelection(pool, {
        generationId: ids["Alpha II"],
        engineId: null,
        year,
      }))!,
    );
  const eleventh = (await resolveSelection(pool, {
    generationId: ids["Alpha II"],
    engineId: null,
    year: 2019,
  }))!;
  await assert.rejects(saveToGarage(pool, other, eleventh), /до 10 автомобила/);
  const selected = await pool.query(
    "SELECT count(*)::int n FROM garage_vehicles WHERE customer_id=$1 AND is_selected",
    [other],
  );
  assert.equal(selected.rows[0].n, 1);
});

test("the header's vehicle comes from the cookie, never failing the page", async () => {
  const cookie = selectionCookieValue({
    generationId: ids["Alpha I"],
    engineId: ids["1.6 diesel"],
    year: 2014,
  });
  const vehicle = await vehicleFromCookie(db().pool, cookie);
  assert.equal(vehicle?.label, "Testmake Alpha Alpha I, 2014, 1.6 diesel");
  assert.equal(await vehicleFromCookie(db().pool, undefined), null);
  assert.equal(await vehicleFromCookie(db().pool, "junk"), null);
  // A year outside the generation, or an unknown generation: nothing shown.
  assert.equal(
    await vehicleFromCookie(
      db().pool,
      selectionCookieValue({
        generationId: ids["Alpha I"],
        engineId: null,
        year: 2030,
      }),
    ),
    null,
  );
  const broken = {
    query: async () => {
      throw new Error("connection lost");
    },
  } as unknown as Parameters<typeof vehicleFromCookie>[0];
  assert.equal(await vehicleFromCookie(broken, cookie), null);
});
