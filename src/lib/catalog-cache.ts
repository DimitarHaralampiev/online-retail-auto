// Cross-request caching of slow-changing catalog data (#43, ADR 0004).
// Only the taxonomy (category tree and counts) is cached: it is read by
// every page and changes only through admin actions, which expire the
// CATALOG_TAG. Prices, stock and products stay per request.
//
// Caching needs the Next.js server; scripts and tests (no NEXT_RUNTIME)
// read the database directly.
import { unstable_cache } from "next/cache";

export const CATALOG_TAG = "catalog";
/** Upper bound for changes made outside the admin (seed script, SQL). */
export const CATALOG_REVALIDATE_SECONDS = 300;

export const caching = () => !!process.env.NEXT_RUNTIME;

export function cachedAcrossRequests<T>(
  load: () => Promise<T>,
  key: string[],
): () => Promise<T> {
  if (!caching()) return load;
  return unstable_cache(load, key, {
    tags: [CATALOG_TAG],
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
}
