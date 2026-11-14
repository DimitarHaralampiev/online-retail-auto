-- Vehicle reference (make > model > generation > engine) and product fitment.
-- Schema only: reference data comes from a verified source through the admin
-- (never invented, never in migrations). The older free-text
-- product_fitments table stays until the storefront switches over (#33).
CREATE TABLE IF NOT EXISTS vehicle_makes (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vehicle_models (
  id uuid PRIMARY KEY,
  make_id uuid NOT NULL REFERENCES vehicle_makes(id),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make_id, slug)
);
-- A generation is a model's production period (e.g. "Golf VII, 2012–2020").
CREATE TABLE IF NOT EXISTS vehicle_generations (
  id uuid PRIMARY KEY,
  model_id uuid NOT NULL REFERENCES vehicle_models(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  year_from integer NOT NULL CHECK (year_from BETWEEN 1950 AND 2100),
  -- NULL: still in production.
  year_to integer CHECK (year_to IS NULL OR year_to BETWEEN year_from AND 2100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, name)
);
CREATE TABLE IF NOT EXISTS vehicle_engines (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL REFERENCES vehicle_generations(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  fuel text NOT NULL CHECK (fuel IN ('petrol','diesel','hybrid','plug-in-hybrid','electric','lpg','cng','other')),
  displacement_cc integer CHECK (displacement_cc BETWEEN 1 AND 20000),
  power_kw integer CHECK (power_kw BETWEEN 1 AND 2000),
  engine_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_id, name),
  -- Target of the fitment foreign key that keeps engine and generation consistent.
  UNIQUE (id, generation_id)
);
-- A product fits a whole generation (engine_id NULL) or one engine of it.
-- `source` records where the fitment was verified (catalog, manufacturer).
CREATE TABLE IF NOT EXISTS product_vehicle_fitments (
  id uuid PRIMARY KEY,
  sku text NOT NULL REFERENCES warehouse_products(sku) ON DELETE CASCADE,
  generation_id uuid NOT NULL REFERENCES vehicle_generations(id),
  engine_id uuid,
  notes text NOT NULL DEFAULT '',
  source text NOT NULL CHECK (length(trim(source)) > 0),
  created_by uuid REFERENCES customers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (sku, generation_id, engine_id)
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_vehicle_fitments_engine_generation'
      AND conrelid = 'product_vehicle_fitments'::regclass
  ) THEN
    ALTER TABLE product_vehicle_fitments
      ADD CONSTRAINT product_vehicle_fitments_engine_generation
      FOREIGN KEY (engine_id, generation_id)
      REFERENCES vehicle_engines(id, generation_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS product_vehicle_fitments_generation
  ON product_vehicle_fitments(generation_id);
CREATE INDEX IF NOT EXISTS product_vehicle_fitments_engine
  ON product_vehicle_fitments(engine_id) WHERE engine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicle_models_make ON vehicle_models(make_id);
CREATE INDEX IF NOT EXISTS vehicle_generations_model ON vehicle_generations(model_id);
-- Products that fit every vehicle (e.g. microfibre cloths, phone holders).
ALTER TABLE warehouse_products
  ADD COLUMN IF NOT EXISTS universal_fit boolean NOT NULL DEFAULT false;
