-- The free-text fitment table is replaced by product_vehicle_fitments (014,
-- ADR 0002). Its rows are not copied: they were never verified, and mapping
-- them onto the reference would invent fitment.
DROP TABLE IF EXISTS product_fitments;
