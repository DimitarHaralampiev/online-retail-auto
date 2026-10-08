CREATE TABLE IF NOT EXISTS customers (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 name text NOT NULL, phone text NOT NULL, delivery jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_sessions (
 token_hash text PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (
 key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
);
