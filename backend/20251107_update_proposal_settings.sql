-- Migration: extend proposal_settings for proposal terms/templates
-- Run this in Supabase before using the proposal builder/settings UI.

ALTER TABLE proposal_settings
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Bootstrap any existing data
UPDATE proposal_settings
   SET name = COALESCE(NULLIF(name, ''), NULLIF(notes_template, ''), CONCAT('Terms Block #', id)),
       content = COALESCE(content, terms_and_conditions, ''),
       updated_at = NOW();

CREATE UNIQUE INDEX IF NOT EXISTS proposal_settings_default_idx
  ON proposal_settings (is_default)
  WHERE is_default IS TRUE;
