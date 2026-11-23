-- Returns (#48): a "delivered" order status (set by an admin until courier
-- tracking, #55, sets it) starts the 14-day withdrawal period; customers
-- request returns of delivered lines and admins approve, reject and receive
-- them. Received goods go back into stock through stock_movements ('return').
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN
  ('received','confirmed','preparing','ready','handed_to_courier','delivered','cancelled'));

CREATE TABLE IF NOT EXISTS return_requests (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','rejected','received')),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  admin_note text NOT NULL DEFAULT '' CHECK (length(admin_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES customers(id) ON DELETE SET NULL,
  received_at timestamptz,
  received_by uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- Goods value to refund, set when the goods are received; paying it out is
  -- the refund process (#80). Delivery costs follow the store's terms.
  refund_cents integer CHECK (refund_cents >= 0)
);
-- Databases that ran an earlier draft of this migration.
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS refund_cents integer
  CHECK (refund_cents >= 0);
-- One open request per order at a time.
CREATE UNIQUE INDEX IF NOT EXISTS return_requests_open
  ON return_requests(order_id) WHERE status IN ('requested','approved');
CREATE INDEX IF NOT EXISTS return_requests_status
  ON return_requests(status, created_at);

CREATE TABLE IF NOT EXISTS return_request_lines (
  request_id uuid NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  -- 1-based position in orders.lines.
  line_number integer NOT NULL CHECK (line_number > 0),
  sku text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  PRIMARY KEY (request_id, line_number)
);
