async function ensureRoomFacilityTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS room_facilities (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_room_facilities_room_name
      ON room_facilities (room_id, LOWER(name));

    CREATE TABLE IF NOT EXISTS function_room_facility_selections (
      function_id UUID NOT NULL REFERENCES functions(id_uuid) ON DELETE CASCADE,
      facility_id INTEGER NOT NULL REFERENCES room_facilities(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (function_id, facility_id)
    );

    CREATE INDEX IF NOT EXISTS idx_function_room_facilities_function
      ON function_room_facility_selections (function_id);
  `);
}

module.exports = { ensureRoomFacilityTables };