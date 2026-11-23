// Email delivery from the outbox tables (#53). Emails are queued in the same
// transaction as the change they report (order placed, status changed,
// price alert); this module delivers them at least once:
// - a worker leases one due row at a time (SKIP LOCKED, so several workers
//   or a request and a worker never send the same row concurrently); the
//   lease expires if the process dies mid-send, and the row is retried;
// - SMTP runs outside any database transaction;
// - failures retry with exponential backoff (1 min doubling, at most 6 h);
//   after MAX_ATTEMPTS, or at once for a rejected recipient, the row is
//   parked as failed (dead letter) until an admin requeues it.
import { database } from "./accounts";
import { scrub } from "./error-reporting";
import { log, logError } from "./log";
import { mailTransport } from "./verification";

export const MAX_ATTEMPTS = 10;
const LEASE = "5 minutes";
const BASE_DELAY_SECONDS = 60;
const MAX_DELAY_SECONDS = 6 * 3600;

export type OutboxTable = "order_email_outbox" | "customer_email_outbox";

export type OutboxEmail = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  attempts: number;
};

export type SendMail = (mail: {
  from?: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
}) => Promise<unknown>;

export type OutboxSpec = {
  table: OutboxTable;
  /** Column a caller may restrict delivery to (one order or customer). */
  scope: "order_id" | "customer_id";
  /** Extra FROM items joined to `o` and conditions on them, if any. */
  join?: string;
  where?: string;
  from: () => string | undefined;
};

/** Seconds to wait before attempt `attempts + 1`. */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(
    BASE_DELAY_SECONDS * 2 ** Math.max(0, attempts - 1),
    MAX_DELAY_SECONDS,
  );
}

/** Errors no retry can fix: the server rejected the recipient address. */
export function permanentFailure(error: unknown): boolean {
  const e = error as { responseCode?: number; code?: string };
  return (
    e?.code === "EENVELOPE" || [550, 551, 553].includes(e?.responseCode ?? 0)
  );
}

function describe(error: unknown): string {
  const e = error as { code?: string; responseCode?: number; message?: string };
  const parts = [
    e?.code,
    e?.responseCode,
    e?.message ? scrub(e.message) : undefined,
  ];
  return parts.filter(Boolean).join(" ").slice(0, 500) || "unknown error";
}

async function claim(
  spec: OutboxSpec,
  scopeId: string | null,
): Promise<OutboxEmail | null> {
  const result = await database().query<OutboxEmail>(
    `UPDATE ${spec.table} AS t
       SET locked_until = now() + interval '${LEASE}', attempts = t.attempts + 1,
           last_attempt_at = now()
     WHERE t.id = (
       SELECT o.id FROM ${spec.table} o ${spec.join ?? ""}
       WHERE o.sent_at IS NULL AND o.failed_at IS NULL AND o.next_attempt_at <= now()
         AND (o.locked_until IS NULL OR o.locked_until < now())
         AND ($1::uuid IS NULL OR o.${spec.scope} = $1)
         ${spec.where ? `AND ${spec.where}` : ""}
       ORDER BY o.next_attempt_at, o.created_at
       FOR UPDATE OF o SKIP LOCKED LIMIT 1)
     RETURNING t.id, t.recipient, t.subject, t.body, t.attempts`,
    [scopeId],
  );
  return result.rows[0] ?? null;
}

/** Delivers up to `limit` due emails; returns how many were sent. */
export async function deliverOutbox(
  spec: OutboxSpec,
  limit: number,
  scopeId: string | null = null,
  send: SendMail = (mail) => mailTransport().sendMail(mail),
): Promise<number> {
  let sent = 0;
  for (let i = 0; i < limit; i++) {
    const email = await claim(spec, scopeId);
    if (!email) break;
    try {
      await send({
        from: spec.from(),
        replyTo: process.env.SMTP_SUPPORT_REPLY_TO || undefined,
        to: email.recipient,
        subject: email.subject,
        text: email.body,
        // Stable across retries, so a duplicate after a crash can be spotted.
        messageId: `<${email.id}@auto-shop.invalid>`,
      });
    } catch (error) {
      const dead = email.attempts >= MAX_ATTEMPTS || permanentFailure(error);
      await database().query(
        `UPDATE ${spec.table} SET locked_until = NULL, last_error = $2,
           failed_at = CASE WHEN $3 THEN now() END,
           next_attempt_at = CASE WHEN $3 THEN next_attempt_at
             ELSE now() + make_interval(secs => $4) END
         WHERE id = $1`,
        [email.id, describe(error), dead, retryDelaySeconds(email.attempts)],
      );
      if (dead)
        void logError("Email moved to failed (dead letter)", error, {
          table: spec.table,
          emailId: email.id,
          attempts: email.attempts,
        });
      else
        log("warn", "Email delivery failed; will retry", {
          table: spec.table,
          emailId: email.id,
          attempts: email.attempts,
          retryInSeconds: retryDelaySeconds(email.attempts),
        });
      continue;
    }
    await database().query(
      `UPDATE ${spec.table} SET sent_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1`,
      [email.id],
    );
    sent++;
  }
  return sent;
}

/** Puts failed (dead-letter) emails back in the queue with fresh attempts. */
export async function requeueFailed(spec: OutboxSpec): Promise<number> {
  const result = await database().query(
    `UPDATE ${spec.table} SET failed_at = NULL, attempts = 0, next_attempt_at = now()
     WHERE sent_at IS NULL AND failed_at IS NOT NULL`,
  );
  return result.rowCount ?? 0;
}

/** Unsent emails still being tried, and failed ones waiting for an admin. */
export async function outboxCounts(
  table: OutboxTable,
): Promise<{ pending: number; failed: number }> {
  const result = await database().query<{ pending: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE failed_at IS NULL)::int AS pending,
            count(*) FILTER (WHERE failed_at IS NOT NULL)::int AS failed
     FROM ${table} WHERE sent_at IS NULL`,
  );
  return result.rows[0];
}
