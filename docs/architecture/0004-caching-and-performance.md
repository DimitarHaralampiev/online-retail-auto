# ADR 0004: Caching strategy and performance budget

Status: accepted (2026-11-23, #43).

## Context

Every storefront page is rendered per request: it reads the language and
session cookies, and prices, promotions and stock change with every order.
The catalog's category tree (taxonomy, with product counts) is read by the
root layout on every page, although it only changes when an admin edits
products or categories. The shop must stay fast as the catalog grows, and
regressions should fail CI rather than reach shoppers.

## Decision

### What is cached

| Data                              | Where                          | Freshness                                               |
| --------------------------------- | ------------------------------ | ------------------------------------------------------- |
| Taxonomy (per language)           | Next data cache, tag `catalog` | Until an admin change; at most 5 min for other changes  |
| Data shared by layout and page    | React `cache()`                | One render                                              |
| Vehicle lookups (`/api/vehicles`) | HTTP `public, s-maxage=300`    | 5 min (hiding a make/model takes effect within minutes) |
| Product sitemaps                  | HTTP `public, max-age=3600`    | 1 h                                                     |
| Static assets (`/_next/static`)   | Immutable HTTP caching (Next)  | Per build                                               |

Not cached across requests: product data, prices, promotions, stock,
search, facets, carts, accounts, orders. They are cheap indexed queries
and must be exact (stock moves with every order; checkout re-reads prices
under row locks anyway).

### Invalidation

- `src/lib/catalog-cache.ts` wraps the taxonomy in `unstable_cache` with the
  `catalog` tag and a 300-second revalidation.
- Every admin change to products, categories, imports or fitment calls
  `refreshStorefront()`, which runs `revalidateTag("catalog", { expire: 0 })`
  and `revalidatePath("/", "layout")`. Shoppers see the change on the next
  request after the admin's request completes (measured: under half a
  second).
- Changes outside the admin (the demo seed script, manual SQL) are picked
  up within 5 minutes.
- Caching runs only inside the Next.js server (`NEXT_RUNTIME`); scripts and
  tests always read the database directly.
- `unstable_cache` is used rather than `use cache`, which would require
  opting into Cache Components across the app; Next.js recommends
  `unstable_cache` for non-`fetch` data that should survive deployments.

### Multiple instances

The default cache is per server instance. With several instances, an
admin change is immediate on the instance that served the admin and within
5 minutes elsewhere. Before scaling out, configure a shared `cacheHandler`
(e.g. Redis) so tag invalidation reaches every instance.

### Performance budget

`e2e/performance.spec.ts` runs in the existing Playwright CI job on desktop
and mobile emulation, against the production build:

- **LCP ≤ 2.5 s, CLS ≤ 0.1** on `/`, `/catalog` and a product page
  (Google's "good" thresholds), measured with `PerformanceObserver`.
- **Interaction ≤ 200 ms** (an INP proxy from the Event Timing API) for a
  client-side catalog interaction.
- **JavaScript ≤ the script budget** (compressed bytes per page, first
  visit), to catch dependency and bundle growth.

Lab numbers on CI hardware are not field data; they catch regressions.
Field Core Web Vitals (real users) are collected with consent (ADR 0005).
Lighthouse CI was considered and not adopted for now: it adds a browser
download and a second runner for checks the Playwright job already makes.

## Consequences

- One database query per page less for the category tree, without stale
  data after admin edits.
- Performance regressions beyond the budgets fail the pull request.
- Scaling to several instances requires the shared cache handler noted
  above.
