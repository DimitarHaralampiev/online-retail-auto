-- Optimistic concurrency for admin product edits. Only content and status
-- changes made through product management (and the demo seed) bump
-- content_version and content_updated_at; stock movements do not, so an
-- order placed while an admin edits never causes a false conflict.
-- No index on content_updated_at: the admin list is small, and keeping
-- warehouse_products free of indexes on columns that change often keeps
-- stock updates cheap.
ALTER TABLE warehouse_products
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1;
ALTER TABLE warehouse_products
  ADD COLUMN IF NOT EXISTS content_updated_at timestamptz NOT NULL DEFAULT now();
-- An unreleased draft of this migration indexed (status, updated_at).
DROP INDEX IF EXISTS warehouse_products_status_updated;
