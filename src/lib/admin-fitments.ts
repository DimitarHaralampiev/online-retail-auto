// Product fitment management for administrators (ADR 0002): add, update and
// remove the vehicles a product verifiably fits. Used by the product editor
// and the fitment CSV import, so both apply the same rules and audit trail.
//
// Rules: the product and the generation must exist, an engine must belong to
// the generation, fitment years must lie within the generation's years, and
// every fitment names its verification source. Changes are recorded in the
// product's audit history. Callers authorize first.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AdminProductError } from "./admin-products";

type Queryable = Pick<pg.PoolClient, "query">;

export const fitmentSchema = z
  .object({
    generationId: z.uuid("Невалидно поколение."),
    engineId: z.uuid("Невалиден двигател.").nullable().default(null),
    yearFrom: z.number().int().min(1950).max(2100).nullable().default(null),
    yearTo: z.number().int().min(1950).max(2100).nullable().default(null),
    notes: z.string().trim().max(500, "Бележката е до 500 знака.").default(""),
    source: z
      .string()
      .trim()
      .min(2, "Посочи източника, в който е проверена съвместимостта.")
      .max(200, "Източникът е до 200 знака."),
  })
  .refine(
    (f) => f.yearFrom === null || f.yearTo === null || f.yearTo >= f.yearFrom,
    { message: "Крайната година е преди началната.", path: ["yearTo"] },
  );
export type FitmentInput = z.infer<typeof fitmentSchema>;

export type AdminFitment = FitmentInput & {
  id: string;
  make: string;
  model: string;
  generation: string;
  generationYears: [number, number | null];
  engine: string | null;
  hidden: boolean;
};

/** All fitments of a product, including those of hidden vehicles. */
export async function listAdminFitments(
  db: Pick<pg.Pool, "query">,
  sku: string,
): Promise<AdminFitment[]> {
  const result = await db.query(
    `SELECT f.id, f.generation_id AS "generationId", f.engine_id AS "engineId",
            f.year_from AS "yearFrom", f.year_to AS "yearTo", f.notes, f.source,
            k.name AS make, m.name AS model, g.name AS generation,
            g.year_from AS g_from, g.year_to AS g_to, e.name AS engine,
            NOT (k.active AND m.active AND g.active
                 AND coalesce(e.active, true)) AS hidden
     FROM product_vehicle_fitments f
     JOIN vehicle_generations g ON g.id = f.generation_id
     JOIN vehicle_models m ON m.id = g.model_id
     JOIN vehicle_makes k ON k.id = m.make_id
     LEFT JOIN vehicle_engines e ON e.id = f.engine_id
     WHERE f.sku = $1
     ORDER BY k.name COLLATE "und-x-icu", m.name COLLATE "und-x-icu",
              g.year_from, e.name NULLS FIRST, f.year_from NULLS FIRST`,
    [sku],
  );
  return result.rows.map(({ g_from, g_to, ...row }) => ({
    ...row,
    generationYears: [g_from, g_to],
  }));
}

async function audit(
  client: Queryable,
  actorId: string,
  action: string,
  sku: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
     VALUES($1,$2,$3,'product',$4,$5)`,
    [randomUUID(), actorId, action, sku, JSON.stringify(details)],
  );
}

/** Checks the product, generation, engine and years; returns a label. */
async function validate(
  client: Queryable,
  sku: string,
  fitment: FitmentInput,
): Promise<string> {
  const product = await client.query(
    "SELECT 1 FROM warehouse_products WHERE sku = $1",
    [sku],
  );
  if (!product.rowCount)
    throw new AdminProductError("Продуктът не е намерен.", 404);
  const generation = await client.query<{
    label: string;
    year_from: number;
    year_to: number | null;
  }>(
    `SELECT k.name || ' ' || m.name || ' ' || g.name AS label,
            g.year_from, g.year_to
     FROM vehicle_generations g
     JOIN vehicle_models m ON m.id = g.model_id
     JOIN vehicle_makes k ON k.id = m.make_id
     WHERE g.id = $1
     -- The years checked below stay until this fitment is saved.
     FOR SHARE OF g`,
    [fitment.generationId],
  );
  if (!generation.rowCount) throw new AdminProductError("Непознато поколение.");
  const g = generation.rows[0];
  let label = g.label;
  if (fitment.engineId) {
    const engine = await client.query<{ name: string }>(
      "SELECT name FROM vehicle_engines WHERE id = $1 AND generation_id = $2",
      [fitment.engineId, fitment.generationId],
    );
    if (!engine.rowCount)
      throw new AdminProductError("Двигателят не е от това поколение.");
    label += ` ${engine.rows[0].name}`;
  }
  const last = g.year_to ?? 2100;
  for (const year of [fitment.yearFrom, fitment.yearTo])
    if (year !== null && (year < g.year_from || year > last))
      throw new AdminProductError(
        `Годините трябва да са в периода на поколението (${g.year_from}–${g.year_to ?? "днес"}).`,
      );
  return label;
}

const SAME_FITMENT = `sku = $1 AND generation_id = $2
  AND engine_id IS NOT DISTINCT FROM $3
  AND year_from IS NOT DISTINCT FROM $4 AND year_to IS NOT DISTINCT FROM $5`;

/**
 * Adds a fitment, or updates notes and source of the identical one (same
 * product, generation, engine and years). Runs in the caller's transaction.
 */
export async function upsertFitmentIn(
  client: Queryable,
  actorId: string,
  sku: string,
  fitment: FitmentInput,
): Promise<"create" | "update" | "unchanged"> {
  const vehicle = await validate(client, sku, fitment);
  const key = [
    sku,
    fitment.generationId,
    fitment.engineId,
    fitment.yearFrom,
    fitment.yearTo,
  ];
  const existing = await client.query<{
    id: string;
    notes: string;
    source: string;
  }>(
    `SELECT id, notes, source FROM product_vehicle_fitments
     WHERE ${SAME_FITMENT} FOR UPDATE`,
    key,
  );
  const years = [fitment.yearFrom, fitment.yearTo];
  if (!existing.rowCount) {
    const inserted = await client.query(
      `INSERT INTO product_vehicle_fitments(id,sku,generation_id,engine_id,
         year_from,year_to,notes,source,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), ...key, fitment.notes, fitment.source, actorId],
    );
    // A concurrent identical insert won the unique index: nothing changed here.
    if (!inserted.rowCount) return "unchanged";
    await audit(client, actorId, "fitment.add", sku, {
      vehicle,
      years,
      source: fitment.source,
    });
    return "create";
  }
  const row = existing.rows[0];
  if (row.notes === fitment.notes && row.source === fitment.source)
    return "unchanged";
  await client.query(
    "UPDATE product_vehicle_fitments SET notes = $2, source = $3 WHERE id = $1",
    [row.id, fitment.notes, fitment.source],
  );
  await audit(client, actorId, "fitment.update", sku, {
    vehicle,
    years,
    notes: { from: row.notes, to: fitment.notes },
    source: { from: row.source, to: fitment.source },
  });
  return "update";
}

/** Removes the identical fitment; false when there was none. */
export async function removeFitmentIn(
  client: Queryable,
  actorId: string,
  sku: string,
  fitment: Omit<FitmentInput, "notes" | "source">,
): Promise<boolean> {
  const removed = await client.query<{ label: string }>(
    `DELETE FROM product_vehicle_fitments f
     USING vehicle_generations g, vehicle_models m, vehicle_makes k
     WHERE f.sku = $1 AND f.generation_id = $2
       AND f.engine_id IS NOT DISTINCT FROM $3
       AND f.year_from IS NOT DISTINCT FROM $4
       AND f.year_to IS NOT DISTINCT FROM $5
       AND g.id = f.generation_id AND m.id = g.model_id AND k.id = m.make_id
     RETURNING k.name || ' ' || m.name || ' ' || g.name AS label`,
    [
      sku,
      fitment.generationId,
      fitment.engineId,
      fitment.yearFrom,
      fitment.yearTo,
    ],
  );
  if (!removed.rowCount) return false;
  await audit(client, actorId, "fitment.remove", sku, {
    vehicle: removed.rows[0].label,
    engineId: fitment.engineId,
    years: [fitment.yearFrom, fitment.yearTo],
  });
  return true;
}

/** Removes one fitment by id (product editor). */
export async function removeFitmentById(
  pool: Pick<pg.Pool, "connect">,
  actorId: string,
  sku: string,
  id: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<{
      generation_id: string;
      engine_id: string | null;
      year_from: number | null;
      year_to: number | null;
    }>(
      `SELECT generation_id, engine_id, year_from, year_to
       FROM product_vehicle_fitments WHERE id = $1 AND sku = $2 FOR UPDATE`,
      [id, sku],
    );
    if (!row.rowCount)
      throw new AdminProductError("Съвместимостта не е намерена.", 404);
    const f = row.rows[0];
    await removeFitmentIn(client, actorId, sku, {
      generationId: f.generation_id,
      engineId: f.engine_id,
      yearFrom: f.year_from,
      yearTo: f.year_to,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Adds or updates one fitment in its own transaction (product editor). */
export async function saveFitment(
  pool: Pick<pg.Pool, "connect">,
  actorId: string,
  sku: string,
  fitment: FitmentInput,
): Promise<"create" | "update" | "unchanged"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const outcome = await upsertFitmentIn(client, actorId, sku, fitment);
    await client.query("COMMIT");
    return outcome;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
