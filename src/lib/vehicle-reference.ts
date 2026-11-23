// Rules of the vehicle reference shared by the CSV import and the manual
// editor (#91).
import type pg from "pg";
import { AdminProductError } from "./admin-products";

/** "Mercedes-Benz" → "mercedes-benz", "Škoda" → "skoda"; "" when no Latin. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Refuses years of a generation that would leave a verified fitment outside
 * them (its years were checked against the generation when it was saved).
 */
export async function assertFitmentYears(
  client: Pick<pg.PoolClient, "query">,
  generationId: string,
  yearFrom: number,
  yearTo: number | null,
): Promise<void> {
  const outside = await client.query<{ sku: string }>(
    `SELECT sku FROM product_vehicle_fitments
     WHERE generation_id = $1
       AND (least(year_from, year_to) < $2
            OR greatest(year_from, year_to) > coalesce($3::int, 2100))
     ORDER BY sku LIMIT 3`,
    [generationId, yearFrom, yearTo],
  );
  if (outside.rowCount)
    throw new AdminProductError(
      `Съвместимости извън новите години (${outside.rows.map((r) => r.sku).join(", ")}). Промени първо тях.`,
      409,
    );
}
