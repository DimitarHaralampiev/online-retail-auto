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
   `subcategory`; the category tree with counts is derived (`buildTaxonomy`).
   Subcategories already have an `{id, name}` identity. Top-level categories
   are still identified by their Bulgarian display name (also the URL key); see
   "Planned contract evolution".
4. **Pure logic takes data as input.** Cart totals, checkout preview, guest
   favourites and repeat orders receive a `ProductLookup` or product list
   instead of importing data, so they stay unit-testable and storage-agnostic.
   Server code loads only the SKUs it needs (`lookupProducts`).
5. **The server owns catalog data.** Client components read it from
   `CatalogProvider`, filled by the root layout. The provider keeps its value
   stable unless the catalog content changes, because `router.refresh()`
   (language switch, login) re-sends layout props as new objects and consumer
   effects must not re-run. ESLint forbids importing `catalog-demo-data`
   outside the static wiring, tests and scripts, and forbids components from
   importing `catalog-server`.

## Consequences

- Swapping the data source is a change in `catalog-server.ts` plus an adapter.
- SKU existence for customer actions is checked against the repository when the
  action runs, not inside the Zod schema (same 400 response and message).
- Interim: full-list reads remain and #27 must replace them before the catalog
  grows: the root layout's `CatalogProvider` products (cart, favourites,
  repeat order in `my-orders.tsx`, catalog browsing in `catalog.tsx`,
  `inventory-demo.tsx`), related products on `catalog/[sku]/page.tsx`, the
  promotions page and `generateStaticParams`.
- `generateStaticParams` on product pages enumerates the catalog at build time;
  with PostgreSQL (#26) pages must render on demand because CI builds have no
  database.

## Planned contract evolution

Recorded now so the PostgreSQL adapter does not freeze the interim shape.

- **#73 — category identity:** `category: { id /* slug */, name }`, like
  `subcategory`; the display name stops being a key (it breaks once names are
  translated). Category URLs may move to the slug.
- **#73 — locale:** scope the repository per request, `catalog({ locale })`,
  wrapped in React `cache()`, so the adapter returns localised names and
  descriptions from `product_translations` / `category_translations` instead of
  translating demo strings in the browser.
- **#73 — prices:** rename `demoPriceCents` / `demoSalePriceCents` to
  `priceCents` / `salePriceCents`; promotions stay derived in `pricing.ts`.
- **#26 — done:** `catalog-postgres.ts` implements the current contract;
  `CATALOG_SOURCE=postgres` selects it. Categories are two levels deep
  (deeper rows are excluded, not misfiled). `getProducts` is bounded at 500
  SKUs; `lookupProducts` chunks larger sets. Code holding a transaction never
  awaits the catalog (it needs its own pool connection): catalog data is
  loaded before `BEGIN`, and the pool times out instead of hanging. Within one
  render the layout's product list and taxonomy share one cached query.
- **#27 — browsing (backend done):** `browse(query)` returns a page with the
  total; the static adapter and PostgreSQL share filter semantics
  (`filterProducts`) and are kept identical by a parity test matrix. In SQL,
  every read shares one `visible` CTE; the optional SKU filter is applied inside
  it (including the live-promotion aggregate), ORDER BY clauses are fixed and
  whitelisted, and text matching uses `position()` so input needs no escaping
  (fuzzy and transliterated search is #36). Taxonomy counts come from
  `GROUP BY`. At 10k products common queries take well under 100 ms. Still to
  do in #27: catalog pages call `browse()` with URL-driven filters, and
  client components stop receiving the full product list.
- **#26 — live promotions:** a promotion line applies when its promotion has
  `status='active' AND (starts_at IS NULL OR starts_at <= now()) AND
(ends_at IS NULL OR ends_at > now())`; with several live lines for a SKU the
  lowest `sale_price_cents` wins. `warehouse_products.selling_price_cents` is
  the regular price (the line's `regular_price_cents` is informational).
- **#44 — images:** once product media has a public route, the primary
  `product_media` image wins; until then the PostgreSQL adapter uses
  `warehouse_products.image_path` (a static `/images/...` file, enforced by the
  `warehouse_products_image_path_local` constraint) or a fallback image.
- **#25 — demo data:** `npm run db:seed:demo` loads the demo catalog
  (`is_demo` products and categories) outside migrations. Stock is seeded as
  the demo's available quantity with nothing reserved, so `reserved` only ever
  comes from `stock_reservations`.
- **#28 — stock and price:** `Product.stock` is a display snapshot.
  `createOrder` must re-read price and check/reserve stock inside the order
  transaction (`SELECT … FOR UPDATE` or a conditional `UPDATE`).
