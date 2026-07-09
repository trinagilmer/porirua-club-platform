-- Teamup calendar import table with local overlays and function linking.

CREATE TABLE IF NOT EXISTS teamup_events (
  id SERIAL PRIMARY KEY,
  teamup_event_id BIGINT NOT NULL UNIQUE,
  teamup_series_id BIGINT NULL,
  teamup_subcalendar_id BIGINT NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITH TIME ZONE NULL,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  location TEXT NULL,
  original_description TEXT NULL,
  local_description_override TEXT NULL,
  linked_function_id UUID NULL REFERENCES functions(id_uuid) ON DELETE SET NULL,
  external_url TEXT NULL,
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_hash TEXT NULL,
  last_synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teamup_events_starts_at ON teamup_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_teamup_events_linked_function ON teamup_events(linked_function_id);
