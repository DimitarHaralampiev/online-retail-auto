// Search provider (#39, ADR 0003). The storefront asks a SearchProvider for
// autocomplete suggestions; catalog results come from
// CatalogRepository.browse({ search }). Today both run on the catalog
// repository (PostgreSQL full text and trigram search, or literal matching
// in the static demo). A dedicated engine would implement this interface
// and feed browse ranked SKUs; ADR 0003 records when and how.
import type { CatalogRepository, CatalogTaxonomy, Product } from "./catalog";
import { latinize } from "./search-text";

export const MIN_SUGGEST_CHARS = 2;
export const MAX_SUGGESTIONS = 8;

export type CategorySuggestion = {
  /** Top-level category id, and the subcategory id for subcategories. */
  category: string;
  subcategory?: string;
  name: string;
  /** Parent category name, for subcategories. */
  parent?: string;
};

export type SearchSuggestions = {
  products: Product[];
  categories: CategorySuggestion[];
};

export interface SearchProvider {
  /** Products and categories for a partial query, best first. */
  suggest(text: string, limit?: number): Promise<SearchSuggestions>;
}

/** Categories whose name contains every word of the query (any script). */
export function matchCategories(
  taxonomy: CatalogTaxonomy,
  text: string,
  limit: number,
): CategorySuggestion[] {
  const words = latinize(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = (name: string) => {
    const latin = latinize(name);
    return words.every((word) => latin.includes(word));
  };
  const found: CategorySuggestion[] = [];
  for (const category of taxonomy) {
    if (hits(category.name))
      found.push({ category: category.id, name: category.name });
    for (const sub of category.subcategories)
      if (hits(sub.name))
        found.push({
          category: category.id,
          subcategory: sub.id,
          name: sub.name,
          parent: category.name,
        });
  }
  return found.slice(0, limit);
}

/** The search provider backed by a catalog repository (one per locale). */
export function createCatalogSearch(
  catalog: CatalogRepository,
): SearchProvider {
  return {
    async suggest(text, limit = MAX_SUGGESTIONS) {
      const query = text.trim();
      if (query.length < MIN_SUGGEST_CHARS)
        return { products: [], categories: [] };
      const size = Math.min(Math.max(1, limit), MAX_SUGGESTIONS);
      const [page, taxonomy] = await Promise.all([
        catalog.browse({ search: query, pageSize: size }),
        catalog.taxonomy(),
      ]);
      return {
        products: page.items,
        categories: matchCategories(taxonomy, query, Math.min(4, size)),
      };
    },
  };
}

/** JSON of GET /api/search/suggest (header autocomplete). */
export type SuggestResponse = {
  products: {
    sku: string;
    name: string;
    category: string;
    image: string;
    priceCents: number;
    salePriceCents?: number;
    href: string;
  }[];
  categories: { name: string; parent?: string; href: string }[];
};
