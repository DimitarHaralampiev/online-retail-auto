// Shared by admin server code and client components (no server imports).
export type ProductStatus = "draft" | "published" | "archived";

/** Admin labels per status: [Bulgarian, English]. */
export const STATUS_LABELS: Record<ProductStatus, [string, string]> = {
  draft: ["Чернова", "Draft"],
  published: ["Публикуван", "Published"],
  archived: ["Архивиран", "Archived"],
};

/** "45,90" or "45.90" → 4590; "" → null; anything else → NaN. */
export function parseEuros(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 100);
}

/** "20" or "9,5" → basis points (2000, 950); "" → null; otherwise NaN. */
export function parsePercentBps(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 100);
}

/** "1200" → 1200; "" → null; decimals, signs or text → NaN. */
export function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}
