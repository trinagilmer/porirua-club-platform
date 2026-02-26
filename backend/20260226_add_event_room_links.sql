-- Add join tables for multi-room support on entertainment and club events.
-- Primary room remains on entertainment_events.room_id and club_events.space_id.

CREATE TABLE IF NOT EXISTS entertainment_event_rooms (
  event_id INTEGER NOT NULL REFERENCES entertainment_events(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (event_id, room_id)
);

CREATE TABLE IF NOT EXISTS club_event_rooms (
  event_id INTEGER NOT NULL REFERENCES club_events(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (event_id, room_id)
);
