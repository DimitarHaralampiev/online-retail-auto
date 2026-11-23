-- Manual maintenance of the vehicle reference (#91): generations and engines
-- can be hidden like makes and models, and edits made on an outdated copy
-- are refused (version).
ALTER TABLE vehicle_generations ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE vehicle_engines ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE vehicle_makes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE vehicle_generations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE vehicle_engines ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
