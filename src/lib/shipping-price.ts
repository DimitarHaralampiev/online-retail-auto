export function shippingForSubtotal(
  subtotalCents: number,
  baseCents: number,
  freeShippingAboveCents: number | null,
) {
  if (
    !Number.isSafeInteger(subtotalCents) ||
    subtotalCents < 0 ||
    !Number.isSafeInteger(baseCents) ||
    baseCents < 0 ||
    (freeShippingAboveCents !== null &&
      (!Number.isSafeInteger(freeShippingAboveCents) ||
        freeShippingAboveCents < 0))
  )
    throw new Error("Невалидни настройки за доставка.");
  return freeShippingAboveCents !== null &&
    subtotalCents > freeShippingAboveCents
    ? 0
    : baseCents;
}
