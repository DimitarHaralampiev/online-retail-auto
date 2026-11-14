-- Optimistic concurrency for admin product edits. Only content and status
-- changes made through product management bump it; stock movements do not,
-- so an order placed while an admin edits never causes a false conflict.
ALTER TABLE warehouse_products
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1;
-- Admin product list: filter by status, newest edits first.
CREATE INDEX IF NOT EXISTS warehouse_products_status_updated
  ON warehouse_products(status, updated_at DESC);
