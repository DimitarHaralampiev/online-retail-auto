# ADR 0002: Vehicle reference and product fitment

Status: accepted (2026-11-14, #31). Builds on ADR 0001.

## Context

Shoppers choose parts by car. The garage and the demo `compatibleSkus` logic
use free-text make, model, year and engine (`garage_vehicles`,
`product_fitments`), which cannot be validated, listed in a selector or used
for landing pages. AGENTS.md forbids invented fitment data.

## Decision

- A normalised reference: `vehicle_makes` > `vehicle_models` >
  `vehicle_generations` (production years, open-ended while in production) >
  `vehicle_engines` (fuel, displacement, power, engine code). Slugs on makes
  and models serve future `/cars/[make]/[model]` pages (#34).
- `product_vehicle_fitments` links a product to a whole generation
  (`engine_id` NULL) or to one engine of it. A composite foreign key keeps the
  engine inside its generation. Every row records its verification `source`.
- `warehouse_products.universal_fit` marks products that fit every vehicle.
- Matching (`src/lib/vehicles.ts`, `compatibleSkus`): generation-wide
  fitments, fitments for the chosen engine and universal products. With only a
  generation chosen, engine-specific parts are not claimed to fit.
- No reference or fitment data in migrations or seeds. It is loaded from a
  verified source through the admin (#35). Tests use fictional fixtures.
- The free-text tables stay until the storefront switches (#33).

## Consequences

- The selector (#32) and catalog filter (#33) work only once reference data
  is loaded; until then the storefront keeps its current behaviour.
- Choosing a data source is a business decision. Licensed catalogues such as
  TecDoc are paid; manual entry from manufacturer catalogues is free but slow.
