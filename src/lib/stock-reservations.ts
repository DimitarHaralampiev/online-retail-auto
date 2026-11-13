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

export const CARD_PAYMENT_WINDOW_MINUTES = 30;

type Queryable = Pick<pg.PoolClient, "query">;
type Line = { sku: string; name: string; quantity: number };
export type Settlement = "released" | "consumed" | "expired";

const bySku = <T extends { sku: string }>(a: T, b: T) =>
  a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;

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
): Promise<void> {
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
             reserved = reserved - $2, updated_at = now() WHERE sku = $1`
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
    `SELECT DISTINCT order_id FROM stock_reservations
     WHERE status = 'active' AND expires_at < now() LIMIT $1`,
    [limit],
  );
  let released = 0;
  for (const { order_id: orderId } of due.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query<{ payment_status: string }>(
        "SELECT payment_status FROM orders WHERE id = $1 FOR UPDATE",
        [orderId],
      );
      // Re-check under the order lock: a payment may have arrived meanwhile.
      const stillDue = await client.query(
        `SELECT 1 FROM stock_reservations
         WHERE order_id = $1 AND status = 'active' AND expires_at < now()`,
        [orderId],
      );
      if (order.rows[0]?.payment_status !== "paid" && stillDue.rowCount) {
        await settleReservations(client, orderId, "expired");
        await client.query(
          `UPDATE orders SET status = 'cancelled',
             payment_status = CASE WHEN payment_status = 'pending' THEN 'failed'
                                   ELSE payment_status END,
             updated_at = now()
           WHERE id = $1 AND status <> 'cancelled'`,
          [orderId],
        );
        await client.query(
          "INSERT INTO order_history(id,order_id,status) VALUES($1,$2,'cancelled')",
          [randomUUID(), orderId],
        );
        released += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return released;
}
