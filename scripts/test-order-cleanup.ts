// Cleanup shared by the smoke flows (test:orders, test:features): removes
// their test orders and undoes everything those orders did to stock, so the
// local database is left as it was. Stock movements, payments and refunds do
// not cascade with their order, so they go first.
import type pg from "pg";

type Db = Pick<pg.Pool, "query">;

// reserved moves by reserve - release - sale; on_hand drops by sale.
const UNDO_TEST_ORDER_STOCK = `
UPDATE warehouse_products w
SET reserved = w.reserved - m.held, on_hand = w.on_hand + m.sold
FROM (
  SELECT sku,
         sum(CASE kind WHEN 'reserve' THEN quantity
                       WHEN 'release' THEN -quantity
                       WHEN 'sale' THEN -quantity ELSE 0 END) AS held,
         sum(CASE WHEN kind = 'sale' THEN quantity ELSE 0 END) AS sold
  FROM stock_movements WHERE order_id = ANY($1::uuid[])
  GROUP BY sku
) m
WHERE w.sku = m.sku`;

// The inventory value of the SKUs the test orders moved, as it was before
// (a handover lowers it at average cost).
const RESTORE_INVENTORY_VALUE = `
UPDATE warehouse_products w SET inventory_value_cents = v.value::bigint
FROM unnest($2::text[], $3::text[]) AS v(sku, value)
WHERE w.sku = v.sku AND w.sku IN (
  SELECT sku FROM stock_movements WHERE order_id = ANY($1::uuid[]))`;

export type InventoryValues = { sku: string; value: string }[];

/** Inventory values to restore after the run (take before the first order). */
export async function inventoryValues(db: Db): Promise<InventoryValues> {
  return (
    await db.query<{ sku: string; value: string }>(
      "SELECT sku, inventory_value_cents AS value FROM warehouse_products",
    )
  ).rows;
}

export async function removeTestOrders(
  db: Db,
  ids: readonly string[],
  values?: InventoryValues,
): Promise<void> {
  if (!ids.length) return;
  await db.query(UNDO_TEST_ORDER_STOCK, [ids]);
  if (values)
    await db.query(RESTORE_INVENTORY_VALUE, [
      ids,
      values.map((row) => row.sku),
      values.map((row) => row.value),
    ]);
  for (const table of ["stock_movements", "refunds", "payments"])
    await db.query(`DELETE FROM ${table} WHERE order_id = ANY($1::uuid[])`, [
      ids,
    ]);
  // Reservations, lines, history, email outbox and payment events cascade.
  await db.query("DELETE FROM orders WHERE id = ANY($1::uuid[])", [ids]);
}
