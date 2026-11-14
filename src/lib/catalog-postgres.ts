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
         w.selling_price_cents AS price_cents,
         s.sale_cents,
         CASE WHEN s.sale_cents < w.selling_price_cents
              THEN s.sale_cents ELSE w.selling_price_cents END AS pay_cents,
         w.on_hand,
         w.reserved,
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
// $7 available only, $8 promotions only, $9 locale, $10 limit, $11 offset.
const browseSql = (sort: BrowseSort) => `WITH ${VISIBLE_CTE}
SELECT *, count(*) OVER () AS total FROM visible
WHERE ($2::text IS NULL OR top_slug = $2)
  AND ($3::text IS NULL OR (parent_name IS NOT NULL AND category_slug = $3))
  AND ($4::text IS NULL
       OR position(lower($4) IN lower(name || ' ' || sku || ' ' || description)) > 0
       OR ($9::text = 'en'
           AND position(lower($4) IN lower(name_en || ' ' || description_en)) > 0))
  AND ($5::int IS NULL OR pay_cents >= $5)
  AND ($6::int IS NULL OR pay_cents <= $6)
  AND (NOT $7::boolean OR on_hand - reserved > 0)
  AND (NOT $8::boolean OR sale_cents < price_cents)
ORDER BY ${BROWSE_ORDER[sort]}
LIMIT $10 OFFSET $11`;

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
    image: row.image_path ?? FALLBACK_PRODUCT_IMAGE,
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
export function createPostgresCatalog(
  db: () => Queryable,
  locale: Locale = "bg",
): CatalogRepository {
  async function products(skus: readonly string[] | null): Promise<Product[]> {
    const result = await db().query<ProductRow>(PRODUCTS_SQL, [skus]);
    return result.rows.map((row) => toProduct(row, locale));
  }

  async function browse(input: BrowseQuery) {
    const query = normalizeBrowseQuery({ locale, ...input });
    const { page, pageSize } = query;
    const sort = query.sort ?? "featured";
    const params = (limit: number, offset: number) => [
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
    ];
    const result = await db().query<ProductRow & { total: string }>(
      browseSql(sort),
      params(pageSize, (page - 1) * pageSize),
    );
    let total = Number(result.rows[0]?.total ?? 0);
    // A page past the end has no rows to carry the total: count separately.
    if (!result.rows.length && page > 1) {
      const first = await db().query<{ total: string }>(
        browseSql("featured"),
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

  return {
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
