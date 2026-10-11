import { demoProducts } from "./catalog";
export const FAVORITES_STORAGE_KEY = "auto-shop:favorites:v1";
export function readGuestFavorites(raw: string | null): string[] {
  if (!raw || raw.length > 16384) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 100) return [];
    return [
      ...new Set(
        value.filter(
          (sku): sku is string =>
            typeof sku === "string" && demoProducts.some((p) => p.sku === sku),
        ),
      ),
    ];
  } catch {
    return [];
  }
}
