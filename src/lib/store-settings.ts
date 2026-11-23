import { z } from "zod";
import { database } from "./accounts";
import { orderConfig } from "./order-config";
import { CARD_PAYMENT_WINDOW_MINUTES } from "./stock-reservations";
export const deliverySettingsSchema = z
  .object({
    freeShippingEnabled: z.boolean(),
    freeShippingAboveCents: z.number().int().min(0).max(100_000_000),
    // How long an unpaid card order holds its stock (Stripe: at least 30).
    cardPaymentWindowMinutes: z
      .number()
      .int()
      .min(30, "Срокът за картово плащане е между 30 и 180 минути.")
      .max(180, "Срокът за картово плащане е между 30 и 180 минути.")
      .optional(),
  })
  .strict();
export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;
export async function deliverySettings(): Promise<DeliverySettings> {
  const base = orderConfig();
  const row = await database().query(
    'SELECT free_shipping_enabled AS "freeShippingEnabled",free_shipping_above_cents AS "freeShippingAboveCents",card_payment_window_minutes AS "cardPaymentWindowMinutes" FROM store_delivery_settings WHERE id=1',
  );
  return (
    row.rows[0] ?? {
      freeShippingEnabled: true,
      freeShippingAboveCents: base.freeShippingAboveCents,
      cardPaymentWindowMinutes: CARD_PAYMENT_WINDOW_MINUTES,
    }
  );
}
export async function storeOrderConfig() {
  const config = orderConfig();
  if (!process.env.DATABASE_URL)
    return {
      ...config,
      freeShippingAboveCents: config.freeShippingAboveCents as number | null,
      cardPaymentWindowMinutes: CARD_PAYMENT_WINDOW_MINUTES,
    };
  const settings = await deliverySettings();
  return {
    ...config,
    freeShippingAboveCents: settings.freeShippingEnabled
      ? settings.freeShippingAboveCents
      : null,
    cardPaymentWindowMinutes:
      settings.cardPaymentWindowMinutes ?? CARD_PAYMENT_WINDOW_MINUTES,
  };
}
