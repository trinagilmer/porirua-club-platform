ALTER TABLE functions
  ADD COLUMN IF NOT EXISTS catering_schedule JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE functions
  ADD COLUMN IF NOT EXISTS dietary_requirements TEXT;