-- Product media in object storage (#44): a file's bytes live either in
-- `content` (MEDIA_STORAGE=database, the default) or in an S3-compatible
-- bucket under `storage_key` (MEDIA_STORAGE=s3). byte_size keeps the
-- per-product limits working for both.
ALTER TABLE product_media ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE product_media ADD COLUMN IF NOT EXISTS byte_size integer;
UPDATE product_media SET byte_size = octet_length(content)
  WHERE byte_size IS NULL AND content IS NOT NULL;
ALTER TABLE product_media ALTER COLUMN content DROP NOT NULL;
ALTER TABLE product_media ALTER COLUMN byte_size SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_media_stored_once'
      AND conrelid = 'product_media'::regclass
  ) THEN
    ALTER TABLE product_media ADD CONSTRAINT product_media_stored_once
      CHECK ((content IS NULL) <> (storage_key IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_media_byte_size'
      AND conrelid = 'product_media'::regclass
  ) THEN
    ALTER TABLE product_media ADD CONSTRAINT product_media_byte_size
      CHECK (byte_size BETWEEN 12 AND 52428800);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS product_media_storage_key
  ON product_media(storage_key) WHERE storage_key IS NOT NULL;
-- Reserved in 007 for this adapter and never used: product_media covers it.
DROP TABLE IF EXISTS product_images;
