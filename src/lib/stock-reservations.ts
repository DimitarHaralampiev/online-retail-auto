// Stock reservations for orders, kept consistent with warehouse_products and
// the stock movement ledger. Every function runs inside the caller's
// transaction (`client`), except releaseExpiredReservations, which owns its
// own transactions.
//
// Lifecycle: an order reserves its lines when it is created. Cash on delivery
// and paid card orders keep the reservation until the order is handed to the
// courier (consumed: stock leaves the warehouse) or cancelled (released).
// Unpaid card orders hold it for CARD_PAYMENT_WINDOW_MINUTES; after that a job
// releases it and cancels the order.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { OrderRecord } from "./order-model";
import { queueOrderEmail } from "./order-notifications";

export const CARD_PAYMENT_WINDOW_MINUTES = 30;

type Queryable = Pick<pg.PoolClient, "query">;
type Line = { sku: string; name: string; quantity: number };
export type Settlement = "released" | "consumed" | "expired";

/**
 * The single lock order for warehouse rows: every transaction that locks
 * several products (orders, reservations, invoice posting) sorts by this.
 */
export const compareSku = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;
const bySku = <T extends { sku: string }>(a: T, b: T) =>
  compareSku(a.sku, b.sku);

async function movement(
  client: Queryable,
  orderId: string,
  sku: string,
  kind: "reserve" | "release" | "sale",
  quantity: number,
) {
  await client.query(
    `INSERT INTO stock_movements(id,sku,kind,quantity,reference_key,order_id,note)
     VALUES($1,$2,$3,$4,$5,$6,'Order reservation')`,
    [
      randomUUID(),
      sku,
      kind,
      quantity,
      `order:${orderId}:${kind}:${sku}`,
      orderId,
    ],
  );
}

/**
 * Reserves every line or throws (the caller rolls back). The conditional
 * update makes overselling impossible under concurrency; rows are locked in
 * SKU order so concurrent orders cannot deadlock.
 */
export async function reserveStock(
  client: Queryable,
  orderId: string,
  lines: readonly Line[],
  paymentMethod: "cod" | "card",
): Promise<void> {
  const expiresAt =
    paymentMethod === "card"
      ? `now() + interval '${CARD_PAYMENT_WINDOW_MINUTES} minutes'`
      : "'infinity'::timestamptz";
  for (const line of [...lines].sort(bySku)) {
    const reserved = await client.query(
      `UPDATE warehouse_products SET reserved = reserved + $2, updated_at = now()
       WHERE sku = $1 AND status = 'published' AND on_hand - reserved >= $2
       RETURNING sku`,
      [line.sku, line.quantity],
    );
    if (!reserved.rowCount)
      throw new Error(`Недостатъчна наличност: ${line.name}.`);
    await client.query(
      `INSERT INTO stock_reservations(id,order_id,sku,quantity,status,expires_at)
       VALUES($1,$2,$3,$4,'active',${expiresAt})`,
      [randomUUID(), orderId, line.sku, line.quantity],
    );
    await movement(client, orderId, line.sku, "reserve", line.quantity);
  }
}

/**
 * Ends an order's active reservations: consumed when the goods leave the
 * warehouse, released on cancellation, expired when an unpaid card order
 * times out. A no-op for orders without reservations.
 */
export async function settleReservations(
  client: Queryable,
  orderId: string,
  outcome: Settlement,
): Promise<number> {
  const settled = await client.query<{ sku: string; quantity: number }>(
    `UPDATE stock_reservations SET status = $2
     WHERE order_id = $1 AND status = 'active'
     RETURNING sku, quantity`,
    [orderId, outcome],
  );
  for (const row of [...settled.rows].sort(bySku)) {
    const consumed = outcome === "consumed";
    await client.query(
      consumed
        ? `UPDATE warehouse_products SET on_hand = on_hand - $2,
             reserved = reserved - $2, ${REDUCE_VALUE}, updated_at = now()
           WHERE sku = $1`
        : `UPDATE warehouse_products SET reserved = reserved - $2,
             updated_at = now() WHERE sku = $1`,
      [row.sku, row.quantity],
    );
    await movement(
      client,
      orderId,
      row.sku,
      consumed ? "sale" : "release",
      row.quantity,
    );
  }
  return settled.rowCount ?? 0;
}

// Shipped goods leave the inventory value at average cost (old values in SET).
const REDUCE_VALUE = `inventory_value_cents = CASE WHEN on_hand > 0
  THEN inventory_value_cents - (inventory_value_cents * $2) / on_hand
  ELSE inventory_value_cents END`;

/**
 * Takes an order's goods out of stock on handover: consumes its reservations
 * or, for orders that have none (created before reservations, or whose
 * reservation was lost), deducts the lines directly. Throws when the stock
 * is not there, so an order can never ship without leaving the warehouse.
 */
export async function consumeOrderStock(
  client: Queryable,
  orderId: string,
  lines: readonly Line[],
): Promise<void> {
  if (await settleReservations(client, orderId, "consumed")) return;
  for (const line of [...lines].sort(bySku)) {
    const taken = await client.query(
      `UPDATE warehouse_products SET on_hand = on_hand - $2, ${REDUCE_VALUE},
         updated_at = now()
       WHERE sku = $1 AND on_hand - reserved >= $2 RETURNING sku`,
      [line.sku, line.quantity],
    );
    if (!taken.rowCount)
      throw new Error(`Недостатъчна наличност за предаване: ${line.name}.`);
    await movement(client, orderId, line.sku, "sale", line.quantity);
  }
}

/** Never lets a reservation expire before `until` (e.g. a payment session). */
export async function extendReservations(
  db: Pick<pg.Pool, "query">,
  orderId: string,
  until: Date,
): Promise<void> {
  await db.query(
    `UPDATE stock_reservations SET expires_at = greatest(expires_at, $2)
     WHERE order_id = $1 AND status = 'active'`,
    [orderId, until],
  );
}

/**
 * An unpaid card order whose payment can no longer complete: release its
 * stock, cancel it, record the change and tell the customer. Used by the
 * expiry job and the payment provider's "session expired" event.
 */
export async function expireUnpaidCardOrder(
  client: Queryable,
  order: OrderRecord,
): Promise<void> {
  await settleReservations(client, order.id, "expired");
  if (order.status === "cancelled") return;
  await client.query(
    `UPDATE orders SET status = 'cancelled', payment_status = 'failed',
       updated_at = now() WHERE id = $1`,
    [order.id],
  );
  await client.query(
    "INSERT INTO order_history(id,order_id,status) VALUES($1,$2,'cancelled')",
    [randomUUID(), order.id],
  );
  await queueOrderEmail(
    client as pg.PoolClient,
    order,
    "Срокът за картовото плащане изтече и поръчката е отказана. Запазените бройки са освободени.",
  );
}

/** A confirmed card payment keeps the reservation until shipping or cancel. */
export async function keepReservations(
  client: Queryable,
  orderId: string,
): Promise<void> {
  await client.query(
    `UPDATE stock_reservations SET expires_at = 'infinity'
     WHERE order_id = $1 AND status = 'active'`,
    [orderId],
  );
}

/**
 * Releases reservations of unpaid card orders whose payment window passed
 * and cancels those orders. Each order is handled in its own transaction;
 * returns the number of orders released.
 */
export async function releaseExpiredReservations(
  pool: Pick<pg.Pool, "connect" | "query">,
  limit = 100,
): Promise<number> {
  const due = await pool.query<{ order_id: string }>(
    `SELECT order_id FROM stock_reservations
     WHERE status = 'active' AND expires_at < now()
     GROUP BY order_id ORDER BY min(expires_at) LIMIT $1`,
    [limit],
  );
  let released = 0;
  for (const { order_id: orderId } of due.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query<OrderRecord>(
        "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
        [orderId],
      );
      // Re-check under the order lock: a payment may have arrived meanwhile.
      const stillDue = await client.query(
        `SELECT 1 FROM stock_reservations
         WHERE order_id = $1 AND status = 'active' AND expires_at < now()`,
        [orderId],
      );
      if (
        order.rows[0] &&
        order.rows[0].payment_status !== "paid" &&
        stillDue.rowCount
      ) {
        await expireUnpaidCardOrder(client, order.rows[0]);
        released += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      // One failing order must not block the others.
      console.error("Releasing expired reservation failed", orderId, error);
    } finally {
      client.release();
    }
  }
  return released;
}
