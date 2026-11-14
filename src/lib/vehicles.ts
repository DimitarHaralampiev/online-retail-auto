// Vehicle reference lookups (make > model > generation > engine) and product
// fitment queries over PostgreSQL. Reference data is maintained from a
// verified source; nothing here guesses compatibility.
import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

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
  fuel: string;
  displacementCc: number | null;
  powerKw: number | null;
  engineCode: string;
};

/** A vehicle as far as the shopper has narrowed it down. */
export type VehicleSelection =
  | { generationId: string; engineId?: undefined }
  | { generationId: string; engineId: string };

export type ProductFitment = {
  make: string;
  model: string;
  generation: string;
  yearFrom: number;
  yearTo: number | null;
  /** null: every engine of the generation. */
  engine: string | null;
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
    `SELECT id, name, year_from AS "yearFrom", year_to AS "yearTo"
     FROM vehicle_generations WHERE model_id = $1
     ORDER BY year_from, name`,
    [modelId],
  );
  return result.rows;
}

export async function listEngines(
  db: Queryable,
  generationId: string,
): Promise<VehicleEngine[]> {
  const result = await db.query<VehicleEngine>(
    `SELECT id, name, fuel, displacement_cc AS "displacementCc",
            power_kw AS "powerKw", engine_code AS "engineCode"
     FROM vehicle_engines WHERE generation_id = $1
     ORDER BY fuel, displacement_cc NULLS LAST, power_kw NULLS LAST, name`,
    [generationId],
  );
  return result.rows;
}

/**
 * SKUs that fit the selection: fitments for the whole generation, for the
 * chosen engine, and universal products. With only a generation chosen,
 * engine-specific fitments are not included: they may not fit the shopper's
 * engine (the storefront asks to pick one).
 */
export async function compatibleSkus(
  db: Queryable,
  selection: VehicleSelection,
): Promise<string[]> {
  const result = await db.query<{ sku: string }>(
    `SELECT f.sku FROM product_vehicle_fitments f
     WHERE f.generation_id = $1
       AND (f.engine_id IS NULL OR f.engine_id = $2)
     UNION
     SELECT sku FROM warehouse_products WHERE universal_fit
     ORDER BY sku`,
    [selection.generationId, selection.engineId ?? null],
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
            e.name AS engine, f.notes
     FROM product_vehicle_fitments f
     JOIN vehicle_generations g ON g.id = f.generation_id
     JOIN vehicle_models m ON m.id = g.model_id
     JOIN vehicle_makes k ON k.id = m.make_id
     LEFT JOIN vehicle_engines e ON e.id = f.engine_id
     WHERE f.sku = $1
     ORDER BY k.name COLLATE "und-x-icu", m.name COLLATE "und-x-icu",
              g.year_from, e.name NULLS FIRST`,
    [sku],
  );
  return result.rows;
}
