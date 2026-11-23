-- Verified-purchase product reviews (#49): only customers with a delivered
-- order containing the product may review it, once per product; reviews are
-- shown only after an admin publishes them. Ratings shown anywhere are
-- computed from published reviews only.
CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid PRIMARY KEY,
  sku text NOT NULL REFERENCES warehouse_products(sku) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  order_id uuid NOT NULL REFERENCES orders(id),
  author_name text NOT NULL CHECK (length(trim(author_name)) BETWEEN 1 AND 60),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','published','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz,
  moderated_by uuid REFERENCES customers(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS product_reviews_one_per_customer
  ON product_reviews(customer_id, sku) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_reviews_published
  ON product_reviews(sku, created_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS product_reviews_pending
  ON product_reviews(created_at) WHERE status = 'pending';
