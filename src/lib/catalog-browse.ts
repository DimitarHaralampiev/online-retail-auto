import type { Product } from "./catalog";
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
export function priceFilterCents(value: string) {
  if (!value.trim()) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return undefined;
  const cents = Math.round(Number(value.replace(",", ".")) * 100);
  return Number.isSafeInteger(cents) ? cents : undefined;
}
export function browseProducts(
  products: Product[],
  filters: BrowseFilters,
  translate: (s: string) => string = (s) => s,
) {
  const min = priceFilterCents(filters.minPrice);
  const max = priceFilterCents(filters.maxPrice);
  const invalid =
    min === undefined ||
    max === undefined ||
    (min !== null && max !== null && min! > max!);
  if (invalid) return { products: [], invalidPrice: true };
  const q = filters.query.trim().toLocaleLowerCase();
  const filtered = products.filter(
    (p) =>
      (!filters.category || p.category === filters.category) &&
      (!filters.subcategory || p.subcategory?.id === filters.subcategory) &&
      (!filters.available || availableStock(p.stock) > 0) &&
      (!filters.promotions || !!getPromotion(p)) &&
      (!filters.compatibleSkus || filters.compatibleSkus.includes(p.sku)) &&
      (min === null || sellingPrice(p) >= min!) &&
      (max === null || sellingPrice(p) <= max!) &&
      `${p.name} ${translate(p.name)} ${p.sku} ${p.description} ${translate(p.description)}`
        .toLocaleLowerCase()
        .includes(q),
  );
  if (filters.sort === "price-asc")
    filtered.sort((a, b) => sellingPrice(a) - sellingPrice(b));
  if (filters.sort === "price-desc")
    filtered.sort((a, b) => sellingPrice(b) - sellingPrice(a));
  if (filters.sort === "name")
    filtered.sort((a, b) => translate(a.name).localeCompare(translate(b.name)));
  return { products: filtered, invalidPrice: false };
}
