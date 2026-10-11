import { currentCustomer, database } from "../../../../lib/accounts";
import {
  deliverySettings,
  deliverySettingsSchema,
} from "../../../../lib/store-settings";
import { json, requestJson } from "../../../../lib/order-http";
import { invoiceError } from "../../../../lib/invoice-http";
export async function GET() {
  try {
    if (!(await currentCustomer())?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    return json(await deliverySettings());
  } catch (e) {
    return invoiceError(e);
  }
}
export async function POST(request: Request) {
  try {
    const customer = await currentCustomer();
    if (!customer?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const settings = deliverySettingsSchema.parse(await requestJson(request));
    await database().query(
      "INSERT INTO store_delivery_settings(id,free_shipping_enabled,free_shipping_above_cents,updated_by) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET free_shipping_enabled=$1,free_shipping_above_cents=$2,updated_by=$3,updated_at=now()",
      [
        settings.freeShippingEnabled,
        settings.freeShippingAboveCents,
        customer.id,
      ],
    );
    return json({ saved: true, ...settings });
  } catch (e) {
    return invoiceError(e);
  }
}
