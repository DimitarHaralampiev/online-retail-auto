export const FAVORITES_STORAGE_KEY = "auto-shop:favorites:v1";
export function readGuestFavorites(
  raw: string | null,
  isKnownSku: (sku: string) => boolean,
): string[] {
  if (!raw || raw.length > 16384) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 100) return [];
    return [
      ...new Set(
        value.filter(
          (sku): sku is string => typeof sku === "string" && isKnownSku(sku),
        ),
      ),
    ];
  } catch {
    return [];
  }
}
