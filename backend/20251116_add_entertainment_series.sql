CREATE TABLE IF NOT EXISTS calendar_series (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('function','restaurant','entertainment')),
  template JSONB NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('none','daily','weekly','monthly_date','monthly_weekday')),
  interval INTEGER NOT NULL DEFAULT 1 CHECK (interval BETWEEN 1 AND 30),
  weekdays INTEGER[],
  monthly_day INTEGER,
  monthly_week INTEGER,
  start_date DATE NOT NULL,
  end_date DATE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_series_exceptions (
  id SERIAL PRIMARY KEY,
  series_id INTEGER REFERENCES calendar_series(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL
);

ALTER TABLE entertainment_events
  ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES calendar_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS series_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_calendar_series_entity ON calendar_series (entity_type);
CREATE INDEX IF NOT EXISTS idx_calendar_series_dates ON calendar_series (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_calendar_series_exceptions ON calendar_series_exceptions (series_id, exception_date);
