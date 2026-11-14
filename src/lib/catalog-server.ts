// The store's catalog source for server code (pages, route handlers, jobs).
// CATALOG_SOURCE=postgres reads PostgreSQL; otherwise the static demo data
// is used (builds and browser tests run without a database).
import { cache } from "react";
import { database } from "./accounts";
import type { Locale } from "./i18n/locale";
import {
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
import { createStaticCatalog } from "./catalog-static";

const LOOKUP_CHUNK = MAX_PRODUCTS_PER_LOOKUP;

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

function createCatalog(locale: Locale): CatalogRepository {
  if (catalogSource() === "static")
    return createStaticCatalog(
      demoProducts,
      demoCategories.map((c) => c.id),
      locale,
    );
  if (!process.env.DATABASE_URL)
    throw new Error("CATALOG_SOURCE=postgres requires DATABASE_URL.");
  const store = createPostgresCatalog(database, locale);
  // The layout and page both read the catalog; cache() shares results within
  // one server render (it is a pass-through elsewhere).
  return {
    ...store,
    listProducts: cache(store.listProducts),
    taxonomy: cache(store.taxonomy),
  };
}

const repositories = new Map<Locale, CatalogRepository>();

/**
 * The catalog with names and descriptions in `locale`. Storefront pages pass
 * the visitor's locale; business logic (orders, emails) uses the default,
 * Bulgarian, the store's language.
 */
export function catalog(locale: Locale = "bg"): CatalogRepository {
  let repository = repositories.get(locale);
  if (!repository) {
    repository = createCatalog(locale);
    repositories.set(locale, repository);
  }
  return repository;
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
