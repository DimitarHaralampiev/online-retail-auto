// Data for the make and model landing pages (/cars/[make]/[model], #34).
// Only active makes and models, and only published products with verified
// fitment (ADR 0002): universal products fit every car and are not listed
// per model.
import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

export type CarMake = { id: string; slug: string; name: string };
export type MakeSummary = CarMake & { models: number; products: number };
export type ModelSummary = {
  id: string;
  slug: string;
  name: string;
  yearFrom: number | null;
  yearTo: number | null;
  /** Still produced (a generation without an end year). */
  current: boolean;
  products: number;
};
export type GenerationSummary = {
  id: string;
  name: string;
  yearFrom: number;
  yearTo: number | null;
  engines: number;
};

const FITTED = `SELECT count(DISTINCT f.sku)::int
  FROM product_vehicle_fitments f
  JOIN warehouse_products p ON p.sku = f.sku AND p.status = 'published'
  JOIN vehicle_generations g ON g.id = f.generation_id`;

/** Active makes with their active model and fitted product counts. */
export async function makesWithCounts(db: Queryable): Promise<MakeSummary[]> {
  const result = await db.query<MakeSummary>(
    `SELECT k.id, k.slug, k.name,
            (SELECT count(*)::int FROM vehicle_models m
              WHERE m.make_id = k.id AND m.active) AS models,
            (${FITTED}
              JOIN vehicle_models m ON m.id = g.model_id AND m.active
              WHERE m.make_id = k.id) AS products
     FROM vehicle_makes k WHERE k.active
     ORDER BY k.name COLLATE "und-x-icu", k.slug`,
  );
  return result.rows;
}

export async function makeBySlug(
  db: Queryable,
  slug: string,
): Promise<CarMake | null> {
  const result = await db.query<CarMake>(
    "SELECT id, slug, name FROM vehicle_makes WHERE slug = $1 AND active",
    [slug],
  );
  return result.rows[0] ?? null;
}

export async function modelsOfMake(
  db: Queryable,
  makeId: string,
): Promise<ModelSummary[]> {
  const result = await db.query<ModelSummary>(
    `SELECT m.id, m.slug, m.name,
            (SELECT min(year_from) FROM vehicle_generations WHERE model_id = m.id) AS "yearFrom",
            (SELECT max(year_to) FROM vehicle_generations WHERE model_id = m.id) AS "yearTo",
            EXISTS (SELECT 1 FROM vehicle_generations
                    WHERE model_id = m.id AND year_to IS NULL) AS current,
            (${FITTED} WHERE g.model_id = m.id) AS products
     FROM vehicle_models m
     WHERE m.make_id = $1 AND m.active
     ORDER BY m.name COLLATE "und-x-icu", m.slug`,
    [makeId],
  );
  return result.rows;
}

export async function modelBySlug(
  db: Queryable,
  makeId: string,
  slug: string,
): Promise<{ id: string; slug: string; name: string } | null> {
  const result = await db.query<{ id: string; slug: string; name: string }>(
    `SELECT id, slug, name FROM vehicle_models
     WHERE make_id = $1 AND slug = $2 AND active`,
    [makeId, slug],
  );
  return result.rows[0] ?? null;
}

export async function generationsOfModel(
  db: Queryable,
  modelId: string,
): Promise<GenerationSummary[]> {
  const result = await db.query<GenerationSummary>(
    `SELECT g.id, g.name, g.year_from AS "yearFrom", g.year_to AS "yearTo",
            (SELECT count(*)::int FROM vehicle_engines e
              WHERE e.generation_id = g.id) AS engines
     FROM vehicle_generations g WHERE g.model_id = $1
     ORDER BY g.year_from, g.name`,
    [modelId],
  );
  return result.rows;
}

/** Published products with verified fitment for any generation of a model. */
export async function modelProductSkus(
  db: Queryable,
  modelId: string,
  limit = 48,
): Promise<{ skus: string[]; total: number }> {
  const result = await db.query<{ sku: string; total: string }>(
    `SELECT sku, count(*) OVER () AS total
     FROM (SELECT DISTINCT f.sku
           FROM product_vehicle_fitments f
           JOIN warehouse_products p ON p.sku = f.sku AND p.status = 'published'
           JOIN vehicle_generations g ON g.id = f.generation_id
           WHERE g.model_id = $1) fitted
     ORDER BY sku LIMIT $2`,
    [modelId, limit],
  );
  return {
    skus: result.rows.map((row) => row.sku),
    total: Number(result.rows[0]?.total ?? 0),
  };
}
