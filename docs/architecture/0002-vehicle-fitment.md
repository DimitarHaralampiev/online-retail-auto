# ADR 0002: Vehicle reference and product fitment

Status: accepted (2026-11-22, #31). Builds on ADR 0001.

## Context

Shoppers choose parts by car. The garage and the demo `compatibleSkus` logic
use free-text make, model, year and engine (`garage_vehicles`,
`product_fitments`), which cannot be validated, listed in a selector or used
for landing pages. AGENTS.md forbids invented fitment data.

## Decision

- A normalised reference: `vehicle_makes` > `vehicle_models` >
  `vehicle_generations` (production years, open-ended while in production) >
  `vehicle_engines` (fuel, displacement, power, engine code). Slugs on makes
  and models serve `/cars/[make]/[model]` pages (#34). Makes and models carry
  `active`; every lookup below them checks it, so hiding a make or model hides
  everything under it, including its fitments.
- `product_vehicle_fitments` links a product to a whole generation
  (`engine_id` NULL) or to one engine of it, optionally limited to part of the
  generation's years (`year_from`/`year_to`). A composite foreign key keeps the
  engine inside its generation. Every row records its verification `source`.
  Reference rows used by fitments cannot be deleted (RESTRICT); deleting the
  admin who entered a fitment keeps it (`created_by` is set to NULL).
- **Facelifts:** a facelift that changes parts is modelled with fitment years
  within one generation, or as its own generation when the manufacturer treats
  it as one. A year in the selector may belong to two generations (changeover
  years); the selector (#32) then asks which one.
- `warehouse_products.universal_fit` marks products that fit every vehicle.
- **Matching** (`compatibleSkus` in `src/lib/vehicles.ts`): published
  products only; generation-wide fitments, fitments for the chosen engine,
  year-limited fitments when the year is known, and universal products. It is
  conservative: without an engine or year, limited fitments are not claimed
  to fit.
- **Fit status for #33:** the storefront needs three states per product:
  _fits_ (as above), _check fitment_ (fits some engines or years of the
  generation, or the shopper has not narrowed it down) and _universal_. #33
  adds that as a separate per-SKU status rather than widening
  `compatibleSkus`.
- **Catalog scale:** `compatibleSkus` returns a full list and suits small sets
  (garage, product page). The catalog filter (#33) puts the same rule into the
  browse SQL as an `EXISTS` predicate (`OR universal_fit`) instead of passing a
  SKU array, which the browse query caps at 1000.
- No reference or fitment data in migrations or seeds. It is loaded from a
  verified source through the admin and CSV import (#91, #35). Tests use
  fictional fixtures.

## Migration path for the free-text tables

- `garage_vehicles` stays (reminders reference it). #32 adds nullable
  `generation_id`/`engine_id` (ON DELETE SET NULL); the free-text columns stay
  for display and for vehicles not mapped yet.
- `product_fitments` was dropped in #33 (migration 016) **without** copying
  its rows: free-text rows are not verified, and mapping them would invent
  fitment. Its reader in `customer-features.ts` went with it.

## Consequences and known limits

- The selector (#32) and catalog filter (#33) show real results only once
  reference data is loaded (#91). Fit badges (#33) never claim more than the
  data says: no badge for products without verified data.
- Manual entry, editing and hiding at every level exist next to the CSV import
  (#91), so data can be entered from manufacturer catalogues without any
  licence.
- Choosing a data source is a business decision (#91): licensed catalogues
  such as TecDoc are paid; manual entry from manufacturer catalogues is free
  but slow.
- Body type and drivetrain (estate/hatchback, 4x4) are not modelled; fitments
  that depend on them go into `notes` or wait for a later extension.
- Engines are stored per generation, so an engine shared by several
  generations is entered once per generation.
