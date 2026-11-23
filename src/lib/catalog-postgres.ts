// CatalogRepository over PostgreSQL (warehouse_products, product_categories,
// translations and promotions). Implements the current contract; the planned
// contract evolution (category ids, per-request locale, price field names) is
// recorded in docs/architecture/0001-catalog-repository.md.
//
// All reads share one `visible` CTE, so listing, lookups, browsing and
// category counts apply exactly the same visibility and pricing rules.
import type pg from "pg";
import {
  normalizeBrowseQuery,
  type BrowseQuery,
  type BrowseSort,
  type CatalogRepository,
  type AttributeFacet,
  type BrandFacet,
  type CatalogFacets,
  type CatalogTaxonomy,
  type Product,
} from "./catalog";
import type { Locale } from "./i18n/locale";

/** Shown until products have their own public images (#44). */
export const FALLBACK_PRODUCT_IMAGE = "/images/garage-hero.png";

/** Upper bound for one getProducts call; callers are bounded well below. */
export const MAX_PRODUCTS_PER_LOOKUP = 500;

type Queryable = Pick<pg.Pool, "query">;

type ProductRow = {
  sku: string;
  name: string;
  description: string;
  image_path: string | null;
  media_path: string | null;
  price_cents: number;
  sale_cents: number | null;
  on_hand: number;
  reserved: number;
  category_slug: string;
  category_name: string;
  parent_name: string | null;
  top_slug: string;
  name_en: string;
  description_en: string;
  category_name_en: string;
  parent_name_en: string | null;
};

// $1: optional SKU filter (lookups, vehicle fitment). Names are Bulgarian;
// English translations are exposed for locale-aware search and sorting.
const VISIBLE_CTE = `
live_sale AS (
  SELECT l.sku, min(l.sale_price_cents) AS sale_cents
  FROM promotion_lines l
  JOIN promotions p ON p.id = l.promotion_id
  WHERE p.status = 'active'
    AND (p.starts_at IS NULL OR p.starts_at <= now())
    AND (p.ends_at IS NULL OR p.ends_at > now())
    AND ($1::text[] IS NULL OR l.sku = ANY($1))
  GROUP BY l.sku
),
visible AS (
  SELECT w.sku,
         coalesce(t.name, w.name) AS name,
         coalesce(t.description, '') AS description,
         coalesce(te.name, t.name, w.name) AS name_en,
         coalesce(te.description, t.description, '') AS description_en,
         w.image_path,
         -- The primary uploaded image wins over the static path (#44).
         (SELECT '/media/' || m.id FROM product_media m
          WHERE m.sku = w.sku AND m.is_primary AND m.kind = 'image'
          LIMIT 1) AS media_path,
         w.selling_price_cents AS price_cents,
         s.sale_cents,
         CASE WHEN s.sale_cents < w.selling_price_cents
              THEN s.sale_cents ELSE w.selling_price_cents END AS pay_cents,
         w.on_hand,
         w.reserved,
         w.universal_fit,
         w.brand,
         w.content_updated_at,
         c.slug AS category_slug,
         coalesce(ct.name, cte.name, c.slug) AS category_name,
         coalesce(pt.name, pte.name, parent.slug) AS parent_name,
         coalesce(cte.name, ct.name, c.slug) AS category_name_en,
         coalesce(pte.name, pt.name, parent.slug) AS parent_name_en,
         coalesce(parent.sort_order, c.sort_order) AS top_sort,
         coalesce(parent.slug, c.slug) AS top_slug,
         CASE WHEN parent.id IS NULL THEN -1 ELSE c.sort_order END AS sub_sort
  FROM warehouse_products w
  JOIN product_categories c ON c.id = w.category_id AND c.active
  LEFT JOIN product_categories parent ON parent.id = c.parent_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'bg'
  LEFT JOIN category_translations cte ON cte.category_id = c.id AND cte.locale = 'en'
  LEFT JOIN category_translations pt ON pt.category_id = parent.id AND pt.locale = 'bg'
  LEFT JOIN category_translations pte ON pte.category_id = parent.id AND pte.locale = 'en'
  LEFT JOIN product_translations t ON t.sku = w.sku AND t.locale = 'bg'
  LEFT JOIN product_translations te ON te.sku = w.sku AND te.locale = 'en'
  LEFT JOIN live_sale s ON s.sku = w.sku
  WHERE w.status = 'published'
    AND w.selling_price_cents IS NOT NULL
    -- Two levels only (category > subcategory); deeper rows are excluded
    -- rather than misfiled until the category tree supports more (#73).
    AND (parent.id IS NULL OR (parent.active AND parent.parent_id IS NULL))
    AND ($1::text[] IS NULL OR w.sku = ANY($1))
)`;

const FEATURED_ORDER = "top_sort, top_slug, sub_sort, category_slug, sku";

const PRODUCTS_SQL = `WITH ${VISIBLE_CTE}
SELECT * FROM visible ORDER BY ${FEATURED_ORDER}`;

// Fixed, whitelisted ORDER BY clauses; never built from user input.
const BROWSE_ORDER: Record<BrowseSort, string> = {
  featured: FEATURED_ORDER,
  "price-asc": `pay_cents, ${FEATURED_ORDER}`,
  "price-desc": `pay_cents DESC, ${FEATURED_ORDER}`,
  // ICU root collation: identical to Intl.Collator("und") in the static
  // adapter and independent of the database's locale settings.
  name: `(CASE WHEN $9 = 'en' THEN name_en ELSE name END) COLLATE "und-x-icu", ${FEATURED_ORDER}`,
};

// $2 category id (top-level slug), $3 subcategory id, $4 text, $5/$6 price bounds,
// $7 available only, $8 promotions only, $9 locale, $10 limit, $11 offset,
// $12/$13/$14 vehicle generation, engine and year (ADR 0002: generation-wide
// fitments, the chosen engine's, year-limited ones only with a known year,
// and universal products).
// $15 shopper search (migration 017): an exact code, full-text words, or a
// trigram match of the Latin-normalised query.
const SEARCH_MATCH = `($15::text IS NULL
  OR s.codes @> ARRAY[search_code($15)]
  OR s.tsv @@ plainto_tsquery('simple', search_latin($15))
  OR position(search_latin($15) IN s.document) > 0
  OR word_similarity(search_latin($15), s.document) >= 0.45)
  -- An exact code shows only the products with that code.
  AND ($15::text IS NULL OR s.codes @> ARRAY[search_code($15)] OR NOT EXISTS (
        SELECT 1 FROM visible exact
        JOIN product_search es ON es.sku = exact.sku
        WHERE es.codes @> ARRAY[search_code($15)]))`;

// Exact codes first, then text rank, then closeness of the fuzzy match.
const RELEVANCE_ORDER = `(s.codes @> ARRAY[search_code($15)]) DESC,
  ts_rank(s.tsv, plainto_tsquery('simple', search_latin($15))) DESC,
  word_similarity(search_latin($15), s.document) DESC, ${FEATURED_ORDER}`;

// The chosen attribute values ($17, {key: [value keys]}) as (key, value_key)
// rows; keys that are not filterable (any more) are ignored (migration 028).
const WANTED_ATTRIBUTES = `
SELECT d.key, chosen.value_key
FROM jsonb_each(coalesce($17::jsonb, '{}')) AS want(key, vals)
JOIN attribute_definitions d ON d.key = want.key AND d.filterable
CROSS JOIN LATERAL jsonb_array_elements_text(want.vals) AS chosen(value_key)`;

// A product has one value per attribute, so it matches when it has as many
// chosen values as there are chosen attributes. Uncorrelated on purpose:
// evaluated once, not per product.
const ATTRIBUTES_MATCH = `($17::jsonb IS NULL
  OR NOT EXISTS (${WANTED_ATTRIBUTES})
  OR visible.sku IN (
    SELECT a.sku FROM product_attributes a
    JOIN (${WANTED_ATTRIBUTES}) w ON w.key = a.key AND w.value_key = a.value_key
    GROUP BY a.sku
    HAVING count(*) = (SELECT count(DISTINCT k.key) FROM (${WANTED_ATTRIBUTES}) k)))`;

// Every browse filter; leaving out brands or attributes is for those facets'
// own counts. $16 brand keys (migration 018).
const browseFilters = ({
  brands = true,
  attributes = true,
}: { brands?: boolean; attributes?: boolean } = {}) => `
WHERE ($2::text IS NULL OR top_slug = $2)
  AND ($3::text IS NULL OR (parent_name IS NOT NULL AND category_slug = $3))
  AND ($4::text IS NULL
       OR position(lower($4) IN lower(name || ' ' || visible.sku || ' ' || description)) > 0
       OR ($9::text = 'en'
           AND position(lower($4) IN lower(name_en || ' ' || description_en)) > 0))
  AND ($5::int IS NULL OR pay_cents >= $5)
  AND ($6::int IS NULL OR pay_cents <= $6)
  AND (NOT $7::boolean OR on_hand - reserved > 0)
  AND (NOT $8::boolean OR sale_cents < price_cents)
  AND ($12::uuid IS NULL OR universal_fit OR EXISTS (
        SELECT 1 FROM product_vehicle_fitments f
        WHERE f.sku = visible.sku AND f.generation_id = $12
          AND (f.engine_id IS NULL OR f.engine_id = $13::uuid)
          AND (f.year_from IS NULL OR f.year_from <= $14::int)
          AND (f.year_to IS NULL OR f.year_to >= $14::int)))
  AND ${SEARCH_MATCH}
  ${brands ? "AND ($16::text[] IS NULL OR brand_key(brand) = ANY($16))" : "AND $16::text[] IS NOT DISTINCT FROM $16"}
  ${attributes ? `AND ${ATTRIBUTES_MATCH}` : "AND $17::jsonb IS NOT DISTINCT FROM $17"}`;

const browseSql = (sort: BrowseSort, relevance: boolean) => `WITH ${VISIBLE_CTE}
SELECT visible.*, count(*) OVER () AS total FROM visible
LEFT JOIN product_search s ON s.sku = visible.sku
${browseFilters()}
ORDER BY ${relevance ? RELEVANCE_ORDER : BROWSE_ORDER[sort]}
LIMIT $10 OFFSET $11`;

// Brand counts under every other filter ($10 caps the number of brands;
// $11 is always 0).
const BRAND_FACETS_SQL = `WITH ${VISIBLE_CTE},
filtered AS (
  SELECT brand_key(brand) AS key, trim(brand) AS spelling
  FROM visible
  LEFT JOIN product_search s ON s.sku = visible.sku
  ${browseFilters({ brands: false })}
    AND brand_key(brand) <> ''
)
SELECT key,
       -- The most common spelling; on a tie a title-case one ("Bosch").
       (SELECT spelling FROM filtered named WHERE named.key = f.key
        GROUP BY spelling
        ORDER BY count(*) DESC, (spelling ~ '^[[:upper:]][[:lower:]]') DESC, spelling
        LIMIT 1) AS name,
       count(*)::int AS count
FROM filtered f
GROUP BY key
ORDER BY 3 DESC, 1
LIMIT $10 OFFSET $11`;

// Attribute counts: a product counts for an attribute when it matches every
// other filter, i.e. every chosen attribute except possibly that one: of its
// matching chosen values, take away the one for this attribute, and compare
// with the number of chosen attributes other than this one. At most 50 values
// per attribute, the most common ones ($10 caps all rows).
const ATTRIBUTE_FACETS_SQL = `WITH ${VISIBLE_CTE},
wanted AS MATERIALIZED (${WANTED_ATTRIBUTES}),
wanted_keys AS MATERIALIZED (SELECT DISTINCT key FROM wanted),
matched AS MATERIALIZED (
  SELECT a.sku, count(*) AS hits FROM product_attributes a
  JOIN wanted w ON w.key = a.key AND w.value_key = a.value_key
  GROUP BY a.sku
),
base AS MATERIALIZED (
  SELECT visible.sku
  FROM visible
  LEFT JOIN product_search s ON s.sku = visible.sku
  ${browseFilters({ attributes: false })}
),
-- Counted per spelling first: only the few distinct ones are then sorted.
spelled AS (
  SELECT a.key, a.value_key, a.value, count(*) AS count
  FROM product_attributes a
  JOIN base ON base.sku = a.sku
  LEFT JOIN matched m ON m.sku = a.sku
  LEFT JOIN wanted w ON w.key = a.key AND w.value_key = a.value_key
  LEFT JOIN wanted_keys k ON k.key = a.key
  WHERE coalesce(m.hits, 0) - (w.key IS NOT NULL)::int
        = (SELECT count(*) FROM wanted_keys) - (k.key IS NOT NULL)::int
  GROUP BY a.key, a.value_key, a.value
),
counted AS (
  SELECT key, value_key, sum(count)::int AS count,
         (array_agg(value ORDER BY count DESC, value COLLATE "C"))[1] AS value
  FROM spelled
  GROUP BY key, value_key
),
ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY key ORDER BY count DESC, value_key) AS place
  FROM counted
)
SELECT d.key,
       CASE WHEN $9 = 'en' AND d.name_en <> '' THEN d.name_en ELSE d.name_bg END AS name,
       d.unit, r.value_key, r.value, r.count
FROM attribute_definitions d
LEFT JOIN ranked r ON r.key = d.key AND r.place <= 50
WHERE d.filterable
  -- A chosen attribute stays listed even when nothing matches.
  AND (r.key IS NOT NULL OR coalesce($17::jsonb, '{}') ? d.key)
ORDER BY d.sort_order, d.key, r.place
LIMIT $10 OFFSET $11`;

// Sitemaps: visible products in SKU order ($2 offset, $3 limit).
const COUNT_SQL = `WITH ${VISIBLE_CTE} SELECT count(*)::int AS count FROM visible`;
const SKU_PAGE_SQL = `WITH ${VISIBLE_CTE}
SELECT sku, content_updated_at AS updated_at FROM visible
ORDER BY sku OFFSET $2 LIMIT $3`;

// Category counts computed in SQL, in display order.
const TAXONOMY_SQL = `WITH ${VISIBLE_CTE}
SELECT top_slug AS category_id,
       min(coalesce(parent_name, category_name)) AS category,
       min(coalesce(parent_name_en, category_name_en)) AS category_en,
       CASE WHEN parent_name IS NULL THEN NULL ELSE category_slug END AS sub_id,
       min(CASE WHEN parent_name IS NULL THEN NULL ELSE category_name END) AS sub_name,
       min(CASE WHEN parent_name IS NULL THEN NULL ELSE category_name_en END) AS sub_name_en,
       min(top_sort) AS top_sort, min(sub_sort) AS sub_sort,
       count(*)::int AS products
FROM visible
GROUP BY top_slug, sub_id
ORDER BY top_sort, top_slug, sub_sort, sub_id NULLS FIRST`;

/** Maps a row to a Product with names in the requested locale. */
function toProduct(row: ProductRow, locale: Locale): Product {
  const en = locale === "en";
  const sub = row.parent_name !== null;
  const categoryName = en ? row.category_name_en : row.category_name;
  return {
    sku: row.sku,
    name: en ? row.name_en : row.name,
    category: {
      id: row.top_slug,
      name: sub ? (en ? row.parent_name_en! : row.parent_name!) : categoryName,
    },
    subcategory: sub ? { id: row.category_slug, name: categoryName } : null,
    description: en ? row.description_en : row.description,
    image: row.media_path ?? row.image_path ?? FALLBACK_PRODUCT_IMAGE,
    priceCents: row.price_cents,
    // A sale only counts when it is actually below the regular price.
    ...(row.sale_cents !== null && row.sale_cents < row.price_cents
      ? { salePriceCents: row.sale_cents }
      : {}),
    stock: { onHand: row.on_hand, reserved: row.reserved },
  };
}

/**
 * @param locale names and descriptions are returned in this locale, falling
 *   back to Bulgarian (then the warehouse name or category slug).
 */
/** Positional parameters of the browse and facet queries (see the SQL). */
function browseParams(
  query: ReturnType<typeof normalizeBrowseQuery>,
  limit: number,
  offset: number,
): unknown[] {
  return [
    query.compatibleSkus ? [...query.compatibleSkus] : null,
    query.category ?? null,
    query.subcategory ?? null,
    query.text ?? null,
    query.minPriceCents ?? null,
    query.maxPriceCents ?? null,
    !!query.available,
    !!query.promotions,
    query.locale ?? "bg",
    limit,
    offset,
    query.vehicle?.generationId ?? null,
    query.vehicle?.engineId ?? null,
    query.vehicle?.year ?? null,
    query.search ?? null,
    query.brands?.length ? [...query.brands] : null,
    query.attributes ? JSON.stringify(query.attributes) : null,
  ];
}

export function createPostgresCatalog(
  db: () => Queryable,
  locale: Locale = "bg",
): CatalogRepository {
  async function products(skus: readonly string[] | null): Promise<Product[]> {
    const result = await db().query<ProductRow>(PRODUCTS_SQL, [skus]);
    return result.rows.map((row) => toProduct(row, locale));
  }

  async function browse(input: BrowseQuery) {
    const query = normalizeBrowseQuery({
      ...input,
      locale: input.locale ?? locale,
    });
    const { page, pageSize } = query;
    const sort = query.sort ?? "featured";
    const params = (limit: number, offset: number) =>
      browseParams(query, limit, offset);
    // A search orders by relevance unless the shopper chose another order.
    const relevance = !!query.search && sort === "featured";
    const result = await db().query<ProductRow & { total: string }>(
      browseSql(sort, relevance),
      params(pageSize, (page - 1) * pageSize),
    );
    let total = Number(result.rows[0]?.total ?? 0);
    // A page past the end has no rows to carry the total: count separately.
    if (!result.rows.length && page > 1) {
      const first = await db().query<{ total: string }>(
        browseSql("featured", false),
        params(1, 0),
      );
      total = Number(first.rows[0]?.total ?? 0);
    }
    return {
      items: result.rows.map((row) => toProduct(row, locale)),
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  async function facets(input: BrowseQuery): Promise<CatalogFacets> {
    const query = normalizeBrowseQuery({
      ...input,
      locale: input.locale ?? locale,
    });
    const [brands, attributes] = await Promise.all([
      db().query<BrandFacet>(BRAND_FACETS_SQL, browseParams(query, 100, 0)),
      db().query<{
        key: string;
        name: string;
        unit: string;
        value_key: string | null;
        value: string;
        count: number;
      }>(ATTRIBUTE_FACETS_SQL, browseParams(query, 2000, 0)),
    ]);
    const byKey = new Map<string, AttributeFacet>();
    for (const row of attributes.rows) {
      const facet = byKey.get(row.key) ?? {
        key: row.key,
        name: row.name,
        unit: row.unit,
        values: [],
      };
      byKey.set(row.key, facet);
      if (row.value_key !== null)
        facet.values.push({
          key: row.value_key,
          value: row.value,
          count: row.count,
        });
    }
    // Sizes and grades read best in their natural order (5, 10, 20).
    const natural = new Intl.Collator("und", { numeric: true });
    for (const facet of byKey.values())
      facet.values.sort((a, b) => natural.compare(a.key, b.key));
    return { brands: brands.rows, attributes: [...byKey.values()] };
  }

  return {
    facets,
    async countProducts() {
      const result = await db().query<{ count: number }>(COUNT_SQL, [null]);
      return result.rows[0]?.count ?? 0;
    },
    async listProductSkus(offset, limit) {
      const result = await db().query<{ sku: string; updated_at: Date }>(
        SKU_PAGE_SQL,
        [
          null,
          Math.max(0, Math.trunc(offset)),
          Math.min(Math.max(0, Math.trunc(limit)), 50_000),
        ],
      );
      return result.rows.map((row) => ({
        sku: row.sku,
        updatedAt: row.updated_at,
      }));
    },
    listProducts: () => products(null),
    async getProduct(sku) {
      return (await products([sku]))[0] ?? null;
    },
    async getProducts(skus) {
      const unique = [...new Set(skus)];
      if (unique.length > MAX_PRODUCTS_PER_LOOKUP)
        throw new Error(
          `getProducts accepts at most ${MAX_PRODUCTS_PER_LOOKUP} SKUs.`,
        );
      if (!unique.length) return [];
      const found = new Map(
        (await products(unique)).map((product) => [product.sku, product]),
      );
      return skus.flatMap((sku) => {
        const product = found.get(sku);
        return product ? [product] : [];
      });
    },
    async taxonomy() {
      const result = await db().query<{
        category_id: string;
        category: string;
        category_en: string;
        sub_id: string | null;
        sub_name: string | null;
        sub_name_en: string | null;
        products: number;
      }>(TAXONOMY_SQL, [null]);
      const taxonomy: CatalogTaxonomy = [];
      for (const row of result.rows) {
        let category = taxonomy.at(-1);
        if (category?.id !== row.category_id) {
          category = {
            id: row.category_id,
            name: locale === "en" ? row.category_en : row.category,
            productCount: 0,
            subcategories: [],
          };
          taxonomy.push(category);
        }
        category.productCount += row.products;
        if (row.sub_id)
          category.subcategories.push({
            id: row.sub_id,
            name: (locale === "en" ? row.sub_name_en : row.sub_name)!,
            productCount: row.products,
          });
      }
      return taxonomy;
    },
    browse,
  };
}
