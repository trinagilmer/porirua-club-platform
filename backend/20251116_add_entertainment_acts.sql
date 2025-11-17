CREATE TABLE IF NOT EXISTS entertainment_acts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  external_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entertainment_event_acts (
  event_id INTEGER REFERENCES entertainment_events(id) ON DELETE CASCADE,
  act_id INTEGER REFERENCES entertainment_acts(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, act_id)
);
