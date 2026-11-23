import type { OrderRecord } from "./order-model";
import Stripe from "stripe";
import { database } from "./accounts";
import { orderUrl, simulatorEnabled } from "./order-config";
import { validPayment } from "./order-state";
import { queueOrderEmail } from "./order-notifications";
import {
  CARD_PAYMENT_WINDOW_MINUTES,
  expireUnpaidCardOrder,
  extendReservations,
  keepReservations,
} from "./stock-reservations";
import { logError } from "./log";
import { recordPayment, requestRefund } from "./refunds";
export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new Error("Configure a Stripe test key");
  return new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
}
/** The provider's payment session (exported shape for tests). */
export type PaymentSession = {
  id: string;
  url: string | null;
  expires_at: number;
  livemode: boolean;
};
type SessionCreator = (
  order: OrderRecord,
  expiresAt: number,
) => Promise<PaymentSession>;

function createStripeSession(order: OrderRecord, expiresAt: number) {
  return stripeClient().checkout.sessions.create(
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
      // Stripe's minimum lifetime; the reservation is extended past it below,
      // so a session never outlives the stock held for it.
      expires_at: expiresAt,
    },
    { idempotencyKey: `test-order-${order.id}` },
  );
}

export async function checkoutPayment(
  order: OrderRecord,
  createSession: SessionCreator = createStripeSession,
) {
  if (
    order.payment_method !== "card" ||
    order.payment_status === "paid" ||
    order.status === "cancelled"
  )
    return null;
  if (simulatorEnabled())
    return orderUrl(order.id).replace(
      `/orders/${order.id}#`,
      `/orders/${order.id}/payment#`,
    );
  if (order.payment_url) return order.payment_url;
  const session = await createSession(
    order,
    Math.floor(Date.now() / 1000) + (CARD_PAYMENT_WINDOW_MINUTES + 1) * 60,
  );
  if (!session.url || session.livemode)
    throw new Error("Invalid payment session");
  // Store the session and hold the stock past its lifetime under the order
  // lock, and only while the order can still be paid: the expiry job takes
  // the same lock before cancelling, so a session is never attached to an
  // order that is being cancelled (that session simply expires unused).
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const current = (
      await client.query<OrderRecord>(
        "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
        [order.id],
      )
    ).rows[0];
    if (
      !current ||
      current.status === "cancelled" ||
      current.payment_status === "paid"
    ) {
      await client.query("ROLLBACK");
      return null;
    }
    const stored = await client.query<{ payment_url: string }>(
      `UPDATE orders SET stripe_session_id = COALESCE(stripe_session_id, $1),
         payment_url = CASE WHEN stripe_session_id IS NULL OR stripe_session_id = $1
           THEN $2 ELSE payment_url END
       WHERE id = $3 RETURNING payment_url`,
      [session.id, session.url, order.id],
    );
    await extendReservations(
      client,
      order.id,
      new Date((session.expires_at + 5 * 60) * 1000),
    );
    await client.query("COMMIT");
    return stored.rows[0].payment_url;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
    if (expired) {
      // The session can no longer be paid: release the stock and cancel.
      if (order.payment_status !== "paid")
        await expireUnpaidCardOrder(client, order);
    } else if (order.payment_status !== "paid") {
      await client.query(
        "UPDATE orders SET payment_status='paid',stripe_session_id=$1,updated_at=now() WHERE id=$2",
        [session.id, id],
      );
      const paymentId = await recordPayment(client, {
        orderId: id,
        provider: "stripe",
        reference: session.id,
        amountCents: session.amount_total ?? order.total_cents,
      });
      if (order.status === "cancelled") {
        // Paid after the order was cancelled (its stock released): record the
        // money truthfully, keep the order cancelled and queue a refund.
        await requestRefund(client, {
          orderId: id,
          paymentId,
          amountCents: session.amount_total ?? order.total_cents,
          reason: "paid_after_cancel",
        });
        void logError(
          "Payment received for cancelled order; refund needed",
          null,
          { orderId: id },
        );
        await queueOrderEmail(
          client,
          order,
          "Получихме плащане за поръчка, която вече е отказана, защото срокът за плащане изтече. Ще възстановим сумата.",
        );
      } else {
        await keepReservations(client, id);
        await queueOrderEmail(
          client,
          order,
          "Тестовото картово плащане е потвърдено.",
        );
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
