CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS feedback_settings (
  id SERIAL PRIMARY KEY,
  auto_functions BOOLEAN NOT NULL DEFAULT TRUE,
  auto_restaurant BOOLEAN NOT NULL DEFAULT TRUE,
  send_delay_days INTEGER NOT NULL DEFAULT 1 CHECK (send_delay_days BETWEEN 0 AND 30),
  reminder_days INTEGER NOT NULL DEFAULT 0 CHECK (reminder_days BETWEEN 0 AND 30),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO feedback_settings (auto_functions, auto_restaurant, send_delay_days, reminder_days)
SELECT TRUE, TRUE, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM feedback_settings);

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS feedback_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE functions
  ADD COLUMN IF NOT EXISTS auto_feedback BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE restaurant_bookings
  ADD COLUMN IF NOT EXISTS auto_feedback BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS feedback_responses (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('function','restaurant')),
  entity_id TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id),
  contact_email TEXT,
  contact_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','completed','cancelled')),
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  rating_overall SMALLINT CHECK (rating_overall BETWEEN 1 AND 5),
  rating_service SMALLINT CHECK (rating_service BETWEEN 1 AND 5),
  recommend BOOLEAN,
  comments TEXT,
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_entity ON feedback_responses (entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_token ON feedback_responses (token);
