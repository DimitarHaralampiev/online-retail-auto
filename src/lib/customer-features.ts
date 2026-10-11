import {
  defaultPreferences,
  notificationPreferencesSchema,
} from "./customer-preferences";
import {
  customerActionSchema,
  fitmentMatches,
  type CustomerFeatures,
} from "./customer-rules";
import { randomUUID } from "node:crypto";
import { database } from "./accounts";
import { demoProducts, type Product } from "./catalog";
import { availableStock } from "./inventory";
import { sellingPrice } from "./pricing";
export async function getCustomerFeatures(
  customerId: string,
): Promise<CustomerFeatures> {
  const db = database();
  const [favorites, alerts, vehicles, reminders, settings] = await Promise.all([
    db.query(
      "SELECT sku FROM customer_favorites WHERE customer_id=$1 ORDER BY created_at",
      [customerId],
    ),
    db.query(
      "SELECT sku,kind,active FROM customer_product_alerts WHERE customer_id=$1",
      [customerId],
    ),
    db.query(
      "SELECT id,nickname,make,model,year,engine,is_selected AS selected FROM garage_vehicles WHERE customer_id=$1 ORDER BY created_at",
      [customerId],
    ),
    db.query(
      'SELECT id,vehicle_id AS "vehicleId",title,due_date::text AS "dueDate",last_service_date::text AS "lastServiceDate",notified_at AS "notifiedAt" FROM customer_reminders WHERE customer_id=$1 ORDER BY due_date',
      [customerId],
    ),
    db.query("SELECT notification_preferences FROM customers WHERE id=$1", [
      customerId,
    ]),
  ]);
  const selected = vehicles.rows.find((v) => v.selected);
  let compatibleSkus: string[] = [];
  if (selected) {
    const fitments = await db.query("SELECT * FROM product_fitments");
    compatibleSkus = [
      ...new Set(
        fitments.rows
          .filter((f) => fitmentMatches(selected, f))
          .map((f) => f.sku),
      ),
    ];
  }
  return {
    preferences:
      notificationPreferencesSchema.safeParse(
        settings.rows[0]?.notification_preferences,
      ).data ?? defaultPreferences(),
    favorites: favorites.rows.map((r) => r.sku),
    alerts: alerts.rows,
    vehicles: vehicles.rows,
    reminders: reminders.rows,
    compatibleSkus,
  };
}
export async function mutateCustomerFeatures(
  customerId: string,
  value: unknown,
) {
  const action = customerActionSchema.parse(value);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query(
      "SELECT id,notification_preferences FROM customers WHERE id=$1 FOR NO KEY UPDATE",
      [customerId],
    );
    if (action.action === "preferences") {
      const prefs = action.preferences;
      await client.query(
        "UPDATE customers SET notification_preferences=$1 WHERE id=$2",
        [prefs, customerId],
      );
      await client.query(
        "DELETE FROM customer_email_outbox o USING customer_product_alerts a WHERE o.alert_id=a.id AND o.customer_id=$1 AND o.sent_at IS NULL AND (($2=false AND a.kind='price') OR ($3=false AND a.kind='stock'))",
        [customerId, prefs.price, prefs.stock],
      );
      if (!prefs.reminders) {
        const removed = await client.query(
          "DELETE FROM customer_email_outbox WHERE customer_id=$1 AND reminder_id IS NOT NULL AND sent_at IS NULL RETURNING reminder_id",
          [customerId],
        );
        for (const row of removed.rows)
          await client.query(
            "UPDATE customer_reminders SET notified_at=NULL WHERE id=$1 AND customer_id=$2",
            [row.reminder_id, customerId],
          );
      }
      if (prefs.price && !customer.rows[0].notification_preferences?.price)
        for (const product of demoProducts)
          await client.query(
            "UPDATE customer_product_alerts SET last_price_cents=$1 WHERE customer_id=$2 AND sku=$3 AND kind='price'",
            [sellingPrice(product), customerId, product.sku],
          );
    } else if (action.action === "favorite") {
      if (action.enabled)
        await client.query(
          "INSERT INTO customer_favorites(customer_id,sku) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [customerId, action.sku],
        );
      else {
        await client.query(
          "DELETE FROM customer_favorites WHERE customer_id=$1 AND sku=$2",
          [customerId, action.sku],
        );
        await client.query(
          "DELETE FROM customer_product_alerts WHERE customer_id=$1 AND sku=$2 AND kind='price'",
          [customerId, action.sku],
        );
      }
    } else if (action.action === "import-favorites") {
      for (const id of new Set(action.skus))
        await client.query(
          "INSERT INTO customer_favorites(customer_id,sku) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [customerId, id],
        );
    } else if (action.action === "alert") {
      const product = demoProducts.find((p) => p.sku === action.sku)!;
      if (
        action.enabled &&
        !customer.rows[0].notification_preferences?.[action.kind]
      )
        throw new Error("Първо разреши този вид имейли в „Моите услуги“.");
      if (
        action.enabled &&
        action.kind === "stock" &&
        availableStock(product.stock) > 0
      )
        throw new Error(
          "Продуктът вече е наличен. Можеш да го добавиш в количката.",
        );
      if (!action.enabled)
        await client.query(
          "DELETE FROM customer_product_alerts WHERE customer_id=$1 AND sku=$2 AND kind=$3",
          [customerId, action.sku, action.kind],
        );
      else
        await client.query(
          "INSERT INTO customer_product_alerts(id,customer_id,sku,kind,last_price_cents) VALUES($1,$2,$3,$4,$5) ON CONFLICT(customer_id,sku,kind) DO UPDATE SET active=true,last_price_cents=$5",
          [
            randomUUID(),
            customerId,
            action.sku,
            action.kind,
            sellingPrice(product),
          ],
        );
    } else if (action.action === "add-vehicle") {
      const count = await client.query(
        "SELECT count(*)::int AS count FROM garage_vehicles WHERE customer_id=$1",
        [customerId],
      );
      if (count.rows[0].count >= 10)
        throw new Error("Можеш да запазиш до 10 автомобила.");
      const v = action.vehicle;
      await client.query(
        "INSERT INTO garage_vehicles(id,customer_id,nickname,make,model,year,engine,is_selected) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          customerId,
          v.nickname,
          v.make,
          v.model,
          v.year,
          v.engine,
          count.rows[0].count === 0,
        ],
      );
    } else if (action.action === "select-vehicle") {
      const owned = await client.query(
        "SELECT id FROM garage_vehicles WHERE id=$1 AND customer_id=$2",
        [action.id, customerId],
      );
      if (!owned.rowCount) throw new Error("Автомобилът не е намерен.");
      await client.query(
        "UPDATE garage_vehicles SET is_selected=false WHERE customer_id=$1",
        [customerId],
      );
      await client.query(
        "UPDATE garage_vehicles SET is_selected=true WHERE id=$1 AND customer_id=$2",
        [action.id, customerId],
      );
    } else if (action.action === "delete-vehicle") {
      const removed = await client.query(
        "DELETE FROM garage_vehicles WHERE id=$1 AND customer_id=$2 RETURNING id",
        [action.id, customerId],
      );
      if (!removed.rowCount) throw new Error("Автомобилът не е намерен.");
    } else if (action.action === "add-reminder") {
      const r = action.reminder;
      const vehicle = await client.query(
        "SELECT id FROM garage_vehicles WHERE id=$1 AND customer_id=$2",
        [r.vehicleId, customerId],
      );
      if (!vehicle.rowCount) throw new Error("Избери свой автомобил.");
      const count = await client.query(
        "SELECT count(*)::int AS count FROM customer_reminders WHERE customer_id=$1",
        [customerId],
      );
      if (count.rows[0].count >= 50)
        throw new Error("Можеш да запазиш до 50 напомняния.");
      await client.query(
        "INSERT INTO customer_reminders(id,customer_id,vehicle_id,title,last_service_date,due_date) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          customerId,
          r.vehicleId,
          r.title,
          r.lastServiceDate,
          r.dueDate,
        ],
      );
    } else if (action.action === "delete-reminder") {
      const removed = await client.query(
        "DELETE FROM customer_reminders WHERE id=$1 AND customer_id=$2",
        [action.id, customerId],
      );
      if (!removed.rowCount) throw new Error("Напомнянето не е намерено.");
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getCustomerFeatures(customerId);
}
