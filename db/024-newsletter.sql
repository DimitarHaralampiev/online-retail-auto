-- Newsletter with double opt-in (#50). An address is subscribed only after
-- it confirms; the consent record keeps the wording shown, the language and
-- the times. Every email carries an unsubscribe link.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','unsubscribed')),
  confirm_token_hash text UNIQUE,
  confirm_expires_at timestamptz,
  unsubscribe_token_hash text NOT NULL UNIQUE,
  consent_text text NOT NULL CHECK (length(consent_text) <= 1000),
  consent_locale text NOT NULL CHECK (consent_locale IN ('bg','en')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  last_sent_at timestamptz,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  send_count integer NOT NULL DEFAULT 0 CHECK (send_count >= 0)
);
CREATE INDEX IF NOT EXISTS newsletter_confirmed
  ON newsletter_subscribers(confirmed_at) WHERE status = 'confirmed';
