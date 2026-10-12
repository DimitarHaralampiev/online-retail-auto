# Storefront usability review

Reference reviewed: [Avtozona wheel-cover collection](https://avtozona.net/collections/tasove) and its linked product pages, 12 October 2026. Inspected navigation, category hierarchy, filters, results toolbar, product cards, quick-view entry points, product detail sections and footer links in the browser.

## Applied to this store

- A compact category menu with three groups and six useful subcategories based on the existing products. Empty categories are omitted. The menu works by click or keyboard and closes with Escape or an outside click.
- Category and subcategory routing, breadcrumbs, price-range filtering, available-stock and promotion filters, sorting by effective price or name, grid/list views and removable filter chips.
- Native modal quick view with keyboard focus containment, Escape dismissal, product price, availability, quantity selection and a full-details link.
- Product information sections for description, verified compatibility and the actual test checkout behaviour, plus products from the same category.
- Bulgarian and English labels, translated search and mobile filter controls. Demo prices, stock and illustration labels remain explicit.

The visual design and wording are original. Reference product descriptions, photos, contact details, courier rates, promotions and compatibility claims were not imported.

## Follow-up work

The reference also exposes password recovery, reviews, legal information and commercial support links. These need their own verified workflows and business details. Do not invent ratings, supplier specifications, real courier delivery promises, financing options or legal policies. Product publishing, approved specifications and the connection between warehouse galleries and the live storefront remain a separate implementation. Add pagination and brand/size facets when the real catalog and validated attributes justify them.

## Validation

84 unit tests, TypeScript, Prettier and browser checks cover price parsing, discounted prices, combined stock/promotion/compatibility filters, non-mutating sorting, English search, category routing, grid/list selection, modal focus, mobile layouts, related products and information sections. Screenshots in `docs/screenshots/storefront-*.png` show this store's UI.
