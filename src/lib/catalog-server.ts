// The store's catalog source for server code (pages, route handlers, jobs).
// CATALOG_SOURCE=postgres reads PostgreSQL; otherwise the static demo data
// is used (builds and browser tests run without a database).
import { cache } from "react";
import { database } from "./accounts";
import {
  buildTaxonomy,
  productLookup,
  type Product,
  type CatalogRepository,
  type ProductLookup,
} from "./catalog";
import { demoCategories, demoProducts } from "./catalog-demo-data";
import {
  createPostgresCatalog,
  MAX_PRODUCTS_PER_LOOKUP,
} from "./catalog-postgres";

const LOOKUP_CHUNK = MAX_PRODUCTS_PER_LOOKUP;
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
  if (!process.env.DATABASE_URL)
    throw new Error("CATALOG_SOURCE=postgres requires DATABASE_URL.");
  const store = createPostgresCatalog(database);
  // The layout and page both read the catalog; cache() shares the result
  // within one server render (it is a pass-through elsewhere). The taxonomy
  // is built from the same cached list instead of a second full query.
  const listProducts = cache(store.listProducts);
  const categoryOrder = cache(store.categoryOrder);
  return {
    getProduct: store.getProduct,
    getProducts: store.getProducts,
    listProducts,
    taxonomy: cache(async () => {
      const [products, order] = await Promise.all([
        listProducts(),
        categoryOrder(),
      ]);
      return buildTaxonomy(products, order);
    }),
  };
}

let repository: CatalogRepository | undefined;

export function catalog(): CatalogRepository {
  return (repository ??= createCatalog());
}

/**
 * Loads only the given SKUs (in chunks the repository accepts) and returns a
 * lookup for pure logic. Call it before opening a transaction: with the
 * PostgreSQL catalog it needs its own pool connection.
 */
export async function lookupProducts(
  skus: Iterable<string>,
): Promise<ProductLookup> {
  const unique = [...new Set(skus)];
  const chunks: Promise<Product[]>[] = [];
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK)
    chunks.push(catalog().getProducts(unique.slice(i, i + LOOKUP_CHUNK)));
  return productLookup((await Promise.all(chunks)).flat());
}
