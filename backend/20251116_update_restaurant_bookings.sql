ALTER TABLE restaurant_bookings
  ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES restaurant_services(id),
  ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES restaurant_zones(id),
  ADD COLUMN IF NOT EXISTS table_id INTEGER REFERENCES restaurant_tables(id),
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'internal'
    CHECK (channel IN ('internal', 'online', 'phone')),
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS special_requests TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_service_date
  ON restaurant_bookings (service_id, booking_date);

CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_zone_date
  ON restaurant_bookings (zone_id, booking_date);
