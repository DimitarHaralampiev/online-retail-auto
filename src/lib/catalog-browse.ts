import { categories, type Product } from "./catalog";
import { availableStock } from "./inventory";
import { getPromotion, sellingPrice } from "./pricing";
export const subcategories = [
  {
    id: "organization",
    name: "Организация и багажник",
    category: categories[0],
    skus: ["DEMO-001"],
  },
  {
    id: "phone-holders",
    name: "Стойки за телефон",
    category: categories[0],
    skus: ["DEMO-002"],
  },
  {
    id: "filters",
    name: "Филтри",
    category: categories[1],
    skus: ["DEMO-003"],
  },
  {
    id: "wipers",
    name: "Чистачки",
    category: categories[1],
    skus: ["DEMO-004"],
  },
  {
    id: "washing",
    name: "Измиване и препарати",
    category: categories[2],
    skus: ["DEMO-005"],
  },
  {
    id: "microfiber",
    name: "Кърпи и микрофибър",
    category: categories[2],
    skus: ["DEMO-006"],
  },
];
export function productSubcategory(sku: string) {
  return subcategories.find((s) => s.skus.includes(sku));
}
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
      (!filters.subcategory ||
        productSubcategory(p.sku)?.id === filters.subcategory) &&
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
