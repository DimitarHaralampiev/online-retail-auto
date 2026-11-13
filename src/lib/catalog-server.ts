// The store's catalog source for server code (pages, route handlers, jobs).
// CATALOG_SOURCE=postgres reads PostgreSQL; otherwise the static demo data
// is used (builds and browser tests run without a database).
import { cache } from "react";
import { database } from "./accounts";
import {
  productLookup,
  type CatalogRepository,
  type ProductLookup,
} from "./catalog";
import { demoCategories, demoProducts } from "./catalog-demo-data";
import { createPostgresCatalog } from "./catalog-postgres";
import { createStaticCatalog } from "./catalog-static";

export type CatalogSource = "static" | "postgres";

export function catalogSource(
  value = process.env.CATALOG_SOURCE,
): CatalogSource {
  if (!value || value === "static") return "static";
  if (value === "postgres") return "postgres";
  throw new Error(
    `CATALOG_SOURCE must be "static" or "postgres", got "${value}".`,
  );
}

function createCatalog(): CatalogRepository {
  if (catalogSource() === "static")
    return createStaticCatalog(demoProducts, demoCategories);
  const store = createPostgresCatalog(database);
  // The layout and page both read the catalog; cache() shares the result
  // within one server render (it is a pass-through elsewhere).
  return {
    ...store,
    listProducts: cache(store.listProducts),
    taxonomy: cache(store.taxonomy),
  };
}

let repository: CatalogRepository | undefined;

export function catalog(): CatalogRepository {
  return (repository ??= createCatalog());
}

/** Loads only the given SKUs and returns a lookup for pure checkout logic. */
export async function lookupProducts(
  skus: Iterable<string>,
): Promise<ProductLookup> {
  return productLookup(await catalog().getProducts([...new Set(skus)]));
}
