ALTER TABLE functions
  ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES calendar_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS series_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_functions_series
  ON functions (series_id, series_order);

ALTER TABLE restaurant_bookings
  ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES calendar_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS series_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_series
  ON restaurant_bookings (series_id, series_order);
