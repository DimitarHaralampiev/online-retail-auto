// Vehicle reference overview for administrators and hiding of makes and
// models (ADR 0002). Data is added and corrected through the CSV import
// (vehicle-import.ts); nothing is deleted. Callers authorize first.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AdminProductError } from "./admin-products";

export type ReferenceModel = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  generations: number;
  engines: number;
  fitments: number;
};
export type ReferenceMake = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  models: ReferenceModel[];
};

/** Every make with its models and counts, active or not, by name. */
export async function referenceTree(
  db: Pick<pg.Pool, "query">,
): Promise<ReferenceMake[]> {
  const makes = await db.query<Omit<ReferenceMake, "models">>(
    `SELECT id, name, slug, active FROM vehicle_makes
     ORDER BY name COLLATE "und-x-icu", slug`,
  );
  const models = await db.query<ReferenceModel & { make_id: string }>(
    `SELECT m.id, m.make_id, m.name, m.slug, m.active,
            (SELECT count(*)::int FROM vehicle_generations g WHERE g.model_id = m.id) AS generations,
            (SELECT count(*)::int FROM vehicle_engines e
               JOIN vehicle_generations g ON g.id = e.generation_id
              WHERE g.model_id = m.id) AS engines,
            (SELECT count(*)::int FROM product_vehicle_fitments f
               JOIN vehicle_generations g ON g.id = f.generation_id
              WHERE g.model_id = m.id) AS fitments
     FROM vehicle_models m
     ORDER BY m.name COLLATE "und-x-icu", m.slug`,
  );
  return makes.rows.map((make) => ({
    ...make,
    models: models.rows
      .filter((model) => model.make_id === make.id)
      .map(({ make_id: _make, ...model }) => model),
  }));
}

export const visibilitySchema = z.object({ active: z.boolean() });

/** Shows or hides a make or a model (and everything below it). */
export async function setReferenceActive(
  db: Pick<pg.Pool, "connect">,
  actorId: string,
  kind: "make" | "model",
  id: string,
  active: boolean,
): Promise<void> {
  const table = kind === "make" ? "vehicle_makes" : "vehicle_models";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query<{ was: boolean }>(
      `UPDATE ${table} t SET active = $2 FROM ${table} old
       WHERE t.id = $1 AND old.id = t.id RETURNING old.active AS was`,
      [id, active],
    );
    if (!changed.rowCount)
      throw new AdminProductError(
        kind === "make" ? "Марката не е намерена." : "Моделът не е намерен.",
        404,
      );
    if (changed.rows[0].was !== active)
      await client.query(
        `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
         VALUES($1,$2,'vehicle.visibility',$3,$4,$5)`,
        [
          randomUUID(),
          actorId,
          `vehicle_${kind}`,
          id,
          JSON.stringify({ active: { from: !active, to: active } }),
        ],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
