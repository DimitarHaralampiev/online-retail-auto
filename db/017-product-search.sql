-- Product search (#36): full text, typo-tolerant trigram matching and
-- Cyrillic↔Latin search through one Latin-normalised document per product,
-- kept current by triggers. pg_trgm and unaccent are trusted extensions
-- (PostgreSQL 13+): a database owner can create them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Lower-case Latin form of any text: Bulgarian Cyrillic is transliterated
-- (streamlined system, as Bulgarians type it in Latin) and accents removed,
-- so "Филтър", "filtar" and "FILTŬR" meet. IMMUTABLE for use in indexes.
CREATE OR REPLACE FUNCTION search_latin(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary,
    translate(
      replace(replace(replace(replace(replace(replace(replace(replace(
        lower(coalesce(value, '')),
        'щ', 'sht'), 'ж', 'zh'), 'ч', 'ch'), 'ш', 'sh'),
        'ю', 'yu'), 'я', 'ya'), 'ц', 'ts'), 'х', 'h'),
      'абвгдезийклмнопрстуфъьѝ',
      'abvgdeziyklmnoprstufayi'))
$$;

-- Product codes compared without case, spaces, dots or dashes.
CREATE OR REPLACE FUNCTION search_code(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT upper(regexp_replace(coalesce(value, ''), '[^[:alnum:]]', '', 'g'))
$$;

CREATE TABLE IF NOT EXISTS product_search (
  sku text PRIMARY KEY REFERENCES warehouse_products(sku) ON DELETE CASCADE,
  -- Latin-normalised names, descriptions and brand in both languages.
  document text NOT NULL,
  -- Normalised SKU, manufacturer code and EAN (exact matches rank first).
  codes text[] NOT NULL,
  tsv tsvector NOT NULL
);
CREATE INDEX IF NOT EXISTS product_search_tsv ON product_search USING gin (tsv);
CREATE INDEX IF NOT EXISTS product_search_trgm ON product_search USING gin (document gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_search_codes ON product_search USING gin (codes);

CREATE OR REPLACE FUNCTION refresh_product_search(target text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO product_search(sku, document, codes, tsv)
  SELECT w.sku, d.document,
         array_remove(ARRAY[search_code(w.sku), nullif(search_code(w.manufacturer_code), ''),
                            nullif(search_code(w.ean), '')], NULL),
         to_tsvector('simple', d.document)
  FROM warehouse_products w
  CROSS JOIN LATERAL (
    SELECT search_latin(concat_ws(' ', w.name, w.brand, w.manufacturer_code,
             (SELECT string_agg(t.name || ' ' || t.description, ' ' ORDER BY t.locale)
              FROM product_translations t WHERE t.sku = w.sku))) AS document
  ) d
  WHERE w.sku = target
  ON CONFLICT (sku) DO UPDATE
    SET document = EXCLUDED.document, codes = EXCLUDED.codes, tsv = EXCLUDED.tsv
$$;

CREATE OR REPLACE FUNCTION product_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_product_search(OLD.sku);
  ELSE
    PERFORM refresh_product_search(NEW.sku);
  END IF;
  RETURN NULL;
END $$;

-- Only text columns: stock and price updates (every order) do not reindex.
DROP TRIGGER IF EXISTS product_search_products ON warehouse_products;
CREATE TRIGGER product_search_products
  AFTER INSERT OR UPDATE OF name, brand, manufacturer_code, ean ON warehouse_products
  FOR EACH ROW EXECUTE FUNCTION product_search_trigger();
DROP TRIGGER IF EXISTS product_search_translations ON product_translations;
CREATE TRIGGER product_search_translations
  AFTER INSERT OR UPDATE OR DELETE ON product_translations
  FOR EACH ROW EXECUTE FUNCTION product_search_trigger();

-- Backfill (and repair) every product's document; cheap and idempotent.
SELECT refresh_product_search(sku) FROM warehouse_products;
