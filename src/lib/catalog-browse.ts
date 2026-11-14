import type { BrowseQuery, BrowseSort, Product } from "./catalog";
import { availableStock } from "./inventory";
import { getPromotion, sellingPrice } from "./pricing";
export type BrowseFilters = {
  category: string;
  subcategory: string;
  query: string;
  minPrice: string;
  maxPrice: string;
  available: boolean;
  promotions: boolean;
  compatibleSkus?: string[];
  sort: string;
};
// ICU root collation, identical to PostgreSQL's "und-x-icu" used by the
// SQL adapter, so name order does not depend on server locale settings.
const nameCollator = new Intl.Collator("und");

export function priceFilterCents(value: string) {
  if (!value.trim()) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return undefined;
  const cents = Math.round(Number(value.replace(",", ".")) * 100);
  return Number.isSafeInteger(cents) ? cents : undefined;
}
/**
 * Filters and sorts products for a structured query. Shared by the static
 * catalog adapter and the client-side catalog so both behave the same.
 */
export function filterProducts(
  products: readonly Product[],
  query: BrowseQuery,
  translate: (s: string) => string = (s) => s,
): Product[] {
  const q = (query.text ?? "").trim().toLocaleLowerCase();
  const compatible = query.compatibleSkus
    ? new Set(query.compatibleSkus)
    : null;
  const filtered = products.filter(
    (p) =>
      (!query.category || p.category.id === query.category) &&
      (!query.subcategory || p.subcategory?.id === query.subcategory) &&
      (!query.available || availableStock(p.stock) > 0) &&
      (!query.promotions || !!getPromotion(p)) &&
      (!compatible || compatible.has(p.sku)) &&
      (query.minPriceCents === undefined ||
        sellingPrice(p) >= query.minPriceCents) &&
      (query.maxPriceCents === undefined ||
        sellingPrice(p) <= query.maxPriceCents) &&
      (!q ||
        `${p.name} ${translate(p.name)} ${p.sku} ${p.description} ${translate(p.description)}`
          .toLocaleLowerCase()
          .includes(q)),
  );
  if (query.sort === "price-asc")
    filtered.sort((a, b) => sellingPrice(a) - sellingPrice(b));
  if (query.sort === "price-desc")
    filtered.sort((a, b) => sellingPrice(b) - sellingPrice(a));
  if (query.sort === "name")
    filtered.sort((a, b) =>
      nameCollator.compare(translate(a.name), translate(b.name)),
    );
  return filtered;
}

export function browseProducts(
  products: Product[],
  filters: BrowseFilters,
  translate: (s: string) => string = (s) => s,
) {
  const min = priceFilterCents(filters.minPrice);
  const max = priceFilterCents(filters.maxPrice);
  if (
    min === undefined ||
    max === undefined ||
    (min !== null && max !== null && min > max)
  )
    return { products: [], invalidPrice: true };
  return {
    products: filterProducts(
      products,
      {
        category: filters.category,
        subcategory: filters.subcategory,
        text: filters.query,
        minPriceCents: min ?? undefined,
        maxPriceCents: max ?? undefined,
        available: filters.available,
        promotions: filters.promotions,
        compatibleSkus: filters.compatibleSkus,
        sort: filters.sort as BrowseSort,
      },
      translate,
    ),
    invalidPrice: false,
  };
}
