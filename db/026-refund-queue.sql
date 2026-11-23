-- Refund queue (#80). Money owed back to a customer is a durable row in
-- refunds: a card payment received for an order that was already cancelled
-- (linked to its payments row) or the goods value of a received return
-- (linked to the return request). Admins see open refunds and mark them done.
ALTER TABLE refunds ALTER COLUMN payment_id DROP NOT NULL;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS return_request_id uuid REFERENCES return_requests(id);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS note text;

-- Rows from before this migration (none are written by earlier code) get their
-- order from the payment.
UPDATE refunds r SET order_id = p.order_id FROM payments p
WHERE r.payment_id = p.id AND r.order_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM refunds WHERE order_id IS NULL) THEN
    RAISE EXCEPTION 'refunds without an order';
  END IF;
  ALTER TABLE refunds ALTER COLUMN order_id SET NOT NULL;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_source') THEN
    ALTER TABLE refunds ADD CONSTRAINT refunds_source
      CHECK (payment_id IS NOT NULL OR return_request_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_note_length') THEN
    ALTER TABLE refunds ADD CONSTRAINT refunds_note_length CHECK (char_length(note) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_completed') THEN
    ALTER TABLE refunds ADD CONSTRAINT refunds_completed
      CHECK ((status = 'succeeded') = (completed_at IS NOT NULL));
  END IF;
END $$;

-- One refund per reason and source (a webhook retried, a return received once).
CREATE UNIQUE INDEX IF NOT EXISTS refunds_one_per_payment ON refunds(payment_id, reason) WHERE payment_id IS NOT NULL AND status <> 'failed';
CREATE UNIQUE INDEX IF NOT EXISTS refunds_one_per_return ON refunds(return_request_id) WHERE return_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refunds_open ON refunds(created_at) WHERE status IN ('requested','pending');
CREATE INDEX IF NOT EXISTS refunds_order ON refunds(order_id);

-- Returns received before the queue existed still owe their refund.
INSERT INTO refunds(id, order_id, return_request_id, amount_cents, status, reason)
SELECT gen_random_uuid(), r.order_id, r.id, r.refund_cents, 'requested', 'return'
FROM return_requests r
WHERE r.status = 'received' AND r.refund_cents > 0
  AND NOT EXISTS (SELECT 1 FROM refunds f WHERE f.return_request_id = r.id);
