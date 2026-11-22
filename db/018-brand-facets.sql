-- Brand facet (#38): brands are grouped by a normalised key, so "Bosch",
-- "BOSCH" and "bosch " count as one brand. Mirrors brandKey() in
-- src/lib/search-text.ts. Brands stay a product column (also used to match
-- invoice lines); a brand table can follow when brand pages need one.
CREATE OR REPLACE FUNCTION brand_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(both '-' from regexp_replace(search_latin(value), '[^a-z0-9]+', '-', 'g'))
$$;
