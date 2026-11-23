// The shopper's selected vehicle (ADR 0002, #32): kept in a cookie for every
// visitor and optionally saved to a signed-in customer's garage. Only ids
// are stored; every read resolves them against the reference again, so a
// hidden or corrected vehicle never lingers in a stale selection.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";

export const VEHICLE_COOKIE = "auto_vehicle";
/** Half a year: a shopper's car rarely changes. */
export const VEHICLE_COOKIE_MAX_AGE = 60 * 60 * 24 * 182;

export const selectionSchema = z.object({
  generationId: z.uuid(),
  engineId: z.uuid().nullable().default(null),
  year: z.number().int().min(1950).max(2100).nullable().default(null),
});
export type VehicleSelectionInput = z.infer<typeof selectionSchema>;

export type ResolvedVehicle = VehicleSelectionInput & {
  make: string;
  model: string;
  generation: string;
  engine: string | null;
  /** "Make Model Generation, year, engine" for display. */
  label: string;
};

/** The cookie's selection, or null when missing or malformed. */
export function parseSelectionCookie(
  value: string | undefined,
): VehicleSelectionInput | null {
  if (!value) return null;
  try {
    const parsed = selectionSchema.safeParse(
      JSON.parse(decodeURIComponent(value)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const selectionCookieValue = (selection: VehicleSelectionInput) =>
  encodeURIComponent(JSON.stringify(selection));

/**
 * Resolves a selection against the active reference. Returns null when the
 * generation is unknown or hidden, the engine is hidden or not of it, or
 * the year is outside the generation's production years.
 */
export async function resolveSelection(
  db: Pick<pg.Pool, "query">,
  selection: VehicleSelectionInput,
): Promise<ResolvedVehicle | null> {
  const result = await db.query<{
    make: string;
    model: string;
    generation: string;
    year_from: number;
    year_to: number | null;
    engine: string | null;
    engine_ok: boolean;
  }>(
    `SELECT k.name AS make, m.name AS model, g.name AS generation,
            g.year_from, g.year_to, e.name AS engine,
            ($2::uuid IS NULL OR e.id IS NOT NULL) AS engine_ok
     FROM vehicle_generations g
     JOIN vehicle_models m ON m.id = g.model_id AND m.active
     JOIN vehicle_makes k ON k.id = m.make_id AND k.active
     LEFT JOIN vehicle_engines e
       ON e.id = $2 AND e.generation_id = g.id AND e.active
     WHERE g.id = $1 AND g.active`,
    [selection.generationId, selection.engineId],
  );
  const row = result.rows[0];
  if (!row || !row.engine_ok) return null;
  const { year } = selection;
  if (
    year !== null &&
    (year < row.year_from || (row.year_to !== null && year > row.year_to))
  )
    return null;
  const label = [
    `${row.make} ${row.model} ${row.generation}`,
    year === null ? null : String(year),
    row.engine,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    ...selection,
    make: row.make,
    model: row.model,
    generation: row.generation,
    engine: row.engine,
    label,
  };
}

/**
 * The vehicle a selection cookie names, resolved; null when the cookie is
 * missing, malformed or names nothing active, and on database errors (a
 * page never fails because of the shopper's car).
 */
export async function vehicleFromCookie(
  db: Pick<pg.Pool, "query">,
  value: string | undefined,
): Promise<ResolvedVehicle | null> {
  const selection = parseSelectionCookie(value);
  if (!selection) return null;
  try {
    return await resolveSelection(db, selection);
  } catch {
    return null;
  }
}

/** A mapped garage vehicle of this customer as a selection, or null. */
export async function garageSelection(
  db: Pick<pg.Pool, "query">,
  customerId: string,
  garageVehicleId: string,
): Promise<VehicleSelectionInput | null> {
  const result = await db.query<{
    generation_id: string | null;
    engine_id: string | null;
    year: number;
  }>(
    `SELECT generation_id, engine_id, year FROM garage_vehicles
     WHERE id = $1 AND customer_id = $2`,
    [garageVehicleId, customerId],
  );
  const row = result.rows[0];
  if (!row?.generation_id) return null;
  return {
    generationId: row.generation_id,
    engineId: row.engine_id,
    year: row.year,
  };
}

/**
 * Saves a resolved selection to the customer's garage and makes it the
 * selected garage vehicle (reusing an identical one). Needs a year, which
 * garage vehicles always have. Runs in its own transaction.
 */
export async function saveToGarage(
  pool: Pick<pg.Pool, "connect">,
  customerId: string,
  vehicle: ResolvedVehicle,
): Promise<string> {
  if (vehicle.year === null)
    throw new Error("Избери година, за да запазиш автомобила в гаража.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialises garage changes of one customer (the 10-vehicle limit).
    await client.query("SELECT id FROM customers WHERE id = $1 FOR UPDATE", [
      customerId,
    ]);
    const same = await client.query<{ id: string }>(
      `SELECT id FROM garage_vehicles
       WHERE customer_id = $1 AND generation_id = $2
         AND engine_id IS NOT DISTINCT FROM $3 AND year = $4`,
      [customerId, vehicle.generationId, vehicle.engineId, vehicle.year],
    );
    let id = same.rows[0]?.id;
    if (!id) {
      const count = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM garage_vehicles WHERE customer_id = $1",
        [customerId],
      );
      if (count.rows[0].count >= 10)
        throw new Error("Можеш да запазиш до 10 автомобила.");
      id = randomUUID();
      await client.query(
        `INSERT INTO garage_vehicles(id,customer_id,nickname,make,model,year,
           engine,is_selected,generation_id,engine_id)
         VALUES($1,$2,'',$3,$4,$5,$6,false,$7,$8)`,
        [
          id,
          customerId,
          vehicle.make,
          `${vehicle.model} ${vehicle.generation}`,
          vehicle.year,
          vehicle.engine ?? "",
          vehicle.generationId,
          vehicle.engineId,
        ],
      );
    }
    await client.query(
      "UPDATE garage_vehicles SET is_selected = false WHERE customer_id = $1 AND is_selected",
      [customerId],
    );
    await client.query(
      "UPDATE garage_vehicles SET is_selected = true WHERE id = $1",
      [id],
    );
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
