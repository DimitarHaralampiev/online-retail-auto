CREATE TABLE IF NOT EXISTS customer_favorites (
 customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 sku text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(customer_id,sku)
);
CREATE TABLE IF NOT EXISTS customer_product_alerts (
 id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 sku text NOT NULL,kind text NOT NULL CHECK(kind IN ('stock','price')),
 last_price_cents integer NOT NULL CHECK(last_price_cents>0),active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(customer_id,sku,kind)
);
CREATE TABLE IF NOT EXISTS garage_vehicles (
 id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 nickname text NOT NULL DEFAULT '',make text NOT NULL,model text NOT NULL,
 year integer NOT NULL,engine text NOT NULL,is_selected boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS garage_selected_customer ON garage_vehicles(customer_id) WHERE is_selected;
CREATE TABLE IF NOT EXISTS customer_reminders (
 id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 vehicle_id uuid NOT NULL REFERENCES garage_vehicles(id) ON DELETE CASCADE,
 title text NOT NULL,last_service_date date,due_date date NOT NULL,
 notified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_fitments (
 sku text NOT NULL,make text NOT NULL,model text NOT NULL,engine text NOT NULL,
 year_from integer NOT NULL,year_to integer NOT NULL CHECK(year_to>=year_from),
 PRIMARY KEY(sku,make,model,engine,year_from,year_to)
);
CREATE TABLE IF NOT EXISTS customer_email_outbox (
 id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 recipient text NOT NULL,subject text NOT NULL,body text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,last_attempt_at timestamptz,sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_reminders_due ON customer_reminders(due_date) WHERE notified_at IS NULL;

ALTER TABLE customer_email_outbox ADD COLUMN IF NOT EXISTS alert_id uuid REFERENCES customer_product_alerts(id) ON DELETE CASCADE;
ALTER TABLE customer_email_outbox ADD COLUMN IF NOT EXISTS reminder_id uuid REFERENCES customer_reminders(id) ON DELETE CASCADE;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{"price":false,"stock":false,"reminders":false}'::jsonb;
