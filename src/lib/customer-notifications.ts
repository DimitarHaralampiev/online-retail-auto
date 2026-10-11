import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { database } from "./accounts";
import { demoProducts, type Product } from "./catalog";
import { availableStock } from "./inventory";
import { sellingPrice } from "./pricing";
import { formatMoney } from "./cart";
import { todayInSofia } from "./customer-rules";
import { mailTransport } from "./verification";
async function queue(
  client: PoolClient,
  customerId: string,
  email: string,
  source: { alertId?: string; reminderId?: string },
  subject: string,
  body: string,
) {
  await client.query(
    "INSERT INTO customer_email_outbox(id,customer_id,recipient,subject,body,alert_id,reminder_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      customerId,
      email,
      subject,
      body,
      source.alertId ?? null,
      source.reminderId ?? null,
    ],
  );
}
export async function scanCustomerNotifications(
  products: Product[] = demoProducts,
  today = todayInSofia(),
  customerId?: string,
) {
  const client = await database().connect();
  let queued = 0;
  try {
    await client.query("BEGIN");
    const alerts = await client.query(
      `SELECT a.*,c.email FROM customer_product_alerts a JOIN customers c ON c.id=a.customer_id WHERE ($1::uuid IS NULL OR a.customer_id=$1) AND a.active AND c.email_verified_at IS NOT NULL AND c.notification_preferences->>a.kind='true' ORDER BY a.created_at FOR UPDATE OF a SKIP LOCKED`,
      [customerId ?? null],
    );
    for (const alert of alerts.rows) {
      const product = products.find((p) => p.sku === alert.sku);
      if (!product) continue;
      const price = sellingPrice(product);
      const available = availableStock(product.stock) > 0;
      const notify =
        alert.kind === "stock" ? available : price < alert.last_price_cents;
      if (notify) {
        const link = new URL(
          `/catalog/${encodeURIComponent(product.sku)}`,
          process.env.APP_URL,
        ).toString();
        await queue(
          client,
          alert.customer_id,
          alert.email,
          { alertId: alert.id },
          alert.kind === "stock"
            ? "Отново наличен — AUTO/SHOP"
            : "Намаление на любим продукт — AUTO/SHOP",
          `Демонстрационен каталог и примерни цени.\n\n${product.name}\n${alert.kind === "stock" ? "Вече има свободни бройки в каталога." : `Цената е намалена от ${formatMoney(alert.last_price_cents)} на ${formatMoney(price)}.`}\n${link}\n\nУправлявай известията си от страницата „Любими“.`,
        );
        queued++;
      }
      await client.query(
        "UPDATE customer_product_alerts SET last_price_cents=$1,active=CASE WHEN kind='stock' AND $2 THEN false ELSE active END WHERE id=$3",
        [price, notify, alert.id],
      );
    }
    const reminders = await client.query(
      `SELECT r.*,r.due_date::text AS day,c.email,v.make,v.model,v.year FROM customer_reminders r JOIN customers c ON c.id=r.customer_id JOIN garage_vehicles v ON v.id=r.vehicle_id WHERE ($2::uuid IS NULL OR r.customer_id=$2) AND r.notified_at IS NULL AND r.due_date<=$1::date AND c.email_verified_at IS NOT NULL AND c.notification_preferences->>'reminders'='true' ORDER BY r.due_date FOR UPDATE OF r SKIP LOCKED`,
      [today, customerId ?? null],
    );
    for (const reminder of reminders.rows) {
      await queue(
        client,
        reminder.customer_id,
        reminder.email,
        { reminderId: reminder.id },
        "Напомняне за твоя автомобил — AUTO/SHOP",
        `Напомняне, което създаде: ${reminder.title}\nАвтомобил: ${reminder.make} ${reminder.model}, ${reminder.year}\nИзбрана дата: ${reminder.day}\n\nДатата е зададена от теб и не е автоматично изчислен сервизен интервал. Управлявай напомнянията от „Моят гараж“.`,
      );
      await client.query(
        "UPDATE customer_reminders SET notified_at=now() WHERE id=$1",
        [reminder.id],
      );
      queued++;
    }
    await client.query("COMMIT");
    return queued;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function sendCustomerEmails(limit = 20, customerId?: string) {
  const client = await database().connect();
  let sent = 0;
  try {
    for (let i = 0; i < limit; i++) {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT o.* FROM customer_email_outbox o JOIN customers c ON c.id=o.customer_id LEFT JOIN customer_product_alerts a ON a.id=o.alert_id WHERE ((o.reminder_id IS NOT NULL AND c.notification_preferences->>'reminders'='true') OR (o.alert_id IS NOT NULL AND c.notification_preferences->>a.kind='true')) AND o.sent_at IS NULL AND c.email_verified_at IS NOT NULL AND ($1::uuid IS NULL OR o.customer_id=$1) AND (o.last_attempt_at IS NULL OR o.last_attempt_at<now()-interval '1 minute') ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1",
        [customerId ?? null],
      );
      const email = result.rows[0];
      if (!email) {
        await client.query("COMMIT");
        break;
      }
      try {
        await mailTransport().sendMail({
          from:
            process.env.SMTP_CUSTOMER_FROM ||
            process.env.SMTP_ORDERS_FROM ||
            process.env.SMTP_FROM,
          replyTo: process.env.SMTP_SUPPORT_REPLY_TO || undefined,
          to: email.recipient,
          subject: email.subject,
          text: email.body,
          messageId: `<${email.id}@auto-shop.invalid>`,
        });
        await client.query(
          "UPDATE customer_email_outbox SET sent_at=now(),attempts=attempts+1,last_attempt_at=now() WHERE id=$1",
          [email.id],
        );
        sent++;
      } catch {
        await client.query(
          "UPDATE customer_email_outbox SET attempts=attempts+1,last_attempt_at=now() WHERE id=$1",
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
