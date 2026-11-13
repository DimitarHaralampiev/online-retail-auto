# ADR 0001: Catalog repository

- Status: accepted (#24)
- Context epic: #12 — database-backed catalog

## Context

The storefront, cart, checkout, orders and customer features read a hardcoded
array of demo products (`src/lib/catalog.ts`). Client components imported it
directly. The database already has `warehouse_products`, categories and
translations, but every new product needed a code change and the data could
not grow beyond what is safe to bundle into the browser.

## Decision

1. **One contract.** `CatalogRepository` (`src/lib/catalog.ts`) is an async
   interface: `listProducts`, `getProduct`, `getProducts(skus)` and `taxonomy`.
   Server code obtains it from `catalog()` in `src/lib/catalog-server.ts`, the
   only place that chooses the implementation.
2. **Adapters behind it.** `createStaticCatalog` serves the demo data today and
   test fixtures. The PostgreSQL adapter (#26) plugs in behind the same
   interface, so callers do not change.
3. **Products carry their taxonomy.** Each `Product` has its `category` and
   `subcategory`; the category tree with counts is derived (`buildTaxonomy`),
   which maps directly onto `product_categories.parent_id`.
4. **Pure logic takes data as input.** Cart totals, checkout preview, guest
   favourites and repeat orders receive a `ProductLookup` or product list
   instead of importing data, so they stay unit-testable and storage-agnostic.
   Server code loads only the SKUs it needs (`lookupProducts`).
5. **The server owns catalog data.** Client components read it from
   `CatalogProvider`, filled by the root layout. ESLint forbids importing
   `catalog-demo-data` outside the static wiring, tests and scripts.

## Consequences

- Swapping the data source is a change in `catalog-server.ts` plus an adapter.
- SKU existence for customer actions is checked against the repository when the
  action runs, not inside the Zod schema (same 400 response and message).
- Interim: the layout still sends the full (six-product) list to the client for
  cart and favourites. #27 replaces this with per-SKU lookups and server-side
  pagination before the catalog grows.
- `generateStaticParams` on product pages enumerates the catalog at build time;
  with PostgreSQL (#26) pages must render on demand because CI builds have no
  database.
