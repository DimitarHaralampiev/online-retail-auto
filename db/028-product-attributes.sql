-- Product attributes and their facets (#103): admin-defined attributes
-- (viscosity, length, socket…) with one value per product.
-- Values that differ only in letter case, spacing or the decimal sign count
-- as one facet value. Mirrors attributeValueKey() in src/lib/attributes.ts.
CREATE OR REPLACE FUNCTION attribute_value_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(regexp_replace(regexp_replace(btrim(value), '\s+', ' ', 'g'),
    '([0-9]),([0-9])', '\1.\2', 'g') COLLATE "und-x-icu")
$$;

CREATE TABLE IF NOT EXISTS attribute_definitions (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(key) <= 40),
  name_bg text NOT NULL CHECK (char_length(name_bg) BETWEEN 2 AND 60),
  name_en text NOT NULL DEFAULT '' CHECK (char_length(name_en) <= 60),
  unit text NOT NULL DEFAULT '' CHECK (char_length(unit) <= 20),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  filterable boolean NOT NULL DEFAULT true,
  content_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_attributes (
  sku text NOT NULL REFERENCES warehouse_products(sku) ON DELETE CASCADE,
  key text NOT NULL REFERENCES attribute_definitions(key),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 100 AND btrim(value) <> ''),
  value_key text NOT NULL GENERATED ALWAYS AS (attribute_value_key(value)) STORED,
  PRIMARY KEY (sku, key)
);
CREATE INDEX IF NOT EXISTS product_attributes_value ON product_attributes(key, value_key);
