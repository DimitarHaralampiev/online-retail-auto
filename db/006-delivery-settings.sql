CREATE TABLE IF NOT EXISTS store_delivery_settings (
 id integer PRIMARY KEY CHECK(id=1),
 free_shipping_enabled boolean NOT NULL,
 free_shipping_above_cents integer NOT NULL CHECK(free_shipping_above_cents BETWEEN 0 AND 100000000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES customers(id)
);
