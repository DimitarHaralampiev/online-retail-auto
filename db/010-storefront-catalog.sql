-- Storefront fields on warehouse products. Schema only: demo or real catalog
-- data is never loaded by migrations (see `npm run db:seed:demo`).
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS image_path text
  CHECK (image_path IS NULL OR image_path ~ '^/[A-Za-z0-9/_.-]+$');
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS warehouse_products_storefront
  ON warehouse_products(status, category_id);
