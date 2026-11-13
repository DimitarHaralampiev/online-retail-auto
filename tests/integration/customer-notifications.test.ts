import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { scanCustomerNotifications } from "../../src/lib/customer-notifications";
import { insertCustomer, setupTestDatabase } from "./database";

process.env.APP_URL = "http://localhost:3000";
const db = setupTestDatabase();

// Demo catalog: DEMO-001 is in stock; DEMO-003 sells for 18.90 EUR.
async function alert(customer: string, sku: string, kind: string, cents = 1) {
  await db().pool.query(
    "INSERT INTO customer_product_alerts(id,customer_id,sku,kind,last_price_cents) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), customer, sku, kind, cents],
  );
}

test("scanning without a product override reads alerted products from the catalog", async () => {
  const customer = await insertCustomer(db().pool);
  await db().pool.query(
    `UPDATE customers SET notification_preferences='{"stock":true,"price":true,"reminders":false}' WHERE id=$1`,
    [customer],
  );
  await alert(customer, "DEMO-001", "stock");
  await alert(customer, "DEMO-003", "price", 9999);
  await alert(customer, "NOT-IN-CATALOG", "stock");

  const queued = await scanCustomerNotifications(
    undefined,
    "2026-11-13",
    customer,
  );

  assert.equal(queued, 2);
  const emails = await db().pool.query<{ subject: string; body: string }>(
    "SELECT subject,body FROM customer_email_outbox WHERE customer_id=$1 ORDER BY subject",
    [customer],
  );
  assert.deepEqual(
    emails.rows.map((row) => row.subject),
    ["Намаление на любим продукт — AUTO/SHOP", "Отново наличен — AUTO/SHOP"],
  );
  assert.match(emails.rows[0].body, /от 99,99\s€ на 18,90\s€/);
  const alerts = await db().pool.query<{ sku: string; active: boolean }>(
    "SELECT sku,active FROM customer_product_alerts WHERE customer_id=$1 ORDER BY sku",
    [customer],
  );
  // The fulfilled stock alert is closed; unknown SKUs are left untouched.
  assert.deepEqual(alerts.rows, [
    { sku: "DEMO-001", active: false },
    { sku: "DEMO-003", active: true },
    { sku: "NOT-IN-CATALOG", active: true },
  ]);
});
