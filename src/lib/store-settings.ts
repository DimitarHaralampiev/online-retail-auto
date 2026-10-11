import { z } from "zod";
import { database } from "./accounts";
import { orderConfig } from "./order-config";
export const deliverySettingsSchema = z
  .object({
    freeShippingEnabled: z.boolean(),
    freeShippingAboveCents: z.number().int().min(0).max(100_000_000),
  })
  .strict();
export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;
export async function deliverySettings(): Promise<DeliverySettings> {
  const base = orderConfig();
  const row = await database().query(
    'SELECT free_shipping_enabled AS "freeShippingEnabled",free_shipping_above_cents AS "freeShippingAboveCents" FROM store_delivery_settings WHERE id=1',
  );
  return (
    row.rows[0] ?? {
      freeShippingEnabled: true,
      freeShippingAboveCents: base.freeShippingAboveCents,
    }
  );
}
export async function storeOrderConfig() {
  const config = orderConfig();
  if (!process.env.DATABASE_URL)
    return {
      ...config,
      freeShippingAboveCents: config.freeShippingAboveCents as number | null,
    };
  const settings = await deliverySettings();
  return {
    ...config,
    freeShippingAboveCents: settings.freeShippingEnabled
      ? settings.freeShippingAboveCents
      : null,
  };
}
