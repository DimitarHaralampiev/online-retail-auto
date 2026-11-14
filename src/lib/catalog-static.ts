// In-memory CatalogRepository over a fixed product list (the demo catalog
// today, fixtures in tests). PostgreSQL replaces it behind the same interface.
//
// Products are given in Bulgarian (the source language). Filtering and search
// run on those originals, like the SQL adapter; results are localised through
// the UI dictionary for the requested locale.
import {
  buildTaxonomy,
  normalizeBrowseQuery,
  paginate,
  type CatalogRepository,
  type CatalogTaxonomy,
  type Product,
} from "./catalog";
import { filterProducts } from "./catalog-browse";
import type { Locale } from "./i18n/locale";
import { translate } from "./i18n/translate";

function localise(product: Product, locale: Locale): Product {
  if (locale === "bg") return product;
  const t = (text: string) => translate(text, locale);
  return {
    ...product,
    name: t(product.name),
    description: t(product.description),
    category: { ...product.category, name: t(product.category.name) },
    subcategory: product.subcategory && {
      ...product.subcategory,
      name: t(product.subcategory.name),
    },
  };
}

function localiseTaxonomy(
  taxonomy: CatalogTaxonomy,
  locale: Locale,
): CatalogTaxonomy {
  if (locale === "bg") return taxonomy;
  return taxonomy.map((category) => ({
    ...category,
    name: translate(category.name, locale),
    subcategories: category.subcategories.map((sub) => ({
      ...sub,
      name: translate(sub.name, locale),
    })),
  }));
}

export function createStaticCatalog(
  products: readonly Product[],
  categoryOrder: readonly string[],
  locale: Locale = "bg",
): CatalogRepository {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const taxonomy = localiseTaxonomy(
    buildTaxonomy(products, categoryOrder),
    locale,
  );
  const out = (product: Product) => localise(product, locale);
  return {
    async listProducts() {
      return products.map(out);
    },
    async getProduct(sku) {
      const product = bySku.get(sku);
      return product ? out(product) : null;
    },
    async getProducts(skus) {
      return skus.flatMap((sku) => {
        const product = bySku.get(sku);
        return product ? [out(product)] : [];
      });
    },
    async taxonomy() {
      return taxonomy;
    },
    async browse(input) {
      const query = normalizeBrowseQuery({ locale, ...input });
      const matches = filterProducts(products, query, (text) =>
        translate(text, query.locale ?? "bg"),
      );
      const page = paginate(matches, query);
      return { ...page, items: page.items.map(out) };
    },
  };
}
