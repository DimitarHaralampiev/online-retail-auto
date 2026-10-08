import { demoProducts } from "./catalog";
import { availableStock } from "./inventory";
import { sellingPrice } from "./pricing";

export type CartItem = { sku: string; quantity: number };
export const CART_STORAGE_KEY = "auto-shop:cart:v1";

export function normalizeCart(value: unknown): CartItem[] {
  if (!Array.isArray(value) || value.length > 50) return [];
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.sku !== "string" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    )
      continue;
    const product = demoProducts.find((entry) => entry.sku === item.sku);
    if (!product) continue;
    const available = availableStock(product.stock);
    const quantity = Math.min(available, item.quantity, 50);
    if (quantity > 0)
      quantities.set(
        item.sku,
        Math.min(available, 50, (quantities.get(item.sku) ?? 0) + quantity),
      );
  }
  return Array.from(quantities, ([sku, quantity]) => ({ sku, quantity }));
}

export function readStoredCart(raw: string | null): CartItem[] {
  if (!raw || raw.length > 16_384) return [];
  try {
    const stored: unknown = JSON.parse(raw);
    if (
      !stored ||
      typeof stored !== "object" ||
      !("version" in stored) ||
      stored.version !== 1 ||
      !("items" in stored)
    )
      return [];
    return normalizeCart(stored.items);
  } catch {
    return [];
  }
}

export function cartSubtotal(items: CartItem[]): number {
  return normalizeCart(items).reduce((sum, item) => {
    const product = demoProducts.find((entry) => entry.sku === item.sku)!;
    return sum + sellingPrice(product) * item.quantity;
  }, 0);
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("bg-BG", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}
