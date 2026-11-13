// The store's catalog source for server code (pages, route handlers, jobs).
// Static demo data for now; the PostgreSQL adapter is selected here (#26).
import {
  productLookup,
  type CatalogRepository,
  type ProductLookup,
} from "./catalog";
import { demoCategories, demoProducts } from "./catalog-demo-data";
import { createStaticCatalog } from "./catalog-static";

let repository: CatalogRepository | undefined;

export function catalog(): CatalogRepository {
  return (repository ??= createStaticCatalog(demoProducts, demoCategories));
}

/** Loads only the given SKUs and returns a lookup for pure checkout logic. */
export async function lookupProducts(
  skus: Iterable<string>,
): Promise<ProductLookup> {
  return productLookup(await catalog().getProducts([...new Set(skus)]));
}
