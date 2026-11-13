-- Storefront fields on warehouse products and categories. Schema only: demo or
-- real catalog data is never loaded by migrations (see `npm run db:seed:demo`).
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS image_path text;
-- An unreleased draft of this migration added a looser unnamed check.
ALTER TABLE warehouse_products DROP CONSTRAINT IF EXISTS warehouse_products_image_path_check;
-- Static images under /images only: no protocol-relative URLs, no dot segments.
-- To change the rule later, add a constraint with a new name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'warehouse_products_image_path_local'
      AND conrelid = 'warehouse_products'::regclass
  ) THEN
    ALTER TABLE warehouse_products ADD CONSTRAINT warehouse_products_image_path_local
      CHECK (image_path IS NULL OR image_path ~ '^/images/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.(png|jpe?g|webp|avif)$');
  END IF;
END $$;
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
-- Storefront listing (published products in a category) and admin/FK lookups
-- by category alone. Replaces a draft index on (status, category_id).
DROP INDEX IF EXISTS warehouse_products_storefront;
CREATE INDEX IF NOT EXISTS warehouse_products_category_status
  ON warehouse_products(category_id, status);
