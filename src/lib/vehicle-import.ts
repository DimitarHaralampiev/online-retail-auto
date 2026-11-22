// CSV import of the vehicle reference (make > model > generation > engine),
// with a dry run, for data taken from a verified source (ADR 0002, #91).
//
// One row describes one engine of a generation, or a generation without
// engines. Rows create what is missing and update what differs: a make or
// model is matched by slug (derived from its name unless given), a
// generation by name within its model, an engine by name within its
// generation. Nothing is deleted.
//
// Like the product import, a check and an apply run the same code in one
// transaction; the check always rolls back and the apply commits only when
// no row has an error. Each row runs in a savepoint and later rows see the
// makes and models that earlier rows created.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { CsvError, parseCsv } from "./csv";
import { FUELS, type Fuel } from "./vehicles";

export const VEHICLE_IMPORT_COLUMNS = [
  "make",
  "make_slug",
  "model",
  "model_slug",
  "generation",
  "year_from",
  "year_to",
  "engine",
  "fuel",
  "displacement_cc",
  "power_kw",
  "engine_code",
] as const;
type Column = (typeof VEHICLE_IMPORT_COLUMNS)[number];

export const MAX_VEHICLE_IMPORT_ROWS = 5000;

export type VehicleRowResult = {
  line: number;
  key: string;
  action: "create" | "update" | "unchanged" | "error";
  errors: string[];
};

export type VehicleImportReport = {
  applied: boolean;
  error?: string;
  rows: VehicleRowResult[];
  summary: Record<VehicleRowResult["action"], number>;
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Mercedes-Benz" → "mercedes-benz", "Škoda" → "skoda"; "" when no Latin. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

class RowError extends Error {}

type Row = {
  make: { slug: string; name: string };
  model: { slug: string; name: string };
  generation: { name: string; yearFrom: number; yearTo: number | null };
  engine: {
    name: string;
    fuel: Fuel;
    displacementCc: number | null;
    powerKw: number | null;
    engineCode: string;
  } | null;
};

function name(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new RowError(`Липсва ${label}.`);
  if (trimmed.length > 100) throw new RowError(`${label} е до 100 знака.`);
  if (trimmed.includes("\u0000"))
    throw new RowError("Текстът съдържа недопустими знаци.");
  return trimmed;
}

function slug(explicit: string, from: string, label: string): string {
  const value = explicit.trim() || slugify(from);
  if (!value)
    throw new RowError(
      `Задай ${label} с латински букви (името няма латински знаци).`,
    );
  if (!SLUG.test(value) || value.length > 60)
    throw new RowError(
      `${label} трябва да е от малки латински букви, цифри и тирета.`,
    );
  return value;
}

function whole(
  value: string,
  label: string,
  min: number,
  max: number,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{1,5}$/.test(trimmed) || +trimmed < min || +trimmed > max)
    throw new RowError(`${label} трябва да е цяло число от ${min} до ${max}.`);
  return Number(trimmed);
}

function parseRow(cell: (column: Column) => string): Row {
  const makeName = name(cell("make"), "марка");
  const modelName = name(cell("model"), "модел");
  const yearFrom = whole(cell("year_from"), "Началната година", 1950, 2100);
  if (yearFrom === null) throw new RowError("Липсва начална година.");
  const yearTo = whole(cell("year_to"), "Крайната година", 1950, 2100);
  if (yearTo !== null && yearTo < yearFrom)
    throw new RowError("Крайната година е преди началната.");
  let engine: Row["engine"] = null;
  if (cell("engine").trim()) {
    const fuel = cell("fuel").trim().toLowerCase();
    if (!(FUELS as readonly string[]).includes(fuel))
      throw new RowError(`Горивото е едно от: ${FUELS.join(", ")}.`);
    const engineCode = cell("engine_code").trim();
    if (engineCode.length > 60)
      throw new RowError("Кодът на двигателя е до 60 знака.");
    engine = {
      name: name(cell("engine"), "двигател"),
      fuel: fuel as Fuel,
      displacementCc: whole(cell("displacement_cc"), "Обемът", 1, 20000),
      powerKw: whole(cell("power_kw"), "Мощността (kW)", 1, 2000),
      engineCode,
    };
  } else if (
    ["fuel", "displacement_cc", "power_kw", "engine_code"].some((c) =>
      cell(c as Column).trim(),
    )
  )
    throw new RowError("Данни за двигател без име на двигател.");
  return {
    make: {
      name: makeName,
      slug: slug(cell("make_slug"), makeName, "make_slug"),
    },
    model: {
      name: modelName,
      slug: slug(cell("model_slug"), modelName, "model_slug"),
    },
    generation: {
      name: name(cell("generation"), "поколение"),
      yearFrom,
      yearTo,
    },
    engine,
  };
}

type Outcome = { created: boolean; updated: boolean };

async function upsert(
  client: pg.PoolClient,
  outcome: Outcome,
  find: { sql: string; params: unknown[] },
  insert: { sql: string; params: (id: string) => unknown[] },
  differs: (row: Record<string, unknown>) => boolean,
  update: { sql: string; params: (id: string) => unknown[] },
): Promise<string> {
  const found = await client.query<Record<string, unknown> & { id: string }>(
    `${find.sql} FOR UPDATE`,
    find.params,
  );
  if (!found.rowCount) {
    const id = randomUUID();
    await client.query(insert.sql, insert.params(id));
    outcome.created = true;
    return id;
  }
  const row = found.rows[0];
  if (differs(row)) {
    await client.query(update.sql, update.params(row.id));
    outcome.updated = true;
  }
  return row.id;
}

async function applyRow(
  client: pg.PoolClient,
  row: Row,
): Promise<VehicleRowResult["action"]> {
  const outcome: Outcome = { created: false, updated: false };
  const makeId = await upsert(
    client,
    outcome,
    {
      sql: "SELECT id, name FROM vehicle_makes WHERE slug = $1",
      params: [row.make.slug],
    },
    {
      sql: "INSERT INTO vehicle_makes(id,slug,name) VALUES($1,$2,$3)",
      params: (id) => [id, row.make.slug, row.make.name],
    },
    (found) => found.name !== row.make.name,
    {
      sql: "UPDATE vehicle_makes SET name = $2 WHERE id = $1",
      params: (id) => [id, row.make.name],
    },
  );
  const modelId = await upsert(
    client,
    outcome,
    {
      sql: "SELECT id, name FROM vehicle_models WHERE make_id = $1 AND slug = $2",
      params: [makeId, row.model.slug],
    },
    {
      sql: "INSERT INTO vehicle_models(id,make_id,slug,name) VALUES($1,$2,$3,$4)",
      params: (id) => [id, makeId, row.model.slug, row.model.name],
    },
    (found) => found.name !== row.model.name,
    {
      sql: "UPDATE vehicle_models SET name = $2 WHERE id = $1",
      params: (id) => [id, row.model.name],
    },
  );
  const g = row.generation;
  const generationId = await upsert(
    client,
    outcome,
    {
      sql: "SELECT id, year_from, year_to FROM vehicle_generations WHERE model_id = $1 AND name = $2",
      params: [modelId, g.name],
    },
    {
      sql: "INSERT INTO vehicle_generations(id,model_id,name,year_from,year_to) VALUES($1,$2,$3,$4,$5)",
      params: (id) => [id, modelId, g.name, g.yearFrom, g.yearTo],
    },
    (found) => found.year_from !== g.yearFrom || found.year_to !== g.yearTo,
    {
      sql: "UPDATE vehicle_generations SET year_from = $2, year_to = $3 WHERE id = $1",
      params: (id) => [id, g.yearFrom, g.yearTo],
    },
  );
  const e = row.engine;
  if (e)
    await upsert(
      client,
      outcome,
      {
        sql: `SELECT id, fuel, displacement_cc, power_kw, engine_code
              FROM vehicle_engines WHERE generation_id = $1 AND name = $2`,
        params: [generationId, e.name],
      },
      {
        sql: `INSERT INTO vehicle_engines(id,generation_id,name,fuel,displacement_cc,power_kw,engine_code)
              VALUES($1,$2,$3,$4,$5,$6,$7)`,
        params: (id) => [
          id,
          generationId,
          e.name,
          e.fuel,
          e.displacementCc,
          e.powerKw,
          e.engineCode,
        ],
      },
      (found) =>
        found.fuel !== e.fuel ||
        found.displacement_cc !== e.displacementCc ||
        found.power_kw !== e.powerKw ||
        found.engine_code !== e.engineCode,
      {
        sql: `UPDATE vehicle_engines SET fuel = $2, displacement_cc = $3,
                power_kw = $4, engine_code = $5 WHERE id = $1`,
        params: (id) => [id, e.fuel, e.displacementCc, e.powerKw, e.engineCode],
      },
    );
  return outcome.created ? "create" : outcome.updated ? "update" : "unchanged";
}

function emptyReport(error: string): VehicleImportReport {
  return {
    applied: false,
    error,
    rows: [],
    summary: { create: 0, update: 0, unchanged: 0, error: 0 },
  };
}

export async function importVehicles(
  pool: Pick<pg.Pool, "connect">,
  actorId: string,
  csv: string,
  options: { apply: boolean; filename?: string },
): Promise<VehicleImportReport> {
  if (csv.includes("�"))
    return emptyReport(
      "Файлът не е в UTF-8. Запиши го като „CSV UTF-8“ и опитай отново.",
    );
  let table;
  try {
    table = parseCsv(csv, MAX_VEHICLE_IMPORT_ROWS);
  } catch (error) {
    if (error instanceof CsvError) return emptyReport(error.message);
    throw error;
  }
  while (table.header.length > 1 && table.header.at(-1) === "")
    table.header.pop();
  const unknown = table.header.filter(
    (column) => !(VEHICLE_IMPORT_COLUMNS as readonly string[]).includes(column),
  );
  if (unknown.length)
    return emptyReport(
      `Непознати колони: ${unknown.map((c) => c || "(празна колона)").join(", ")}.`,
    );
  for (const required of ["make", "model", "generation", "year_from"])
    if (!table.header.includes(required))
      return emptyReport(`Липсва колона ${required}.`);
  if (new Set(table.header).size !== table.header.length)
    return emptyReport("Има повторени колони.");
  if (!table.rows.length) return emptyReport("Файлът няма редове с данни.");

  const results: VehicleRowResult[] = [];
  const parsed: { result: VehicleRowResult; row: Row }[] = [];
  const seen = new Map<string, number>();
  // The same make, model or generation must be described the same way on
  // every row, otherwise the last row would silently win.
  const described = new Map<string, { text: string; line: number }>();
  const consistent = (
    key: string,
    text: string,
    line: number,
    what: string,
  ) => {
    const earlier = described.get(key);
    if (!earlier) described.set(key, { text, line });
    else if (earlier.text !== text)
      throw new RowError(`${what} се различава от ред ${earlier.line}.`);
  };
  for (const { line, cells } of table.rows) {
    const values = new Map(table.header.map((c, i) => [c, cells[i] ?? ""]));
    const cell = (column: Column) => values.get(column) ?? "";
    const result: VehicleRowResult = {
      line,
      key: [cell("make"), cell("model"), cell("generation"), cell("engine")]
        .map((v) => v.trim())
        .filter(Boolean)
        .join(" · "),
      action: "error",
      errors: [],
    };
    results.push(result);
    if (cells.slice(table.header.length).some((v) => v.trim())) {
      result.errors.push("Редът има повече клетки от заглавието.");
      continue;
    }
    try {
      const row = parseRow(cell);
      const identity = [
        row.make.slug,
        row.model.slug,
        row.generation.name,
        row.engine?.name ?? "",
      ].join("\u0000");
      if (seen.has(identity))
        throw new RowError(`Редът се повтаря (ред ${seen.get(identity)}).`);
      consistent(
        `make:${row.make.slug}`,
        row.make.name,
        line,
        "Името на марката",
      );
      consistent(
        `model:${row.make.slug}:${row.model.slug}`,
        row.model.name,
        line,
        "Името на модела",
      );
      consistent(
        `generation:${row.make.slug}:${row.model.slug}:${row.generation.name}`,
        `${row.generation.yearFrom}-${row.generation.yearTo ?? ""}`,
        line,
        "Годините на поколението",
      );
      seen.set(identity, line);
      parsed.push({ result, row });
    } catch (error) {
      if (!(error instanceof RowError)) throw error;
      result.errors.push(error.message);
    }
  }

  const client = await pool.connect();
  const batchId = randomUUID();
  try {
    await client.query("BEGIN");
    const free = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('vehicle-import')) AS ok",
    );
    if (!free.rows[0].ok) {
      await client.query("ROLLBACK");
      return emptyReport(
        "В момента тече друг импорт. Опитай отново след малко.",
      );
    }
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const { result, row } of parsed) {
      await client.query("SAVEPOINT vehicle_row");
      try {
        result.action = await applyRow(client, row);
        await client.query("RELEASE SAVEPOINT vehicle_row");
      } catch (error) {
        const code = (error as { code?: string }).code;
        // Constraint backstops (the row checks above should catch these).
        if (code !== "23505" && code !== "23514" && code !== "22021")
          throw error;
        await client.query("ROLLBACK TO SAVEPOINT vehicle_row");
        result.errors.push("Невалидни или противоречиви данни в реда.");
      }
    }
    const summary = { create: 0, update: 0, unchanged: 0, error: 0 };
    for (const result of results) {
      if (result.errors.length) result.action = "error";
      summary[result.action] += 1;
    }
    const applied = options.apply && summary.error === 0;
    if (applied) {
      await client.query(
        `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
         VALUES($1,$2,'vehicle.import','import',$3,$4)`,
        [
          batchId,
          actorId,
          batchId,
          JSON.stringify({
            filename: options.filename ?? null,
            summary,
            changed: results
              .filter((r) => r.action === "create" || r.action === "update")
              .map((r) => ({ vehicle: r.key, action: r.action })),
          }),
        ],
      );
      await client.query("COMMIT");
    } else await client.query("ROLLBACK");
    return { applied, rows: results, summary };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
