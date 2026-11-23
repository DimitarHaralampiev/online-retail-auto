// Vehicle reference lookups (make > model > generation > engine) and product
// fitment queries over PostgreSQL. Reference data is maintained from a
// verified source; nothing here guesses compatibility.
//
// Ids are passed straight to SQL: callers (API routes) validate them as
// UUIDs first. Every level can be hidden (`active`); a lookup shows only what
// is active itself and under an active make, model and generation.
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

const ACTIVE_MODEL = `JOIN vehicle_models m ON m.id = g.model_id AND m.active AND g.active
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
     WHERE e.generation_id = $1 AND e.active
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
       AND (f.engine_id IS NULL OR f.engine_id =
            (SELECT id FROM vehicle_engines WHERE id = $2 AND active))
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
     JOIN vehicle_generations g ON g.id = f.generation_id ${ACTIVE_MODEL}
     LEFT JOIN vehicle_engines e ON e.id = f.engine_id
     WHERE f.sku = $1 AND (e.id IS NULL OR e.active)
     ORDER BY k.name COLLATE "und-x-icu", m.name COLLATE "und-x-icu",
              g.year_from, e.name NULLS FIRST, f.year_from NULLS FIRST`,
    [sku],
  );
  return result.rows;
}

/**
 * How each product relates to the selected vehicle (ADR 0002):
 * - "fits": verified for this vehicle (same rule as the catalog filter);
 * - "universal": fits every vehicle;
 * - "check": verified for this generation, but only for some engines or
 *   years and the shopper's choice does not settle it.
 * Products with no verified data for the generation get no status: the
 * storefront makes no claim about them.
 */
export type FitStatus = "fits" | "universal" | "check";

export async function fitStatuses(
  db: Queryable,
  skus: readonly string[],
  selection: {
    generationId: string;
    engineId: string | null;
    year: number | null;
  },
): Promise<Record<string, FitStatus>> {
  if (!skus.length) return {};
  const result = await db.query<{ sku: string; status: FitStatus }>(
    `SELECT p.sku,
            CASE
              WHEN p.universal_fit THEN 'universal'
              WHEN bool_or(f.generation_id IS NOT NULL
                     AND (f.engine_id IS NULL OR f.engine_id = $3::uuid)
                     AND (f.year_from IS NULL OR f.year_from <= $4::int)
                     AND (f.year_to IS NULL OR f.year_to >= $4::int))
                THEN 'fits'
              WHEN bool_or(f.generation_id IS NOT NULL
                     AND (f.engine_id IS NULL OR $3::uuid IS NULL OR f.engine_id = $3::uuid)
                     AND ($4::int IS NULL
                          OR ((f.year_from IS NULL OR f.year_from <= $4::int)
                              AND (f.year_to IS NULL OR f.year_to >= $4::int))))
                THEN 'check'
            END AS status
     FROM warehouse_products p
     LEFT JOIN product_vehicle_fitments f
       ON f.sku = p.sku AND f.generation_id = $2
       AND (f.engine_id IS NULL OR EXISTS (
         SELECT 1 FROM vehicle_engines e WHERE e.id = f.engine_id AND e.active))
     WHERE p.sku = ANY($1) AND p.status = 'published'
     GROUP BY p.sku, p.universal_fit`,
    [[...skus], selection.generationId, selection.engineId, selection.year],
  );
  return Object.fromEntries(
    result.rows.filter((row) => row.status).map((row) => [row.sku, row.status]),
  );
}

/** What the product page shows about fitment: universal, or verified rows. */
export async function productFitInfo(
  db: Queryable,
  sku: string,
): Promise<{ universal: boolean; fitments: ProductFitment[] }> {
  const [universal, fitments] = await Promise.all([
    db.query<{ universal_fit: boolean }>(
      "SELECT universal_fit FROM warehouse_products WHERE sku = $1",
      [sku],
    ),
    productFitments(db, sku),
  ]);
  return { universal: !!universal.rows[0]?.universal_fit, fitments };
}
