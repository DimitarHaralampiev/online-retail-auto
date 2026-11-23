import { currentCustomer, database } from "../../../../lib/accounts";
import {
  deliverySettings,
  deliverySettingsSchema,
} from "../../../../lib/store-settings";
import { json, requestJson } from "../../../../lib/order-http";
import { invoiceError } from "../../../../lib/invoice-http";
export async function GET(request: Request) {
  try {
    if (!(await currentCustomer(request))?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    return json(await deliverySettings());
  } catch (e) {
    return invoiceError(e);
  }
}
export async function POST(request: Request) {
  try {
    const customer = await currentCustomer(request);
    if (!customer?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const settings = deliverySettingsSchema.parse(await requestJson(request));
    await database().query(
      // Without a window in the request the stored one stays.
      `INSERT INTO store_delivery_settings(id,free_shipping_enabled,free_shipping_above_cents,card_payment_window_minutes,updated_by)
       VALUES(1,$1,$2,COALESCE($3,30),$4)
       ON CONFLICT(id) DO UPDATE SET free_shipping_enabled=$1,free_shipping_above_cents=$2,
         card_payment_window_minutes=COALESCE($3,store_delivery_settings.card_payment_window_minutes),
         updated_by=$4,updated_at=now()`,
      [
        settings.freeShippingEnabled,
        settings.freeShippingAboveCents,
        settings.cardPaymentWindowMinutes ?? null,
        customer.id,
      ],
    );
    return json({ saved: true, ...(await deliverySettings()) });
  } catch (e) {
    return invoiceError(e);
  }
}
