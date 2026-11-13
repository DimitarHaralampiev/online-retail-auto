// In-memory CatalogRepository over a fixed product list (the demo catalog
// today, fixtures in tests). PostgreSQL replaces it behind the same interface.
import {
  buildTaxonomy,
  normalizeBrowseQuery,
  paginate,
  type CatalogRepository,
  type Product,
} from "./catalog";
import { filterProducts } from "./catalog-browse";
import { translate } from "./i18n/translate";

export function createStaticCatalog(
  products: readonly Product[],
  categoryOrder: readonly string[],
): CatalogRepository {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const taxonomy = buildTaxonomy(products, categoryOrder);
  return {
    async listProducts() {
      return [...products];
    },
    async getProduct(sku) {
      return bySku.get(sku) ?? null;
    },
    async getProducts(skus) {
      return skus.flatMap((sku) => {
        const product = bySku.get(sku);
        return product ? [product] : [];
      });
    },
    async taxonomy() {
      return taxonomy;
    },
    async browse(input) {
      const query = normalizeBrowseQuery(input);
      const matches = filterProducts(products, query, (text) =>
        translate(text, query.locale ?? "bg"),
      );
      return paginate(matches, query);
    },
  };
}
