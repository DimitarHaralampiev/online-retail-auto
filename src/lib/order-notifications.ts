import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { orderUrl } from "./order-config";
import { deliverOutbox, type OutboxSpec, type SendMail } from "./email-outbox";
export async function queueOrderEmail(
  client: PoolClient,
  order: {
    id: string;
    contact: { email: string };
    tracking_number?: string | null;
  },
  message: string,
) {
  await client.query(
    "INSERT INTO order_email_outbox (id,order_id,recipient,subject,body) VALUES ($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      order.id,
      order.contact.email,
      `Тестова поръчка ${order.id.slice(0, 8)} — AUTO/SHOP`,
      `Това е тестова поръчка. Не се извършва реална доставка или таксуване.\n\n${message}${order.tracking_number ? "\nТоварителница: " + order.tracking_number : ""}\n\nПроследяване: ${orderUrl(order.id)}`,
    ],
  );
}
// SMTP is retried independently of the durable order/status transaction.
export const orderOutbox: OutboxSpec = {
  table: "order_email_outbox",
  scope: "order_id",
  from: () => process.env.SMTP_ORDERS_FROM || process.env.SMTP_FROM,
};

/** Delivers due order emails (see email-outbox.ts for retries). */
export async function sendOrderEmails(
  limit = 10,
  orderId?: string,
  send?: SendMail,
) {
  return deliverOutbox(orderOutbox, limit, orderId ?? null, send);
}
