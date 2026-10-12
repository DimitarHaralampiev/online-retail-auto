-- Additive schema: keep existing customers, orders, invoices and stock intact.
CREATE TABLE IF NOT EXISTS supported_locales (
 code text PRIMARY KEY CHECK(code IN ('bg','en')), name text NOT NULL
);
INSERT INTO supported_locales(code,name) VALUES('bg','Български'),('en','English') ON CONFLICT DO NOTHING;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_locale text NOT NULL DEFAULT 'bg' REFERENCES supported_locales(code);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'bg' REFERENCES supported_locales(code);
CREATE TABLE IF NOT EXISTS suppliers (
 id uuid PRIMARY KEY, business_name text NOT NULL, tax_id text NOT NULL UNIQUE,
 contact_email text, contact_phone text, address jsonb NOT NULL DEFAULT '{}',
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency IN ('EUR','BGN')),
 payment_terms_days integer CHECK(payment_terms_days>=0), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_categories (
 id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, parent_id uuid REFERENCES product_categories(id),
 sort_order integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, CHECK(parent_id<>id)
);
CREATE TABLE IF NOT EXISTS category_translations (
 category_id uuid NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
 locale text NOT NULL REFERENCES supported_locales(code), name text NOT NULL,
 description text NOT NULL DEFAULT '', PRIMARY KEY(category_id,locale)
);
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES product_categories(id);
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived'));
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS selling_price_cents integer CHECK(selling_price_cents>0);
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS vat_bps integer NOT NULL DEFAULT 2000 CHECK(vat_bps BETWEEN 0 AND 10000);
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS weight_grams integer CHECK(weight_grams>0);
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS dimensions_mm jsonb;
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS min_stock integer NOT NULL DEFAULT 0 CHECK(min_stock>=0);
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS target_stock integer NOT NULL DEFAULT 0 CHECK(target_stock>=min_stock);
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS lead_time_days integer NOT NULL DEFAULT 7 CHECK(lead_time_days BETWEEN 0 AND 365);
CREATE TABLE IF NOT EXISTS product_translations (
 sku text NOT NULL REFERENCES warehouse_products(sku) ON DELETE CASCADE,
 locale text NOT NULL REFERENCES supported_locales(code), name text NOT NULL,
 description text NOT NULL DEFAULT '', specifications jsonb NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(sku,locale)
);
CREATE TABLE IF NOT EXISTS product_images (
 id uuid PRIMARY KEY, sku text NOT NULL REFERENCES warehouse_products(sku) ON DELETE CASCADE,
 storage_key text NOT NULL, alt_text jsonb NOT NULL DEFAULT '{}', sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS supplier_products (
 supplier_id uuid NOT NULL REFERENCES suppliers(id), sku text NOT NULL REFERENCES warehouse_products(sku),
 supplier_code text NOT NULL DEFAULT '', last_unit_net_cents integer CHECK(last_unit_net_cents>=0),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency IN ('EUR','BGN')),
 minimum_order_quantity integer NOT NULL DEFAULT 1 CHECK(minimum_order_quantity>0),
 lead_time_days integer CHECK(lead_time_days>=0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(supplier_id,sku)
);
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
CREATE TABLE IF NOT EXISTS invoice_lines (
 invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
 line_number integer NOT NULL CHECK(line_number>0), sku text NOT NULL REFERENCES warehouse_products(sku),
 description text NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
 unit_net_cents integer NOT NULL CHECK(unit_net_cents>=0), vat_bps integer NOT NULL CHECK(vat_bps BETWEEN 0 AND 10000),
 acquisition_total_cents bigint NOT NULL CHECK(acquisition_total_cents>=0), PRIMARY KEY(invoice_id,line_number)
);
CREATE TABLE IF NOT EXISTS stock_movements (
 id uuid PRIMARY KEY, sku text NOT NULL REFERENCES warehouse_products(sku),
 kind text NOT NULL CHECK(kind IN ('receipt','reserve','release','sale','return','adjustment')),
 quantity integer NOT NULL CHECK(quantity<>0 AND (kind='adjustment' OR quantity>0)),
 reference_key text NOT NULL UNIQUE, invoice_id uuid REFERENCES supplier_invoices(id),
 order_id uuid REFERENCES orders(id), actor_id uuid REFERENCES customers(id),
 unit_cost_cents integer CHECK(unit_cost_cents>=0), note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_sku_date ON stock_movements(sku,created_at);
CREATE TABLE IF NOT EXISTS stock_reservations (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 sku text NOT NULL REFERENCES warehouse_products(sku), quantity integer NOT NULL CHECK(quantity>0),
 status text NOT NULL CHECK(status IN ('active','consumed','released','expired')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(order_id,sku)
);
CREATE INDEX IF NOT EXISTS stock_reservations_expiry ON stock_reservations(expires_at) WHERE status='active';
CREATE TABLE IF NOT EXISTS purchase_orders (
 id uuid PRIMARY KEY, supplier_id uuid NOT NULL REFERENCES suppliers(id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','sent','part_received','received','cancelled')),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency IN ('EUR','BGN')), expected_date date,
 note text NOT NULL DEFAULT '', created_by uuid REFERENCES customers(id), approved_by uuid REFERENCES customers(id),
 created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz
);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
 purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
 sku text NOT NULL REFERENCES warehouse_products(sku), quantity integer NOT NULL CHECK(quantity>0),
 received_quantity integer NOT NULL DEFAULT 0 CHECK(received_quantity BETWEEN 0 AND quantity),
 unit_net_cents integer CHECK(unit_net_cents>=0), PRIMARY KEY(purchase_order_id,sku)
);
CREATE TABLE IF NOT EXISTS order_lines (
 order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE, line_number integer NOT NULL CHECK(line_number>0),
 sku text NOT NULL, name text NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
 unit_price_cents integer NOT NULL CHECK(unit_price_cents>0), unit_cost_cents integer CHECK(unit_cost_cents>=0),
 vat_bps integer NOT NULL DEFAULT 2000 CHECK(vat_bps BETWEEN 0 AND 10000),
 PRIMARY KEY(order_id,line_number)
);
-- Preserve legacy/demo SKUs without inventing warehouse product records.
INSERT INTO order_lines(order_id,line_number,sku,name,quantity,unit_price_cents)
SELECT o.id,l.ordinality::integer,l.value->>'sku',l.value->>'name',
 (l.value->>'quantity')::integer,(l.value->>'unitPriceCents')::integer
FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.lines) WITH ORDINALITY AS l(value,ordinality)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS payments (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id),
 provider text NOT NULL CHECK(provider IN ('stripe','simulator','cod','bank_transfer')),
 external_reference text, idempotency_key text NOT NULL UNIQUE,
 amount_cents integer NOT NULL CHECK(amount_cents>0), currency text NOT NULL CHECK(currency='EUR'),
 status text NOT NULL CHECK(status IN ('pending','paid','failed','refunded','part_refunded','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz, UNIQUE(provider,external_reference)
);
CREATE TABLE IF NOT EXISTS refunds (
 id uuid PRIMARY KEY, payment_id uuid NOT NULL REFERENCES payments(id),
 external_reference text UNIQUE, amount_cents integer NOT NULL CHECK(amount_cents>0),
 status text NOT NULL CHECK(status IN ('requested','pending','succeeded','failed')),
 reason text NOT NULL, actor_id uuid REFERENCES customers(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shipments (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), courier text NOT NULL CHECK(courier IN ('speedy','econt')),
 delivery_type text NOT NULL CHECK(delivery_type IN ('office','address')), office_id text,
 destination jsonb NOT NULL, external_reference text, tracking_number text,
 customer_shipping_cents integer NOT NULL CHECK(customer_shipping_cents>=0),
 merchant_shipping_cents integer CHECK(merchant_shipping_cents>=0), quote jsonb,
 status text NOT NULL CHECK(status IN ('draft','quoted','label_created','handed_over','delivered','returned','cancelled')),
 idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(courier,external_reference)
);
CREATE TABLE IF NOT EXISTS shipment_events (
 id uuid PRIMARY KEY, shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
 external_event_id text NOT NULL, status text NOT NULL, occurred_at timestamptz NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}', UNIQUE(shipment_id,external_event_id)
);
CREATE TABLE IF NOT EXISTS promotions (
 id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','active','ended','cancelled')),
 starts_at timestamptz, ends_at timestamptz, created_by uuid REFERENCES customers(id), approved_by uuid REFERENCES customers(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS promotion_lines (
 promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
 sku text NOT NULL REFERENCES warehouse_products(sku), regular_price_cents integer NOT NULL CHECK(regular_price_cents>0),
 sale_price_cents integer NOT NULL CHECK(sale_price_cents>0 AND sale_price_cents<regular_price_cents),
 minimum_margin_bps integer NOT NULL DEFAULT 0 CHECK(minimum_margin_bps BETWEEN 0 AND 10000), PRIMARY KEY(promotion_id,sku)
);
CREATE TABLE IF NOT EXISTS product_price_history (
 id uuid PRIMARY KEY, sku text NOT NULL REFERENCES warehouse_products(sku),
 gross_price_cents integer NOT NULL CHECK(gross_price_cents>0), source text NOT NULL,
 actor_id uuid REFERENCES customers(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS competitor_shops (
 id uuid PRIMARY KEY, name text NOT NULL, domain text NOT NULL UNIQUE,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS competitor_offers (
 id uuid PRIMARY KEY, sku text NOT NULL REFERENCES warehouse_products(sku), shop_id uuid REFERENCES competitor_shops(id),
 url text NOT NULL, title text NOT NULL, brand text, manufacturer_code text, ean text,
 price_cents integer CHECK(price_cents>0), shipping_cents integer CHECK(shipping_cents>=0),
 currency text NOT NULL CHECK(currency IN ('EUR','BGN','unknown')), in_stock boolean, includes_vat boolean,
 identity_verified boolean NOT NULL DEFAULT false, pack_quantity numeric CHECK(pack_quantity>0),
 evidence text NOT NULL DEFAULT '', checked_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
 UNIQUE(sku,url,checked_at)
);
CREATE INDEX IF NOT EXISTS competitor_offers_sku_date ON competitor_offers(sku,checked_at);
CREATE TABLE IF NOT EXISTS customer_addresses (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 label text NOT NULL, recipient_name text NOT NULL, phone text NOT NULL,
 delivery jsonb NOT NULL, is_default boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_default_address ON customer_addresses(customer_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS admin_audit_log (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES customers(id), action text NOT NULL,
 entity_type text NOT NULL, entity_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
