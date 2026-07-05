-- Improve function dashboard search/filter performance
CREATE INDEX IF NOT EXISTS idx_functions_event_date ON functions(event_date);
CREATE INDEX IF NOT EXISTS idx_functions_status_lower ON functions(LOWER(status));
CREATE INDEX IF NOT EXISTS idx_functions_owner_id ON functions(owner_id);
CREATE INDEX IF NOT EXISTS idx_functions_event_type ON functions(event_type);
CREATE INDEX IF NOT EXISTS idx_functions_event_name ON functions(event_name);
