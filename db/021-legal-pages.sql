-- Legal pages (#45): business-supplied texts, edited by admins, never
-- written by the application. Empty text = not published yet.
CREATE TABLE IF NOT EXISTS legal_pages (
  slug text PRIMARY KEY CHECK (slug IN ('terms','privacy','delivery','returns','cookies')),
  content_bg text NOT NULL DEFAULT '' CHECK (length(content_bg) <= 100000),
  content_en text NOT NULL DEFAULT '' CHECK (length(content_en) <= 100000),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES customers(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
