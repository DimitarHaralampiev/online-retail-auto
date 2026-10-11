import { storeOrderConfig } from "./store-settings";
import { shippingForSubtotal } from "./shipping-price";
import type { OrderRecord } from "./order-model";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database } from "./accounts";
import { checkoutSchema, previewCheckout } from "./checkout";
import { courierOffices } from "./courier-offices";
import { demoProducts } from "./catalog";
import { sellingPrice } from "./pricing";
import { trackingToken, orderUrl, simulatorEnabled } from "./order-config";
import { tokenHash } from "./password";
import { queueOrderEmail } from "./order-notifications";
import {
  type OrderStatus,
  orderStatuses,
  validateTransition,
} from "./order-state";
export const newOrderSchema = z
  .object({
    requestKey: z.uuid(),
    expectedTotalCents: z.number().int().positive(),
    acknowledgeTest: z.literal(true),
    checkout: checkoutSchema,
  })
  .strict();
export async function createOrder(value: unknown, customerId: string | null) {
  const config = await storeOrderConfig();
  if (!config.enabled || config.shippingCents === null)
    throw new Error("Тестовите поръчки още не са конфигурирани.");
  const { checkout, requestKey, expectedTotalCents } =
    newOrderSchema.parse(value);
  if (checkout.payment === "card" && !config.cardEnabled)
    throw new Error(
      "Картовото плащане още не е свързано. Избери наложен платеж за тестовата поръчка.",
    );
  const offices =
    checkout.delivery.type === "office"
      ? await courierOffices(checkout.delivery.courier)
      : [];
  const preview = previewCheckout(checkout, offices);
  const shippingCents = shippingForSubtotal(
    preview.subtotalCents,
    config.shippingCents,
    config.freeShippingAboveCents,
  );
  if (expectedTotalCents !== preview.subtotalCents + shippingCents)
    throw new Error("Сумата е променена. Направи нов преглед на поръчката.");
  const requestHash = tokenHash(JSON.stringify({ checkout, customerId }));
  const quantities = new Map<string, number>();
  for (const item of checkout.items)
    quantities.set(item.sku, (quantities.get(item.sku) ?? 0) + item.quantity);
  const lines = [...quantities].map(([sku, quantity]) => {
    const p = demoProducts.find((p) => p.sku === sku)!;
    return { sku, name: p.name, quantity, unitPriceCents: sellingPrice(p) };
  });
  const id = randomUUID();
  const token = trackingToken(id);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<OrderRecord>(
      `INSERT INTO orders (id,customer_id,request_key,request_hash,access_hash,contact,delivery,destination,lines,subtotal_cents,shipping_cents,total_cents,payment_method,payment_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(request_key) DO NOTHING RETURNING *`,
      [
        id,
        customerId,
        requestKey,
        requestHash,
        tokenHash(token),
        checkout.contact,
        checkout.delivery,
        preview.destination,
        JSON.stringify(lines),
        preview.subtotalCents,
        shippingCents,
        preview.subtotalCents + shippingCents,
        checkout.payment,
        checkout.payment === "cod" ? "due_on_delivery" : "pending",
      ],
    );
    if (!inserted.rowCount) {
      const existing = await client.query<OrderRecord>(
        "SELECT * FROM orders WHERE request_key=$1",
        [requestKey],
      );
      if (existing.rows[0].request_hash !== requestHash)
        throw new Error(
          "Тази заявка вече е използвана с други данни. Направи нов преглед.",
        );
      await client.query("COMMIT");
      return existing.rows[0];
    }
    const order = inserted.rows[0];
    await client.query(
      "INSERT INTO order_history (id,order_id,status) VALUES ($1,$2,$3)",
      [randomUUID(), id, "received"],
    );
    await queueOrderEmail(client, order, `Етап: ${orderStatuses.received}.`);
    await client.query("COMMIT");
    return order;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function changeOrderStatus(
  id: string,
  next: OrderStatus,
  expected: OrderStatus,
  actorId: string,
  trackingNumber?: string,
) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<OrderRecord>(
      "SELECT * FROM orders WHERE id=$1 FOR UPDATE",
      [id],
    );
    const order = result.rows[0];
    if (!order) throw new Error("Поръчката не е намерена.");
    if (order.status !== expected)
      throw new Error("Етапът вече е променен. Обнови списъка.");
    validateTransition(order, next, trackingNumber);
    const changed = await client.query<OrderRecord>(
      "UPDATE orders SET status=$1,tracking_number=$2,updated_at=now() WHERE id=$3 RETURNING *",
      [
        next,
        next === "handed_to_courier"
          ? trackingNumber?.trim()
          : order.tracking_number,
        id,
      ],
    );
    await client.query(
      "INSERT INTO order_history (id,order_id,status,actor_id) VALUES ($1,$2,$3,$4)",
      [randomUUID(), id, next, actorId],
    );
    await queueOrderEmail(
      client,
      changed.rows[0],
      `Нов етап: ${orderStatuses[next]}.`,
    );
    await client.query("COMMIT");
    return changed.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export function publicOrder(order: OrderRecord) {
  return {
    id: order.id,
    mode: order.mode,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    paymentUrl:
      order.payment_method === "card" && simulatorEnabled()
        ? orderUrl(order.id).replace(
            `/orders/${order.id}#`,
            `/orders/${order.id}/payment#`,
          )
        : order.payment_url,
    lines: order.lines,
    subtotalCents: order.subtotal_cents,
    shippingCents: order.shipping_cents,
    totalCents: order.total_cents,
    destination: order.destination,
    courier: order.delivery.courier,
    trackingNumber: order.tracking_number,
    createdAt: order.created_at,
  };
}
export { orderUrl };
