import type { OrderRecord } from "./order-model";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { database } from "./accounts";
import { orderUrl, simulatorEnabled } from "./order-config";
import { validPayment } from "./order-state";
import { queueOrderEmail } from "./order-notifications";
export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new Error("Configure a Stripe test key");
  return new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
}
export async function checkoutPayment(order: OrderRecord) {
  if (order.payment_method !== "card" || order.payment_status === "paid")
    return null;
  if (simulatorEnabled())
    return orderUrl(order.id).replace(
      `/orders/${order.id}#`,
      `/orders/${order.id}/payment#`,
    );
  if (order.payment_url) return order.payment_url;
  const session = await stripeClient().checkout.sessions.create(
    {
      mode: "payment",
      allowed_payment_method_types: ["card"],
      client_reference_id: order.id,
      metadata: { orderId: order.id },
      customer_email: order.contact.email,
      line_items: [
        ...order.lines.map(
          (line: {
            name: string;
            quantity: number;
            unitPriceCents: number;
          }) => ({
            quantity: line.quantity,
            price_data: {
              currency: "eur",
              unit_amount: line.unitPriceCents,
              product_data: { name: line.name },
            },
          }),
        ),
        ...(order.shipping_cents
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "eur",
                  unit_amount: order.shipping_cents,
                  product_data: { name: "Тестова доставка" },
                },
              },
            ]
          : []),
      ],
      success_url: orderUrl(order.id),
      cancel_url: orderUrl(order.id),
    },
    { idempotencyKey: `test-order-${order.id}` },
  );
  if (!session.url || session.livemode)
    throw new Error("Invalid payment session");
  await database().query(
    "UPDATE orders SET stripe_session_id=COALESCE(stripe_session_id,$1),payment_url=$2 WHERE id=$3 AND (stripe_session_id IS NULL OR stripe_session_id=$1)",
    [session.id, session.url, order.id],
  );
  return session.url;
}
export async function recordPaymentEvent(event: Stripe.Event) {
  if (event.livemode) throw new Error("Live payments are disabled");
  if (
    ![
      "checkout.session.completed",
      "checkout.session.expired",
      "checkout.session.async_payment_succeeded",
    ].includes(event.type)
  )
    return;
  const session = event.data.object as Stripe.Checkout.Session;
  const id = session.metadata?.orderId;
  if (!id || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error("Invalid order reference");
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<OrderRecord>(
      "SELECT * FROM orders WHERE id=$1 FOR UPDATE",
      [id],
    );
    const order = result.rows[0];
    if (!order || order.payment_method !== "card")
      throw new Error("Unknown card order");
    const expired = event.type === "checkout.session.expired";
    if (expired) {
      if (
        session.livemode ||
        session.id !== order.stripe_session_id ||
        session.amount_total !== order.total_cents ||
        session.currency !== "eur" ||
        session.client_reference_id !== id
      )
        throw new Error("Invalid expired session");
    } else if (!validPayment(order, session))
      throw new Error("Payment amount or session mismatch");
    const recorded = await client.query(
      "INSERT INTO payment_events(id,order_id) VALUES ($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id",
      [event.id, id],
    );
    if (!recorded.rowCount) {
      await client.query("COMMIT");
      return;
    }
    if (order.payment_status !== "paid") {
      await client.query(
        "UPDATE orders SET payment_status=$1,stripe_session_id=$2,updated_at=now() WHERE id=$3",
        [expired ? "failed" : "paid", session.id, id],
      );
      await queueOrderEmail(
        client,
        order,
        expired
          ? "Срокът за картовото плащане изтече. Поръчката не е платена."
          : "Тестовото картово плащане е потвърдено.",
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
