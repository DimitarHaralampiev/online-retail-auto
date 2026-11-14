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
5. **The server owns catalog data.** Client components read the category
   tree from `CatalogProvider` (filled by the root layout) and products per
   SKU through it. The provider keeps its value
   stable unless the catalog content changes, because `router.refresh()`
   (language switch, login) re-sends layout props as new objects and consumer
   effects must not re-run. ESLint forbids importing `catalog-demo-data`
   outside the static wiring, tests and scripts, and forbids components from
   importing `catalog-server`.

## Consequences

- Swapping the data source is a change in `catalog-server.ts` plus an adapter.
- SKU existence for customer actions is checked against the repository when the
  action runs, not inside the Zod schema (same 400 response and message).
- Remaining full-list reads: related products on `catalog/[sku]/page.tsx`
  and the promotions page; they should move to `browse()` queries.
- `generateStaticParams` on product pages enumerates the catalog at build time;
  with PostgreSQL (#26) pages must render on demand because CI builds have no
  database.

## Planned contract evolution

Recorded now so the PostgreSQL adapter does not freeze the interim shape.

- **#73 — category identity (done):** `Product.category` is `{ id, name }`
  (id = `product_categories.slug`), the taxonomy carries ids, browsing and
  catalog URLs filter by `?category=<slug>`; the catalog page still accepts
  the old display-name links and redirects them permanently to the slug URL.
- **#73 — locale (done):** `catalog(locale)` returns a repository whose
  products, categories and taxonomy are in that locale (PostgreSQL:
  `product_translations` / `category_translations`, falling back to Bulgarian;
  static: the UI dictionary). Filtering and search use the source text too, so
  a Cyrillic search still matches in English. Storefront pages pass the
  request locale; orders and emails use the store language (Bulgarian). The
  lookup API takes `?locale=`, and the client cache refreshes loaded products
  after a language switch while showing the previous names meanwhile.
- **#73 — prices (done):** `Product.priceCents` (regular) and
  `salePriceCents` (live promotion below it); promotions stay derived in
  `pricing.ts`.
- **#26 — done:** `catalog-postgres.ts` implements the current contract;
  `CATALOG_SOURCE=postgres` selects it. Categories are two levels deep
  (deeper rows are excluded, not misfiled). `getProducts` is bounded at 500
  SKUs; `lookupProducts` chunks larger sets. Code holding a transaction never
  awaits the catalog (it needs its own pool connection): catalog data is
  loaded before `BEGIN`, and the pool times out instead of hanging. Within one
  render each of the layout's reads (product list, taxonomy) runs once; until
  #27 removes the list from the layout, a render costs two catalog queries.
- **#27 — browsing (backend done):** `browse(query)` returns a page with the
  total; the static adapter and PostgreSQL share filter semantics
  (`filterProducts`) and are kept identical by a parity test matrix. In SQL,
  every read shares one `visible` CTE; the optional SKU filter is applied inside
  it (including the live-promotion aggregate), ORDER BY clauses are fixed and
  whitelisted, and text matching uses `position()` so input needs no escaping
  (fuzzy and transliterated search is #36). Taxonomy counts come from
  `GROUP BY`. At 10k products common queries take well under 100 ms. `normalizeBrowseQuery` (used by both adapters) makes any
  query SQL-safe: non-finite numbers are ignored, price bounds are rounded
  inward and clamped to the integer range, pages are capped at 1000, text is
  trimmed and capped at 100 characters and `compatibleSkus` at 1000. Still,
  `BrowseQuery` is trusted input: the catalog page must parse URL parameters
  with a Zod schema (page 1–1000, fixed page sizes, enums for sort and
  locale) and never accept `compatibleSkus` from the URL (fitment comes from
  the server; #13 should join on a vehicle key instead). Name sorting uses the
  ICU root collation in both adapters (`und-x-icu` / `Intl.Collator("und")`)
  so order does not depend on server locale; case-insensitive Cyrillic text
  matching relies on a UTF-8 database (`lower()`), which #36 replaces with
  proper search. The catalog page (step 2) parses its URL with Zod in
  `catalog-url.ts`, drops unknown categories, computes vehicle fitment on the
  server from the signed-in customer's selected vehicle (falling back to no
  filter on errors or more than 1000 SKUs) and renders one page with
  pagination; the client only changes the URL. Step 3 (done): the root layout provides only
  the category tree; client components load products per SKU from the public
  `GET /api/catalog/products` (published only, at most 100 SKUs, `no-store`)
  through a visit-lifetime cache in `CatalogProvider` that de-duplicates
  in-flight requests and retries failed lookups. The cart keeps stored items
  when lookups fail, loads every item's product before changing the cart,
  and checkout waits for missing products. Guest favourites are imported
  best-effort (unknown SKUs skipped). The inventory demo reads
  `listProducts()` on its server page. Open: exact stock is public through
  this API as before — decide whether to expose only availability (the cart
  needs the orderable quantity) — and public catalog routes have no rate
  limit yet (#51).
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
- **#28 — stock and price (done):** with the PostgreSQL catalog,
  `createOrder` reserves each line with a conditional
  `reserved = reserved + q WHERE on_hand - reserved >= q` (SKU order, inside
  the order transaction) and re-reads prices on the same connection; a
  shortage or price change rolls the order back. `stock_reservations` and
  `reserve`/`release`/`sale` movements record the lifecycle: handover
  consumes, cancellation releases, unpaid card orders expire after 30 minutes
  (`npm run orders:release-expired`), paid orders keep their stock. Stripe Checkout sessions
  expire after 31 minutes and reservations are extended past them, so a
  session never outlives its stock; an expired session or the job runs one
  routine (release, cancel, history, email). A payment that still arrives for
  a cancelled order is recorded, the order stays cancelled and a refund is
  flagged. Handover consumes the reservation or, for orders without one,
  deducts the lines directly, and lowers the inventory value at average cost.
  All multi-product locks use one SKU order (`compareSku`). Known limits:
  paid card orders cannot be cancelled until a refund flow exists (they hold
  stock until handover); movement reference keys assume each kind happens
  once per order and SKU (revisit for partial returns); the 30-minute window
  is a constant.
