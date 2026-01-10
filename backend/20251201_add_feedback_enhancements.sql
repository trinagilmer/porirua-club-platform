-- Adds richer feedback capture fields.
ALTER TABLE feedback_responses
  ADD COLUMN IF NOT EXISTS nps_score integer,
  ADD COLUMN IF NOT EXISTS issue_tags text[];
