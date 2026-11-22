-- Garage vehicles can point at the vehicle reference (ADR 0002). The
-- free-text columns stay for display and for vehicles not mapped yet.
ALTER TABLE garage_vehicles
  ADD COLUMN IF NOT EXISTS generation_id uuid REFERENCES vehicle_generations(id) ON DELETE SET NULL;
ALTER TABLE garage_vehicles
  ADD COLUMN IF NOT EXISTS engine_id uuid REFERENCES vehicle_engines(id) ON DELETE SET NULL;
