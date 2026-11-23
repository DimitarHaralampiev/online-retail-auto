// Returns (#48). The 14-day right of withdrawal runs from delivery: an order
// marked "delivered" can have lines returned by its customer until
// RETURN_DAYS after delivered_at. Admins approve or reject a request and mark
// approved goods as received, which puts them back into stock
// (stock_movements 'return') and records the goods value to refund
// (refund_cents) and queues the refund (src/lib/refunds.ts).
//
// Customers act only on their own orders (customer_id from the session).
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { database } from "./accounts";
import { catalogSource } from "./catalog-server";
import type { OrderRecord } from "./order-model";
import { queueOrderEmail } from "./order-notifications";
import { compareSku } from "./stock-reservations";
import { requestRefund } from "./refunds";

export const RETURN_DAYS = 14;

export type ReturnStatus = "requested" | "approved" | "rejected" | "received";

export const RETURN_STATUS_LABELS: Record<ReturnStatus, [string, string]> = {
  requested: ["Заявено", "Requested"],
  approved: ["Одобрено", "Approved"],
  rejected: ["Отказано", "Rejected"],
  received: ["Получено", "Received"],
};

/** Thrown for a refused action; the message is shown to the user. */
export class ReturnError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export const returnRequestSchema = z
  .object({
    lines: z
      .array(
        z.object({
          lineNumber: z.number().int().min(1).max(500),
          quantity: z.number().int().min(1).max(1_000_000),
        }),
      )
      .min(1, "Избери поне един артикул.")
      .max(500),
    reason: z
      .string()
      .trim()
      .max(1000, "Причината е до 1000 знака.")
      .refine(
        (v) => !v.includes("\u0000"),
        "Текстът съдържа недопустими знаци.",
      )
      .default(""),
  })
  .strict();

/** Last moment a return may be requested, or null when not delivered. */
export function returnDeadline(order: {
  status: string;
  delivered_at?: Date | null;
}): Date | null {
  if (order.status !== "delivered" || !order.delivered_at) return null;
  return new Date(order.delivered_at.getTime() + RETURN_DAYS * 86_400_000);
}

type Queryable = Pick<pg.PoolClient, "query">;

/** Quantity of each order line still returnable (not in other requests). */
async function remainingQuantities(
  client: Queryable,
  order: OrderRecord,
): Promise<number[]> {
  const taken = await client.query<{ line_number: number; quantity: string }>(
    `SELECT l.line_number, sum(l.quantity) AS quantity
     FROM return_request_lines l
     JOIN return_requests r ON r.id = l.request_id
     WHERE r.order_id = $1 AND r.status <> 'rejected'
     GROUP BY l.line_number`,
    [order.id],
  );
  const used = new Map(
    taken.rows.map((row) => [row.line_number, Number(row.quantity)]),
  );
  return order.lines.map((line, i) => line.quantity - (used.get(i + 1) ?? 0));
}

async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Creates a return request for the customer's delivered order. */
export async function requestReturn(
  customerId: string,
  orderId: string,
  input: z.infer<typeof returnRequestSchema>,
  now = new Date(),
): Promise<string> {
  return transaction(async (client) => {
    const result = await client.query<OrderRecord>(
      "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
      [orderId],
    );
    const order = result.rows[0];
    // Someone else's order looks exactly like a missing one.
    if (!order || order.customer_id !== customerId)
      throw new ReturnError("Поръчката не е намерена.", 404);
    const deadline = returnDeadline(order);
    if (!deadline)
      throw new ReturnError("Връщане е възможно след доставката на поръчката.");
    if (now > deadline)
      throw new ReturnError(
        `Срокът от ${RETURN_DAYS} дни за отказ от доставката е изтекъл.`,
      );
    const open = await client.query(
      "SELECT 1 FROM return_requests WHERE order_id = $1 AND status IN ('requested','approved')",
      [orderId],
    );
    if (open.rowCount)
      throw new ReturnError(
        "Вече има заявка за връщане по тази поръчка, която се обработва.",
        409,
      );
    const remaining = await remainingQuantities(client, order);
    const seen = new Set<number>();
    for (const line of input.lines) {
      if (seen.has(line.lineNumber))
        throw new ReturnError("Всеки артикул се избира веднъж.");
      seen.add(line.lineNumber);
      const left = remaining[line.lineNumber - 1];
      if (left === undefined) throw new ReturnError("Непознат артикул.");
      if (line.quantity > left)
        throw new ReturnError(
          `Можеш да върнеш до ${left} бр. от „${order.lines[line.lineNumber - 1].name}“.`,
        );
    }
    const id = randomUUID();
    await client.query(
      "INSERT INTO return_requests(id, order_id, customer_id, reason) VALUES ($1,$2,$3,$4)",
      [id, orderId, customerId, input.reason],
    );
    for (const line of input.lines) {
      const ordered = order.lines[line.lineNumber - 1];
      await client.query(
        `INSERT INTO return_request_lines(request_id, line_number, sku, name, quantity, unit_price_cents)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          id,
          line.lineNumber,
          ordered.sku,
          ordered.name,
          line.quantity,
          ordered.unitPriceCents,
        ],
      );
    }
    await queueOrderEmail(
      client,
      order,
      "Получихме заявката ти за връщане. Ще те уведомим, когато я разгледаме.",
    );
    return id;
  });
}

export type ReturnSummary = {
  id: string;
  orderId: string;
  status: ReturnStatus;
  reason: string;
  adminNote: string;
  createdAt: string;
  totalCents: number;
  refundCents: number | null;
  lines: {
    lineNumber: number;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
  }[];
  customerEmail?: string;
};

const SUMMARY_SQL = `SELECT r.id, r.order_id AS "orderId", r.status, r.reason,
    r.admin_note AS "adminNote", r.created_at AS "createdAt",
    r.refund_cents AS "refundCents",
    o.contact->>'email' AS "customerEmail",
    coalesce(json_agg(json_build_object('lineNumber', l.line_number, 'sku', l.sku,
      'name', l.name, 'quantity', l.quantity, 'unitPriceCents', l.unit_price_cents)
      ORDER BY l.line_number) FILTER (WHERE l.request_id IS NOT NULL), '[]') AS lines
  FROM return_requests r
  JOIN orders o ON o.id = r.order_id
  LEFT JOIN return_request_lines l ON l.request_id = r.id`;

function toSummary(
  row: Omit<ReturnSummary, "totalCents" | "createdAt"> & { createdAt: Date },
): ReturnSummary {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    totalCents: row.lines.reduce(
      (sum, l) => sum + l.quantity * l.unitPriceCents,
      0,
    ),
  };
}

/** The customer's return requests for one order (newest first). */
export async function customerReturns(
  customerId: string,
  orderId: string,
): Promise<ReturnSummary[]> {
  const result = await database().query(
    `${SUMMARY_SQL} WHERE r.order_id = $1 AND r.customer_id = $2
     GROUP BY r.id, o.contact ORDER BY r.created_at DESC`,
    [orderId, customerId],
  );
  return result.rows.map((row) => {
    const { customerEmail: _email, ...rest } = toSummary(row);
    return rest;
  });
}

/** Return requests for the admin list, open ones first. */
export async function adminReturns(
  status?: ReturnStatus,
): Promise<ReturnSummary[]> {
  const result = await database().query(
    `${SUMMARY_SQL} WHERE ($1::text IS NULL OR r.status = $1)
     GROUP BY r.id, o.contact
     ORDER BY (r.status IN ('requested','approved')) DESC, r.created_at DESC
     LIMIT 200`,
    [status ?? null],
  );
  return result.rows.map(toSummary);
}

export const decisionSchema = z
  .object({
    action: z.enum(["approve", "reject", "receive"]),
    note: z
      .string()
      .trim()
      .max(1000, "Бележката е до 1000 знака.")
      .refine(
        (v) => !v.includes("\u0000"),
        "Текстът съдържа недопустими знаци.",
      )
      .default(""),
  })
  .strict();

const NEXT: Record<
  "approve" | "reject" | "receive",
  { from: ReturnStatus; to: ReturnStatus }
> = {
  approve: { from: "requested", to: "approved" },
  reject: { from: "requested", to: "rejected" },
  receive: { from: "approved", to: "received" },
};

/**
 * Moves a request forward. Receiving puts the goods back into stock (with
 * the PostgreSQL catalog, whose stock orders consume) and records the goods
 * value to refund.
 */
export async function processReturn(
  adminId: string,
  requestId: string,
  input: z.infer<typeof decisionSchema>,
): Promise<ReturnStatus> {
  return transaction(async (client) => {
    const found = await client.query<{
      status: ReturnStatus;
      order_id: string;
    }>(
      "SELECT status, order_id FROM return_requests WHERE id = $1 FOR UPDATE",
      [requestId],
    );
    const request = found.rows[0];
    if (!request) throw new ReturnError("Заявката не е намерена.", 404);
    const step = NEXT[input.action];
    if (request.status !== step.from)
      throw new ReturnError("Заявката вече е обработена. Обнови списъка.", 409);
    const order = (
      await client.query<OrderRecord>("SELECT * FROM orders WHERE id = $1", [
        request.order_id,
      ])
    ).rows[0];
    await client.query(
      `UPDATE return_requests SET status = $2,
         admin_note = CASE WHEN $3 = '' THEN admin_note ELSE $3 END,
         decided_at = CASE WHEN $2 IN ('approved','rejected') THEN now() ELSE decided_at END,
         decided_by = CASE WHEN $2 IN ('approved','rejected') THEN $4::uuid ELSE decided_by END,
         received_at = CASE WHEN $2 = 'received' THEN now() ELSE received_at END,
         received_by = CASE WHEN $2 = 'received' THEN $4::uuid ELSE received_by END
       WHERE id = $1`,
      [requestId, step.to, input.note, adminId],
    );
    if (step.to === "received") await receiveGoods(client, requestId, order);
    await client.query(
      `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
       VALUES ($1,$2,'return.update','return_request',$3,$4)`,
      [
        randomUUID(),
        adminId,
        requestId,
        JSON.stringify({ from: step.from, to: step.to }),
      ],
    );
    const note = input.note ? `\n\n${input.note}` : "";
    const message =
      step.to === "approved"
        ? `Заявката ти за връщане е одобрена. Изпрати артикулите обратно и ще те уведомим, когато ги получим.${note}`
        : step.to === "rejected"
          ? `Заявката ти за връщане не е одобрена.${note}`
          : `Получихме върнатите артикули. Ще се свържем с теб за възстановяването на сумата.${note}`;
    await queueOrderEmail(client, order, message);
    return step.to;
  });
}

async function receiveGoods(
  client: Queryable,
  requestId: string,
  order: OrderRecord,
) {
  const lines = (
    await client.query<{
      sku: string;
      quantity: number;
      unit_price_cents: number;
    }>(
      "SELECT sku, quantity, unit_price_cents FROM return_request_lines WHERE request_id = $1",
      [requestId],
    )
  ).rows;
  // Stock only moved for orders placed with the PostgreSQL catalog.
  if (catalogSource() === "postgres")
    for (const line of [...lines].sort((a, b) => compareSku(a.sku, b.sku))) {
      // Back at the current average cost (the order kept no unit cost).
      await client.query(
        `UPDATE warehouse_products SET on_hand = on_hand + $2,
           inventory_value_cents = inventory_value_cents + CASE WHEN on_hand > 0
             THEN (inventory_value_cents * $2) / on_hand ELSE 0 END,
           updated_at = now()
         WHERE sku = $1`,
        [line.sku, line.quantity],
      );
      await client.query(
        `INSERT INTO stock_movements(id, sku, kind, quantity, reference_key, order_id, note)
         VALUES ($1,$2,'return',$3,$4,$5,'Customer return')`,
        [
          randomUUID(),
          line.sku,
          line.quantity,
          `return:${requestId}:${line.sku}`,
          order.id,
        ],
      );
    }
  // The goods value to refund, queued for an admin to pay out.
  const total = lines.reduce(
    (sum, l) => sum + l.quantity * l.unit_price_cents,
    0,
  );
  await client.query(
    "UPDATE return_requests SET refund_cents = $2 WHERE id = $1",
    [requestId, total],
  );
  await requestRefund(client, {
    orderId: order.id,
    returnRequestId: requestId,
    amountCents: total,
    reason: "return",
  });
}
