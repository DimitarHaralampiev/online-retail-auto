// Payments ledger and refund queue (#80). Card payments are recorded in
// `payments`; money owed back to a customer is a `refunds` row (requested →
// succeeded) that admins work through at /admin/orders. Paying out happens
// outside the shop for now (Stripe dashboard or bank transfer); with live
// Stripe (#54) a requested card refund can be sent through the API.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { database } from "./accounts";

type Queryable = Pick<pg.PoolClient, "query">;

export type RefundReason = "paid_after_cancel" | "return";

export class RefundError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Records a received payment once (per provider reference); returns its id. */
export async function recordPayment(
  client: Queryable,
  payment: {
    orderId: string;
    provider: "stripe" | "simulator";
    reference: string;
    amountCents: number;
  },
): Promise<string> {
  const key = `${payment.provider}:${payment.reference}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO payments(id, order_id, provider, external_reference, idempotency_key,
       amount_cents, currency, status, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,'EUR','paid',now())
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [
      randomUUID(),
      payment.orderId,
      payment.provider,
      payment.reference,
      key,
      payment.amountCents,
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  return (
    await client.query<{ id: string }>(
      "SELECT id FROM payments WHERE idempotency_key = $1",
      [key],
    )
  ).rows[0].id;
}

/** Puts money owed to a customer in the refund queue (idempotent). */
export async function requestRefund(
  client: Queryable,
  refund: {
    orderId: string;
    amountCents: number;
    reason: RefundReason;
    paymentId?: string;
    returnRequestId?: string;
  },
): Promise<void> {
  if (refund.amountCents <= 0) return;
  await client.query(
    `INSERT INTO refunds(id, order_id, payment_id, return_request_id, amount_cents, status, reason)
     SELECT $1,$2,$3,$4,$5,'requested',$6
     WHERE NOT EXISTS (
       SELECT 1 FROM refunds WHERE status <> 'failed' AND (
         ($3::uuid IS NOT NULL AND payment_id = $3 AND reason = $6)
         OR ($4::uuid IS NOT NULL AND return_request_id = $4)))`,
    [
      randomUUID(),
      refund.orderId,
      refund.paymentId ?? null,
      refund.returnRequestId ?? null,
      refund.amountCents,
      refund.reason,
    ],
  );
}

export type OpenRefund = {
  id: string;
  orderId: string;
  amountCents: number;
  reason: RefundReason;
  paidWith: string | null;
  paymentReference: string | null;
  email: string;
  requestedAt: string;
};

/** Refunds still to pay out, oldest first. */
export async function openRefunds(limit = 100): Promise<OpenRefund[]> {
  const result = await database().query<OpenRefund>(
    `SELECT r.id, r.order_id AS "orderId", r.amount_cents AS "amountCents",
            r.reason, p.provider AS "paidWith",
            p.external_reference AS "paymentReference",
            o.contact->>'email' AS email, r.created_at AS "requestedAt"
     FROM refunds r JOIN orders o ON o.id = r.order_id
     LEFT JOIN payments p ON p.id = r.payment_id
     WHERE r.status IN ('requested','pending')
     ORDER BY r.created_at LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export const completeRefundSchema = z
  .object({
    action: z.literal("refund-done"),
    refundId: z.uuid(),
    note: z.string().trim().max(500, "Бележката е до 500 знака.").default(""),
  })
  .strict();

/** An admin confirms the money was paid back; audited. */
export async function completeRefund(
  adminId: string,
  refundId: string,
  note: string,
): Promise<void> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      status: string;
      order_id: string;
      amount_cents: number;
    }>(
      "SELECT status, order_id, amount_cents FROM refunds WHERE id = $1 FOR UPDATE",
      [refundId],
    );
    const refund = found.rows[0];
    if (!refund) throw new RefundError("Възстановяването не е намерено.", 404);
    if (refund.status !== "requested" && refund.status !== "pending")
      throw new RefundError(
        "Възстановяването вече е отбелязано. Обнови списъка.",
        409,
      );
    await client.query(
      `UPDATE refunds SET status = 'succeeded', completed_at = now(), actor_id = $2,
         note = NULLIF($3, '') WHERE id = $1`,
      [refundId, adminId, note],
    );
    await client.query(
      `INSERT INTO admin_audit_log(id, actor_id, action, entity_type, entity_id, details)
       VALUES ($1,$2,'refund.complete','refund',$3,$4)`,
      [
        randomUUID(),
        adminId,
        refundId,
        JSON.stringify({
          orderId: refund.order_id,
          amountCents: refund.amount_cents,
          note,
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
