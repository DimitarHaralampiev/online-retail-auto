// Vehicle reference lookups (make > model > generation > engine) and product
// fitment queries over PostgreSQL. Reference data is maintained from a
// verified source; nothing here guesses compatibility.
//
// Ids are passed straight to SQL: callers (API routes) validate them as
// UUIDs first. Hiding happens at make and model level (`active`); every
// lookup below a model checks that its make and model are active.
import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

export const FUELS = [
  "petrol",
  "diesel",
  "hybrid",
  "plug-in-hybrid",
  "electric",
  "lpg",
  "cng",
  "other",
] as const;
export type Fuel = (typeof FUELS)[number];

const ACTIVE_MODEL = `JOIN vehicle_models m ON m.id = g.model_id AND m.active
  JOIN vehicle_makes k ON k.id = m.make_id AND k.active`;

export type VehicleMake = { id: string; slug: string; name: string };
export type VehicleModel = { id: string; slug: string; name: string };
export type VehicleGeneration = {
  id: string;
  name: string;
  yearFrom: number;
  /** null: still in production. */
  yearTo: number | null;
};
export type VehicleEngine = {
  id: string;
  name: string;
  fuel: Fuel;
  displacementCc: number | null;
  powerKw: number | null;
  engineCode: string;
};

/**
 * A vehicle as far as the shopper has narrowed it down: a generation, and
 * optionally its engine and model year (a year matters for fitments limited
 * to part of a generation, e.g. after a facelift).
 */
export type VehicleSelection = {
  generationId: string;
  engineId?: string;
  year?: number;
};

export type ProductFitment = {
  make: string;
  model: string;
  generation: string;
  yearFrom: number;
  yearTo: number | null;
  /** null: every engine of the generation. */
  engine: string | null;
  /** Limits within the generation; null: no limit. */
  fitYearFrom: number | null;
  fitYearTo: number | null;
  notes: string;
};

export async function listMakes(db: Queryable): Promise<VehicleMake[]> {
  const result = await db.query<VehicleMake>(
    `SELECT id, slug, name FROM vehicle_makes WHERE active
     ORDER BY name COLLATE "und-x-icu", slug`,
  );
  return result.rows;
}

export async function listModels(
  db: Queryable,
  makeId: string,
): Promise<VehicleModel[]> {
  const result = await db.query<VehicleModel>(
    `SELECT m.id, m.slug, m.name FROM vehicle_models m
     JOIN vehicle_makes k ON k.id = m.make_id AND k.active
     WHERE m.make_id = $1 AND m.active
     ORDER BY m.name COLLATE "und-x-icu", m.slug`,
    [makeId],
  );
  return result.rows;
}

export async function listGenerations(
  db: Queryable,
  modelId: string,
): Promise<VehicleGeneration[]> {
  const result = await db.query<VehicleGeneration>(
    `SELECT g.id, g.name, g.year_from AS "yearFrom", g.year_to AS "yearTo"
     FROM vehicle_generations g ${ACTIVE_MODEL}
     WHERE g.model_id = $1
     ORDER BY g.year_from, g.name`,
    [modelId],
  );
  return result.rows;
}

export async function listEngines(
  db: Queryable,
  generationId: string,
): Promise<VehicleEngine[]> {
  const result = await db.query<VehicleEngine>(
    `SELECT e.id, e.name, e.fuel, e.displacement_cc AS "displacementCc",
            e.power_kw AS "powerKw", e.engine_code AS "engineCode"
     FROM vehicle_engines e
     JOIN vehicle_generations g ON g.id = e.generation_id ${ACTIVE_MODEL}
     WHERE e.generation_id = $1
     ORDER BY e.fuel, e.displacement_cc NULLS LAST, e.power_kw NULLS LAST, e.name`,
    [generationId],
  );
  return result.rows;
}

/**
 * Published SKUs that fit the selection: fitments for the whole generation,
 * for the chosen engine, and universal products. Conservative on purpose:
 * without an engine, engine-specific fitments are left out (they may not fit
 * the shopper's engine), and without a year, year-limited ones are left out.
 * An engine of another generation matches only generation-wide fitments.
 *
 * Returns a full list, so it suits small sets (garage, product page). The
 * catalog filter (#33) pushes the same rule into its browse SQL instead.
 */
export async function compatibleSkus(
  db: Queryable,
  selection: VehicleSelection,
): Promise<string[]> {
  const result = await db.query<{ sku: string }>(
    `SELECT f.sku FROM product_vehicle_fitments f
     JOIN warehouse_products p ON p.sku = f.sku AND p.status = 'published'
     JOIN vehicle_generations g ON g.id = f.generation_id ${ACTIVE_MODEL}
     WHERE f.generation_id = $1
       AND (f.engine_id IS NULL OR f.engine_id = $2)
       AND (f.year_from IS NULL OR f.year_from <= $3)
       AND (f.year_to IS NULL OR f.year_to >= $3)
     UNION
     SELECT sku FROM warehouse_products
     WHERE universal_fit AND status = 'published'
     ORDER BY sku`,
    [
      selection.generationId,
      selection.engineId ?? null,
      selection.year ?? null,
    ],
  );
  return result.rows.map((row) => row.sku);
}

/** Verified fitments of one product, for its compatibility table. */
export async function productFitments(
  db: Queryable,
  sku: string,
): Promise<ProductFitment[]> {
  const result = await db.query<ProductFitment>(
    `SELECT k.name AS make, m.name AS model, g.name AS generation,
            g.year_from AS "yearFrom", g.year_to AS "yearTo",
            e.name AS engine, f.year_from AS "fitYearFrom",
            f.year_to AS "fitYearTo", f.notes
     FROM product_vehicle_fitments f
     JOIN vehicle_generations g ON g.id = f.generation_id
     JOIN vehicle_models m ON m.id = g.model_id AND m.active
     JOIN vehicle_makes k ON k.id = m.make_id AND k.active
     LEFT JOIN vehicle_engines e ON e.id = f.engine_id
     WHERE f.sku = $1
     ORDER BY k.name COLLATE "und-x-icu", m.name COLLATE "und-x-icu",
              g.year_from, e.name NULLS FIRST, f.year_from NULLS FIRST`,
    [sku],
  );
  return result.rows;
}
