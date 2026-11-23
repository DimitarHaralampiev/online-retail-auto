-- Card payment window in the store's order settings (#80): how long an unpaid
-- card order holds its stock before it is cancelled. Applies to new orders;
-- Stripe requires a checkout session to live at least 30 minutes.
ALTER TABLE store_delivery_settings ADD COLUMN IF NOT EXISTS card_payment_window_minutes integer NOT NULL DEFAULT 30;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_delivery_settings_card_window') THEN
    ALTER TABLE store_delivery_settings ADD CONSTRAINT store_delivery_settings_card_window
      CHECK (card_payment_window_minutes BETWEEN 30 AND 180);
  END IF;
END $$;
