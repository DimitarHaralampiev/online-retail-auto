import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { database } from "./accounts";
import { orderUrl } from "./order-config";
import { mailTransport } from "./verification";
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
export async function sendOrderEmails(limit = 10, orderId?: string) {
  const client = await database().connect();
  let sent = 0;
  try {
    for (let i = 0; i < limit; i++) {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM order_email_outbox WHERE sent_at IS NULL AND ($1::uuid IS NULL OR order_id=$1) AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '1 minute') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        [orderId ?? null],
      );
      const email = result.rows[0];
      if (!email) {
        await client.query("COMMIT");
        break;
      }
      try {
        await mailTransport().sendMail({
          from: process.env.SMTP_ORDERS_FROM || process.env.SMTP_FROM,
          replyTo: process.env.SMTP_SUPPORT_REPLY_TO || undefined,
          to: email.recipient,
          subject: email.subject,
          text: email.body,
          messageId: `<${email.id}@auto-shop.invalid>`,
        });
        await client.query(
          "UPDATE order_email_outbox SET sent_at=now(),attempts=attempts+1,last_attempt_at=now() WHERE id=$1",
          [email.id],
        );
        sent++;
      } catch {
        await client.query(
          "UPDATE order_email_outbox SET attempts=attempts+1,last_attempt_at=now() WHERE id=$1",
          [email.id],
        );
      }
      await client.query("COMMIT");
    }
    return sent;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
