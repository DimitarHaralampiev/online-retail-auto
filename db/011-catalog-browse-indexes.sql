-- Storefront browsing reads published products by category; live sale prices
-- are looked up per SKU.
CREATE INDEX IF NOT EXISTS warehouse_products_published_category
  ON warehouse_products(category_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS promotion_lines_sku ON promotion_lines(sku);
