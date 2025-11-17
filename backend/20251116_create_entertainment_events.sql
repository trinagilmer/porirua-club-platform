CREATE TABLE IF NOT EXISTS entertainment_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  adjunct_name TEXT,
  external_url TEXT,
  organiser TEXT,
  price NUMERIC(10,2),
  currency TEXT NOT NULL DEFAULT 'NZD',
  description TEXT,
  image_url TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','cancelled')),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entertainment_events_start
  ON entertainment_events (start_at);

CREATE INDEX IF NOT EXISTS idx_entertainment_events_status
  ON entertainment_events (status);
