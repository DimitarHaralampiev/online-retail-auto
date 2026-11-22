-- Password recovery (#47): one pending reset per customer, stored as a
-- token hash with an expiry and the same send limits as email verification.
CREATE TABLE IF NOT EXISTS password_resets (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL,
  window_started_at timestamptz NOT NULL,
  send_count integer NOT NULL CHECK (send_count > 0)
);
