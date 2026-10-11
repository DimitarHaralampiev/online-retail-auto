ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS orders (
 id uuid PRIMARY KEY,
 mode text NOT NULL DEFAULT 'test' CHECK (mode='test'),
 customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
 request_key uuid NOT NULL UNIQUE,
 request_hash text NOT NULL,
 access_hash text NOT NULL,
 contact jsonb NOT NULL,
 delivery jsonb NOT NULL,
 destination text NOT NULL,
 lines jsonb NOT NULL,
 subtotal_cents integer NOT NULL CHECK (subtotal_cents>0),
 shipping_cents integer NOT NULL CHECK (shipping_cents>=0),
 total_cents integer NOT NULL CHECK(total_cents=subtotal_cents+shipping_cents),
 currency text NOT NULL DEFAULT 'eur' CHECK(currency='eur'),
 payment_method text NOT NULL CHECK(payment_method IN ('cod','card')),
 payment_status text NOT NULL CHECK(payment_status IN ('pending','paid','due_on_delivery','failed')),
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','confirmed','preparing','ready','handed_to_courier','cancelled')),
 stripe_session_id text UNIQUE,
 payment_url text,
 tracking_number text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_history (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 status text NOT NULL,actor_id uuid REFERENCES customers(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_email_outbox (
 id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 recipient text NOT NULL,subject text NOT NULL,body text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,sent_at timestamptz,last_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_events (
 id text PRIMARY KEY,order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id,created_at);
CREATE INDEX IF NOT EXISTS order_history_order_idx ON order_history(order_id,created_at);
