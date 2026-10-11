CREATE TABLE IF NOT EXISTS supplier_invoices (
 id uuid PRIMARY KEY, sha256 text NOT NULL UNIQUE, filename text NOT NULL,
 pdf bytea NOT NULL CHECK (octet_length(pdf) BETWEEN 5 AND 10485760),
 uploaded_by uuid REFERENCES customers(id), created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
 parse_status text NOT NULL DEFAULT 'idle' CHECK (parse_status IN ('idle','processing','ready','failed')),
 ai_started_at timestamptz, extracted jsonb, reviewed jsonb,
 supplier_key text, invoice_number text, posted_at timestamptz, posted_by uuid REFERENCES customers(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_identity ON supplier_invoices(supplier_key,invoice_number) WHERE status='posted';
CREATE TABLE IF NOT EXISTS warehouse_products (
 sku text PRIMARY KEY, name text NOT NULL, brand text NOT NULL, manufacturer_code text NOT NULL,
 ean text NOT NULL, on_hand integer NOT NULL DEFAULT 0 CHECK(on_hand>=0),
 reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=on_hand),
 inventory_value_cents bigint NOT NULL DEFAULT 0 CHECK(inventory_value_cents>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS warehouse_receipts (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES supplier_invoices(id),
 line_number integer NOT NULL, sku text NOT NULL REFERENCES warehouse_products(sku),
 quantity integer NOT NULL CHECK(quantity>0), acquisition_total_cents bigint NOT NULL CHECK(acquisition_total_cents>=0),
 actor_id uuid REFERENCES customers(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(invoice_id,line_number)
);
CREATE TABLE IF NOT EXISTS invoice_ai_requests (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES customers(id), invoice_id uuid REFERENCES supplier_invoices(id),
 kind text NOT NULL CHECK(kind IN ('extract','market')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_ai_requests_actor_date ON invoice_ai_requests(actor_id,created_at);
CREATE TABLE IF NOT EXISTS invoice_market_research (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES supplier_invoices(id),
 product_identity jsonb NOT NULL, result jsonb NOT NULL,
 actor_id uuid REFERENCES customers(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS pricing_assumptions jsonb;
CREATE TABLE IF NOT EXISTS store_pricing_settings (
 id integer PRIMARY KEY CHECK(id=1), settings jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES customers(id)
);
