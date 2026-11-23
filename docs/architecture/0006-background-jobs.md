# ADR 0006: Background jobs and email delivery

Status: accepted (2026-11-23, #53).

## Context

Background work ran as three separate scripts, each with its own loop:
order emails, customer notifications, and releasing expired stock
reservations. Emails sat in two outbox tables written in the same
transaction as the order, status change or alert they report, which is
what makes them durable. Delivery retried every minute forever. It had no
backoff and no limit, it couldn't tell a rejected address from an outage,
it had no dead letters, and it held a transaction open during SMTP.
Production needs one supervised process with safe retries.

## Decision

### Keep the outboxes as the queue

Emails stay in `order_email_outbox` and `customer_email_outbox`.

- **Why not pg-boss:** an external queue such as pg-boss would need a
  second write next to the outbox row (or a transactional adapter), its
  own schema outside our migrations, and a second source of truth for
  "was this email sent".
- **What the outbox already has:** it is the transactional outbox pattern.
- **What was missing:** delivery semantics, which `src/lib/email-outbox.ts`
  now adds for both tables (migration 025).

**Leasing:**

- A sender claims one due row with a single
  `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`.
- The claim sets a 5-minute `locked_until` and counts the attempt.
- Concurrent workers and in-request sends never pick the same row.
- A row leased by a crashed process becomes due again when the lease ends.

**Sending:** SMTP runs outside any transaction, so no connection or lock
is held while the mail server answers.

**Delivery guarantee:**

- Delivery is **at least once**: a crash between SMTP accepting the email
  and the row being marked sent re-sends it.
- The `Message-ID` is stable across attempts, so duplicates can be spotted.

**Retries:**

- Exponential backoff: 1, 2, 4 … minutes, capped at 6 hours.
- After 10 attempts (about 15 hours of trying) the row is parked as failed
  (`failed_at`: the dead letter) with a short, scrubbed `last_error`.
- A recipient rejection (SMTP 550/551/553 or a bad envelope) fails at once.
- Authentication, throttling and connection errors keep retrying.

**Dead letters:**

- Parking an email reports it to error tracking (ADR 0005).
- `/admin/orders` shows the count, and "send again" requeues failed emails
  with fresh attempts.
- Customer preferences are re-checked on every attempt: turning off a
  notification type stops its unsent emails.

### One worker process

- `npm run worker` (`scripts/worker.ts` over `src/lib/worker.ts`) runs
  every recurring job on its own interval:

  | Job                        | Interval |
  | -------------------------- | -------- |
  | Order emails               | 15 s     |
  | Expired reservations       | 1 min    |
  | Customer notification scan | 5 min    |
  | Customer emails            | 1 min    |

- Each run holds a session advisory lock
  (`pg_try_advisory_lock('auto-shop-job', job)`). A second instance, for
  example during a deploy overlap, skips a job that is already running
  instead of doing it twice.
- SIGTERM and SIGINT let the running job finish, then the pool closes.
- `--once` runs every job once, for cron-style hosting or a quick check.
- Every run logs a JSON line (job, result, duration); failures go through
  `logError`.
- The single-purpose scripts (`orders:release-expired`,
  `orders:send-emails`, `customers:worker`) remain for manual use.

## When to revisit

- Add a general `jobs` table, or adopt pg-boss, when work appears that
  isn't an email or a periodic scan and needs its own retries: courier
  shipment creation (#55) or refunds (#80).
- Lease, backoff and dead-letter rules should then stay as defined here.
- The worker interval table is the place to add periodic jobs.
