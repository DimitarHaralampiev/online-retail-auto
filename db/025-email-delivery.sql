-- Email delivery with retries and dead letters (#53). Both outboxes stay the
-- transactional record of what to send; delivery now leases a row, retries
-- with exponential backoff and parks it as failed after the last attempt.
ALTER TABLE order_email_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE order_email_outbox ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE order_email_outbox ADD COLUMN IF NOT EXISTS failed_at timestamptz;
ALTER TABLE order_email_outbox ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE customer_email_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE customer_email_outbox ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE customer_email_outbox ADD COLUMN IF NOT EXISTS failed_at timestamptz;
ALTER TABLE customer_email_outbox ADD COLUMN IF NOT EXISTS last_error text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_email_outbox_last_error_length') THEN
    ALTER TABLE order_email_outbox ADD CONSTRAINT order_email_outbox_last_error_length CHECK (char_length(last_error) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_email_outbox_last_error_length') THEN
    ALTER TABLE customer_email_outbox ADD CONSTRAINT customer_email_outbox_last_error_length CHECK (char_length(last_error) <= 500);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_email_outbox_due ON order_email_outbox(next_attempt_at) WHERE sent_at IS NULL AND failed_at IS NULL;
CREATE INDEX IF NOT EXISTS customer_email_outbox_due ON customer_email_outbox(next_attempt_at) WHERE sent_at IS NULL AND failed_at IS NULL;
