# ADR 0003: Search provider and when to adopt a search engine

Status: accepted (2026-11-22, #39). Builds on ADR 0001 and #36.

## Context

Search runs in PostgreSQL (#36, migration 017): a trigger-maintained
`product_search` document per product, full text (`tsvector`, `simple`
configuration on Latin-normalised text), `pg_trgm` typo tolerance and
Bulgarian Cyrillic↔Latin transliteration (`search_latin`). The catalog's
`BrowseQuery.search` combines it with every other filter (category, price,
stock, promotions, vehicle fitment) in one SQL query.

The shop starts with a small catalog but must scale. Dedicated engines
(Meilisearch, Typesense) offer typo tolerance, synonyms, faceting and
sub-50 ms latency at large sizes, at the cost of another service to run,
monitor and keep in sync.

## Decision

- Search behind a `SearchProvider` interface (`src/lib/search.ts`):
  `suggest(text, limit)` returns products and categories for autocomplete
  (#37). The storefront gets it from `searchProvider(locale)` in
  `catalog-server.ts`, like `catalog(locale)`.
- The current provider, `createCatalogSearch(catalog)`, is built on the
  catalog repository: products come from `browse({ search })`, so suggestions
  obey the same visibility, pricing and ranking rules as the catalog;
  categories are matched against the cached taxonomy with `latinize()`, the
  JavaScript twin of `search_latin` (an integration test keeps them equal).
- Catalog results keep using `CatalogRepository.browse({ search })`. No
  engine is adopted now.

## When to adopt an engine

Adopt Meilisearch or Typesense when any of these holds in production,
measured over a week:

- more than **50,000 published products**, or `product_search` above
  ~200 MB;
- **p95 search latency above 150 ms** for `browse({ search })` or above
  80 ms for `suggest()` (autocomplete needs to feel instant);
- requirements PostgreSQL handles poorly: synonym lists maintained by
  merchandisers, per-attribute weighting, or many facets (#38) computed per
  keystroke.

Before that, cheaper steps come first:

1. Use the indexed trigram operator (`search_latin($q) <% document` with
   `pg_trgm.word_similarity_threshold`) instead of the `word_similarity()`
   function, which scans the table.
2. Cache `suggest()` results per normalised query for a short time.
3. Move search reads to a read replica.

## Design when an engine is adopted

- **Index content:** one document per published product: SKU, codes,
  Bulgarian and English names and descriptions, brand, category ids,
  `pay_cents`, availability, promotion flag, `universal_fit` and the
  fitment generation and engine ids. Filters the engine cannot express
  stay in PostgreSQL.
- **Sync:** the existing triggers also insert the SKU into a
  `search_outbox(sku, changed_at)` table in the same transaction. A worker
  (the background job queue, #53) reads the outbox in batches, loads the
  documents with the catalog's `visible` rules, and upserts or deletes them
  in the engine. That gives at-least-once delivery with no dual writes from
  request handlers. Stock and price changes that matter for filters
  (availability, `pay_cents`) are added to the outbox by the stock and
  promotion code paths.
- **Rebuild:** a script re-indexes everything from PostgreSQL. Search keeps
  working from PostgreSQL while the engine is rebuilt or unavailable: the
  provider falls back to `createCatalogSearch`.
- **Browse:** with an engine, `browse({ search })` asks the provider for
  ranked SKUs (bounded, for example 1,000) and filters and pages them in
  PostgreSQL, or lets the engine filter when every requested filter is
  indexed. The interface gains a `match(text, filters)` method at that
  point, not before.

## Consequences

- The storefront depends on `SearchProvider`, not on SQL, for autocomplete;
  swapping the implementation does not touch components or routes.
- Until an engine is adopted there is no new infrastructure, and search is
  always consistent with the catalog (same transaction, same rules).
