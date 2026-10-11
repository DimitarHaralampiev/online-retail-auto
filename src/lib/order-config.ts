export function simulatorEnabled() {
  const base = process.env.APP_URL;
  try {
    return (
      process.env.PAYMENT_PROVIDER === "simulator" &&
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base ?? "").hostname)
    );
  } catch {
    return false;
  }
}
export function orderConfig() {
  const enabled = process.env.ORDERS_MODE === "test";
  const rawThreshold = process.env.FREE_SHIPPING_ABOVE_CENTS ?? "3000";
  const threshold = /^\d+$/.test(rawThreshold) ? Number(rawThreshold) : NaN;
  if (!Number.isSafeInteger(threshold))
    throw new Error("Configure FREE_SHIPPING_ABOVE_CENTS");
  const rawShipping = process.env.TEST_SHIPPING_CENTS;
  const shipping =
    rawShipping && /^\d+$/.test(rawShipping) ? Number(rawShipping) : NaN;
  return {
    enabled,
    mode: "test" as const,
    freeShippingAboveCents: threshold,
    shippingCents:
      Number.isSafeInteger(shipping) && shipping >= 0 ? shipping : null,
    cardEnabled:
      simulatorEnabled() ||
      (process.env.PAYMENT_PROVIDER === "stripe" &&
        !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
        !!process.env.STRIPE_WEBHOOK_SECRET),
    paymentProvider: simulatorEnabled() ? "simulator" : "stripe",
  };
}
export function trackingToken(id: string) {
  const secret = process.env.ORDER_TRACKING_SECRET;
  if (!secret || secret.length < 64)
    throw new Error("Configure ORDER_TRACKING_SECRET");
  return createHmac("sha256", secret).update(`order:${id}`).digest("hex");
}
import { createHmac } from "node:crypto";
export function orderUrl(id: string) {
  const base = new URL(process.env.APP_URL ?? "");
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new Error("Configure APP_URL");
  return new URL(`/orders/${id}#token=${trackingToken(id)}`, base).toString();
}
