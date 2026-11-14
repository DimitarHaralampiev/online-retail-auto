-- Optimistic concurrency for admin category edits (see 012 for products).
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1;
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS content_updated_at timestamptz NOT NULL DEFAULT now();
