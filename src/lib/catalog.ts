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

export interface CatalogRepository {
  /** All products that are visible in the store. */
  listProducts(): Promise<Product[]>;
  getProduct(sku: string): Promise<Product | null>;
  /** Products for the given SKUs in request order; unknown SKUs are skipped. */
  getProducts(skus: readonly string[]): Promise<Product[]>;
  taxonomy(): Promise<CatalogTaxonomy>;
}

/** Builds the category tree with product counts, keeping the given order. */
export function buildTaxonomy(
  products: readonly Product[],
  categoryOrder: readonly string[],
): CatalogTaxonomy {
  return categoryOrder
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
