// Catalog domain types and the repository contract.
//
// Every server-side read of products and categories goes through a
// `CatalogRepository` (see catalog-server.ts), so the storage behind it can
// change from the static demo data to PostgreSQL without touching callers.
// Client components never import catalog data; they receive it from the
// server through props or the CatalogProvider context.
import type { Stock } from "./inventory";

export type ProductSubcategory = { id: string; name: string };

export type Product = {
  sku: string;
  name: string;
  /** Display name of the top-level category, also used in catalog URLs. */
  category: string;
  subcategory: ProductSubcategory | null;
  description: string;
  image: string;
  demoPriceCents: number;
  demoSalePriceCents?: number;
  stock: Stock;
};

export type CatalogSubcategory = ProductSubcategory & { productCount: number };

export type CatalogCategory = {
  name: string;
  productCount: number;
  subcategories: CatalogSubcategory[];
};

/** Categories in display order; empty categories and subcategories omitted. */
export type CatalogTaxonomy = CatalogCategory[];

export type BrowseSort = "featured" | "price-asc" | "price-desc" | "name";

/** Structured catalog query; every filter is optional. */
export type BrowseQuery = {
  /** Top-level category display name. */
  category?: string;
  /** Subcategory id. */
  subcategory?: string;
  /** Case-insensitive text matched against names, descriptions and SKU. */
  text?: string;
  /** Inclusive bounds on the price the customer pays (sale price if any). */
  minPriceCents?: number;
  maxPriceCents?: number;
  available?: boolean;
  promotions?: boolean;
  /** Restrict to these SKUs (vehicle fitment). */
  compatibleSkus?: readonly string[];
  sort?: BrowseSort;
  /** Locale for name sorting and text matching on translated names. */
  locale?: "bg" | "en";
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
};

export type BrowsePage = {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 96;

/** Clamps paging input to sane values. */
export function pageWindow(query: BrowseQuery): {
  page: number;
  pageSize: number;
} {
  const whole = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value)
      ? Math.trunc(value)
      : fallback;
  const pageSize = Math.min(
    Math.max(whole(query.pageSize, DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const page = Math.min(Math.max(whole(query.page, 1), 1), MAX_PAGE);
  return { page, pageSize };
}

export const MAX_PAGE = 1000;
export const MAX_BROWSE_TEXT = 100;
export const MAX_COMPATIBLE_SKUS = 1000;
const MAX_CENTS = 2_147_483_647; // PostgreSQL integer

const SORTS: ReadonlySet<string> = new Set<BrowseSort>([
  "featured",
  "price-asc",
  "price-desc",
  "name",
]);

/**
 * Makes any BrowseQuery safe and canonical before an adapter runs it, so
 * both adapters treat odd input identically and SQL never sees values it
 * cannot type: non-finite numbers are ignored, price bounds are rounded
 * inward and clamped to the integer range, paging is clamped, text is
 * trimmed and capped, and unknown sorts or locales fall back to defaults.
 * Callers should still validate URL input (Zod) before building a query.
 */
export function normalizeBrowseQuery(
  query: BrowseQuery,
): BrowseQuery & { page: number; pageSize: number } {
  if (query.compatibleSkus && query.compatibleSkus.length > MAX_COMPATIBLE_SKUS)
    throw new Error(
      `compatibleSkus accepts at most ${MAX_COMPATIBLE_SKUS} SKUs.`,
    );
  const bound = (value: number | undefined, round: (n: number) => number) =>
    value !== undefined && Number.isFinite(value)
      ? Math.min(Math.max(round(value), -1), MAX_CENTS)
      : undefined;
  // Control characters (e.g. NUL, which PostgreSQL rejects) are removed.
  const text = query.text
    ?.replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, MAX_BROWSE_TEXT)
    .trim();
  return {
    ...query,
    ...pageWindow(query),
    category: query.category || undefined,
    subcategory: query.subcategory || undefined,
    text: text || undefined,
    minPriceCents: bound(query.minPriceCents, Math.ceil),
    maxPriceCents: bound(query.maxPriceCents, Math.floor),
    sort: query.sort && SORTS.has(query.sort) ? query.sort : "featured",
    locale: query.locale === "en" ? "en" : "bg",
  };
}

/** Cuts one page out of an already filtered and sorted list. */
export function paginate(
  matches: readonly Product[],
  query: BrowseQuery,
): BrowsePage {
  const { page, pageSize } = pageWindow(query);
  return {
    items: matches.slice((page - 1) * pageSize, page * pageSize),
    total: matches.length,
    page,
    pageSize,
    pageCount: Math.ceil(matches.length / pageSize),
  };
}

export interface CatalogRepository {
  /** All products that are visible in the store. */
  listProducts(): Promise<Product[]>;
  getProduct(sku: string): Promise<Product | null>;
  /** Products for the given SKUs in request order; unknown SKUs are skipped. */
  getProducts(skus: readonly string[]): Promise<Product[]>;
  taxonomy(): Promise<CatalogTaxonomy>;
  /** One page of products matching the query, with the total match count. */
  browse(query: BrowseQuery): Promise<BrowsePage>;
}

/**
 * Builds the category tree with product counts in the given order. Categories
 * not listed in the order are appended, so counts always match the products.
 */
export function buildTaxonomy(
  products: readonly Product[],
  categoryOrder: readonly string[],
): CatalogTaxonomy {
  const names = [
    ...new Set([...categoryOrder, ...products.map((p) => p.category)]),
  ];
  return names
    .map((name) => {
      const inCategory = products.filter((p) => p.category === name);
      const subcategories = new Map<string, CatalogSubcategory>();
      for (const product of inCategory) {
        if (!product.subcategory) continue;
        const entry = subcategories.get(product.subcategory.id) ?? {
          ...product.subcategory,
          productCount: 0,
        };
        entry.productCount += 1;
        subcategories.set(entry.id, entry);
      }
      return {
        name,
        productCount: inCategory.length,
        subcategories: [...subcategories.values()],
      };
    })
    .filter((category) => category.productCount > 0);
}

/** Finds a product by SKU; lets pure logic work with any catalog source. */
export type ProductLookup = (sku: string) => Product | undefined;

export function productLookup(products: readonly Product[]): ProductLookup {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  return (sku) => bySku.get(sku);
}
