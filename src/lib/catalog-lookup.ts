// Public per-SKU product lookup used by client components (cart, favourites,
// repeat orders) instead of shipping the whole catalog to every page.
import { z } from "zod";

/** SKUs per lookup request; the client splits larger sets. */
export const MAX_LOOKUP_SKUS = 100;

// No control characters (PostgreSQL rejects NUL in text).
const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[^\u0000-\u001f]+$/);

/** Unique, well-formed SKUs from `?sku=A&sku=B`, or an error message. */
export function parseLookupSkus(
  params: URLSearchParams,
): { skus: string[] } | { error: string } {
  const raw = params.getAll("sku");
  if (raw.length > MAX_LOOKUP_SKUS)
    return { error: `At most ${MAX_LOOKUP_SKUS} SKUs per request.` };
  const skus: string[] = [];
  for (const value of raw) {
    const parsed = skuSchema.safeParse(value);
    if (!parsed.success) return { error: "Invalid SKU." };
    if (!skus.includes(parsed.data)) skus.push(parsed.data);
  }
  return { skus };
}
