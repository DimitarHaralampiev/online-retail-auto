CREATE TABLE IF NOT EXISTS product_media (
 id uuid PRIMARY KEY,
 sku text NOT NULL REFERENCES warehouse_products(sku) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('image','video')),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','video/mp4','video/webm')),
 filename text NOT NULL,
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 12 AND 52428800),
 alt_text jsonb NOT NULL DEFAULT '{"bg":"","en":""}',
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order>=0),
 is_primary boolean NOT NULL DEFAULT false CHECK(NOT is_primary OR kind='image'),
 uploaded_by uuid REFERENCES customers(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_media_order ON product_media(sku,sort_order,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS product_media_primary ON product_media(sku) WHERE is_primary;
