ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
CREATE TABLE IF NOT EXISTS email_verifications (
 customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 sent_at timestamptz NOT NULL,
 window_started_at timestamptz NOT NULL,
 send_count integer NOT NULL
);
