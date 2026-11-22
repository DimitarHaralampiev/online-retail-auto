// CSV import of product fitments (ADR 0002, #35) with a dry run. One row is
// one product–vehicle fitment from a verified source; `remove` = yes deletes
// it instead. Vehicles are found in the reference by make and model slug
// (derived from the names unless given), generation and engine name; the
// import never creates reference data (see vehicle-import.ts).
//
// A check and an apply run the same code in one transaction; the check
// always rolls back and the apply commits only when no row has an error.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ZodError } from "zod";
import {
  fitmentSchema,
  removeFitmentIn,
  upsertFitmentIn,
} from "./admin-fitments";
import { AdminProductError } from "./admin-products";
import { CsvError, parseCsv } from "./csv";
import { slugify } from "./vehicle-import";

export const FITMENT_IMPORT_COLUMNS = [
  "sku",
  "make",
  "make_slug",
  "model",
  "model_slug",
  "generation",
  "engine",
  "year_from",
  "year_to",
  "notes",
  "source",
  "remove",
] as const;
type Column = (typeof FITMENT_IMPORT_COLUMNS)[number];

export const MAX_FITMENT_IMPORT_ROWS = 5000;

type Action = "create" | "update" | "unchanged" | "remove" | "error";
export type FitmentRowResult = {
  line: number;
  key: string;
  action: Action;
  errors: string[];
};
export type FitmentImportReport = {
  applied: boolean;
  error?: string;
  rows: FitmentRowResult[];
  summary: Record<Action, number>;
};

class RowError extends Error {}

const emptySummary = (): Record<Action, number> => ({
  create: 0,
  update: 0,
  unchanged: 0,
  remove: 0,
  error: 0,
});

function emptyReport(error: string): FitmentImportReport {
  return { applied: false, error, rows: [], summary: emptySummary() };
}

function year(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}$/.test(trimmed))
    throw new RowError("Годината трябва да е четирицифрено число.");
  return Number(trimmed);
}

function yesNo(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text || ["no", "не", "false", "0"].includes(text)) return false;
  if (["yes", "да", "true", "1"].includes(text)) return true;
  throw new RowError("remove е yes или no.");
}

async function processRow(
  client: pg.PoolClient,
  actorId: string,
  cell: (column: Column) => string,
): Promise<Action> {
  const sku = cell("sku").trim();
  if (!sku) throw new RowError("Липсва продуктов код (sku).");
  const makeSlug = cell("make_slug").trim() || slugify(cell("make"));
  const modelSlug = cell("model_slug").trim() || slugify(cell("model"));
  const generationName = cell("generation").trim();
  if (!makeSlug || !modelSlug || !generationName)
    throw new RowError(
      "Посочи марка, модел и поколение (или make_slug и model_slug).",
    );
  const generation = await client.query<{ id: string }>(
    `SELECT g.id FROM vehicle_generations g
     JOIN vehicle_models m ON m.id = g.model_id AND m.slug = $2
     JOIN vehicle_makes k ON k.id = m.make_id AND k.slug = $1
     WHERE g.name = $3`,
    [makeSlug, modelSlug, generationName],
  );
  if (!generation.rowCount)
    throw new RowError(
      `Няма такова поколение в справочника (${makeSlug} / ${modelSlug} / ${generationName}).`,
    );
  const generationId = generation.rows[0].id;
  let engineId: string | null = null;
  const engineName = cell("engine").trim();
  if (engineName) {
    const engine = await client.query<{ id: string }>(
      "SELECT id FROM vehicle_engines WHERE generation_id = $1 AND name = $2",
      [generationId, engineName],
    );
    if (!engine.rowCount)
      throw new RowError(`Двигателят „${engineName}“ не е в това поколение.`);
    engineId = engine.rows[0].id;
  }
  const yearFrom = year(cell("year_from"));
  const yearTo = year(cell("year_to"));
  if (yesNo(cell("remove"))) {
    const removed = await removeFitmentIn(client, actorId, sku, {
      generationId,
      engineId,
      yearFrom,
      yearTo,
    });
    if (!removed) throw new RowError("Няма такава съвместимост за премахване.");
    return "remove";
  }
  return upsertFitmentIn(
    client,
    actorId,
    sku,
    fitmentSchema.parse({
      generationId,
      engineId,
      yearFrom,
      yearTo,
      notes: cell("notes"),
      source: cell("source"),
    }),
  );
}

function rowErrors(error: unknown): string[] | null {
  if (error instanceof RowError || error instanceof AdminProductError)
    return [error.message];
  if (error instanceof ZodError) return error.issues.map((i) => i.message);
  if ((error as { code?: string }).code === "22021")
    return ["Текстът съдържа недопустими знаци."];
  return null;
}

export async function importFitments(
  pool: Pick<pg.Pool, "connect">,
  actorId: string,
  csv: string,
  options: { apply: boolean; filename?: string },
): Promise<FitmentImportReport> {
  if (csv.includes("�"))
    return emptyReport(
      "Файлът не е в UTF-8. Запиши го като „CSV UTF-8“ и опитай отново.",
    );
  let table;
  try {
    table = parseCsv(csv, MAX_FITMENT_IMPORT_ROWS);
  } catch (error) {
    if (error instanceof CsvError) return emptyReport(error.message);
    throw error;
  }
  while (table.header.length > 1 && table.header.at(-1) === "")
    table.header.pop();
  const unknown = table.header.filter(
    (c) => !(FITMENT_IMPORT_COLUMNS as readonly string[]).includes(c),
  );
  if (unknown.length)
    return emptyReport(
      `Непознати колони: ${unknown.map((c) => c || "(празна колона)").join(", ")}.`,
    );
  for (const required of ["sku", "generation"])
    if (!table.header.includes(required))
      return emptyReport(`Липсва колона ${required}.`);
  if (new Set(table.header).size !== table.header.length)
    return emptyReport("Има повторени колони.");
  if (!table.rows.length) return emptyReport("Файлът няма редове с данни.");

  const client = await pool.connect();
  const batchId = randomUUID();
  const results: FitmentRowResult[] = [];
  try {
    await client.query("BEGIN");
    const free = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('fitment-import')) AS ok",
    );
    if (!free.rows[0].ok) {
      await client.query("ROLLBACK");
      return emptyReport(
        "В момента тече друг импорт. Опитай отново след малко.",
      );
    }
    await client.query("SET LOCAL lock_timeout = '5s'");
    const seen = new Map<string, number>();
    for (const { line, cells } of table.rows) {
      const values = new Map(table.header.map((c, i) => [c, cells[i] ?? ""]));
      const cell = (column: Column) => values.get(column) ?? "";
      const key = [
        cell("sku"),
        cell("make") || cell("make_slug"),
        cell("model") || cell("model_slug"),
        cell("generation"),
        cell("engine"),
        [cell("year_from"), cell("year_to")].filter((v) => v.trim()).join("–"),
      ]
        .map((v) => v.trim())
        .filter(Boolean)
        .join(" · ");
      const result: FitmentRowResult = {
        line,
        key,
        action: "error",
        errors: [],
      };
      results.push(result);
      if (cells.slice(table.header.length).some((v) => v.trim())) {
        result.errors.push("Редът има повече клетки от заглавието.");
        continue;
      }
      if (seen.has(key)) {
        result.errors.push(`Редът се повтаря (ред ${seen.get(key)}).`);
        continue;
      }
      seen.set(key, line);
      await client.query("SAVEPOINT fitment_row");
      try {
        result.action = await processRow(client, actorId, cell);
        await client.query("RELEASE SAVEPOINT fitment_row");
      } catch (error) {
        const messages = rowErrors(error);
        if (!messages) throw error;
        await client.query("ROLLBACK TO SAVEPOINT fitment_row");
        result.errors.push(...messages);
      }
    }
    const summary = emptySummary();
    for (const result of results) {
      if (result.errors.length) result.action = "error";
      summary[result.action] += 1;
    }
    const applied = options.apply && summary.error === 0;
    if (applied) {
      await client.query(
        `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
         VALUES($1,$2,'fitment.import','import',$3,$4)`,
        [
          batchId,
          actorId,
          batchId,
          JSON.stringify({ filename: options.filename ?? null, summary }),
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
