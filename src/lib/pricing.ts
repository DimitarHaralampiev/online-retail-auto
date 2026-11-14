import type { Product } from "./catalog";

export function getPromotion(product: Product) {
  const regular = product.priceCents;
  const sale = product.salePriceCents;
  if (!Number.isSafeInteger(regular) || regular <= 0)
    throw new Error("Невалидна основна цена.");
  if (
    sale === undefined ||
    !Number.isSafeInteger(sale) ||
    sale <= 0 ||
    sale >= regular
  )
    return null;
  return {
    regularCents: regular,
    saleCents: sale,
    savingsCents: regular - sale,
    discountPercent: Math.floor(((regular - sale) / regular) * 100),
  };
}

export function sellingPrice(product: Product): number {
  return getPromotion(product)?.saleCents ?? product.priceCents;
}
