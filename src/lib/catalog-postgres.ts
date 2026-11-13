// CatalogRepository over PostgreSQL (warehouse_products, product_categories,
// translations and promotions). Implements the current contract unchanged;
// the planned contract evolution (category ids, per-request locale, price
// field names) is recorded in docs/architecture/0001-catalog-repository.md.
import type pg from "pg";
import { buildTaxonomy, type CatalogRepository, type Product } from "./catalog";

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
};

// Storefront names are Bulgarian; the UI translates them (see the ADR).
const PRODUCTS_SQL = `
WITH live_sale AS (
  SELECT l.sku, min(l.sale_price_cents) AS sale_cents
  FROM promotion_lines l
  JOIN promotions p ON p.id = l.promotion_id
  WHERE p.status = 'active'
    AND (p.starts_at IS NULL OR p.starts_at <= now())
    AND (p.ends_at IS NULL OR p.ends_at > now())
  GROUP BY l.sku
)
SELECT w.sku,
       coalesce(t.name, w.name) AS name,
       coalesce(t.description, '') AS description,
       w.image_path,
       w.selling_price_cents AS price_cents,
       s.sale_cents,
       w.on_hand,
       w.reserved,
       c.slug AS category_slug,
       coalesce(ct.name, cte.name, c.slug) AS category_name,
       coalesce(pt.name, pte.name, parent.slug) AS parent_name
FROM warehouse_products w
JOIN product_categories c ON c.id = w.category_id AND c.active
LEFT JOIN product_categories parent ON parent.id = c.parent_id
LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'bg'
LEFT JOIN category_translations cte ON cte.category_id = c.id AND cte.locale = 'en'
LEFT JOIN category_translations pt ON pt.category_id = parent.id AND pt.locale = 'bg'
LEFT JOIN category_translations pte ON pte.category_id = parent.id AND pte.locale = 'en'
LEFT JOIN product_translations t ON t.sku = w.sku AND t.locale = 'bg'
LEFT JOIN live_sale s ON s.sku = w.sku
WHERE w.status = 'published'
  AND w.selling_price_cents IS NOT NULL
  -- Two levels only (category > subcategory); deeper rows are excluded
  -- rather than misfiled until the category tree supports more (#73).
  AND (parent.id IS NULL OR (parent.active AND parent.parent_id IS NULL))
  AND ($1::text[] IS NULL OR w.sku = ANY($1))
ORDER BY coalesce(parent.sort_order, c.sort_order),
         coalesce(parent.slug, c.slug),
         CASE WHEN parent.id IS NULL THEN -1 ELSE c.sort_order END,
         c.slug,
         w.sku`;

const CATEGORY_ORDER_SQL = `
SELECT coalesce(t.name, e.name, c.slug) AS name
FROM product_categories c
LEFT JOIN category_translations t ON t.category_id = c.id AND t.locale = 'bg'
LEFT JOIN category_translations e ON e.category_id = c.id AND e.locale = 'en'
WHERE c.parent_id IS NULL AND c.active
ORDER BY c.sort_order, c.slug`;

function toProduct(row: ProductRow): Product {
  const sub = row.parent_name !== null;
  return {
    sku: row.sku,
    name: row.name,
    category: sub ? row.parent_name! : row.category_name,
    subcategory: sub
      ? { id: row.category_slug, name: row.category_name }
      : null,
    description: row.description,
    image: row.image_path ?? FALLBACK_PRODUCT_IMAGE,
    demoPriceCents: row.price_cents,
    // A sale only counts when it is actually below the regular price.
    ...(row.sale_cents !== null && row.sale_cents < row.price_cents
      ? { demoSalePriceCents: row.sale_cents }
      : {}),
    stock: { onHand: row.on_hand, reserved: row.reserved },
  };
}

export type PostgresCatalog = CatalogRepository & {
  /** Top-level category names in display order (for building the taxonomy). */
  categoryOrder(): Promise<string[]>;
};

export function createPostgresCatalog(db: () => Queryable): PostgresCatalog {
  async function categoryOrder(): Promise<string[]> {
    const result = await db().query<{ name: string }>(CATEGORY_ORDER_SQL);
    return result.rows.map((row) => row.name);
  }
  async function products(skus: readonly string[] | null): Promise<Product[]> {
    const result = await db().query<ProductRow>(PRODUCTS_SQL, [skus]);
    return result.rows.map(toProduct);
  }
  return {
    categoryOrder,
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
      const [all, order] = await Promise.all([products(null), categoryOrder()]);
      return buildTaxonomy(all, order);
    },
  };
}
