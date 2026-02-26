-- Add room allocations for functions (primary room remains on functions.room_id).
CREATE TABLE IF NOT EXISTS function_room_allocations (
  id SERIAL PRIMARY KEY,
  function_id UUID NOT NULL REFERENCES functions(id_uuid) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_at TIMESTAMP WITHOUT TIME ZONE NULL,
  end_at TIMESTAMP WITHOUT TIME ZONE NULL,
  notes TEXT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);
