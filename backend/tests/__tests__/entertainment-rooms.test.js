const { createAgent, login } = require("../helpers/app");
const { createPool } = require("../helpers/testDb");

describe("entertainment multi-room support", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  let pool;

  beforeAll(async () => {
    pool = createPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS entertainment_event_rooms (
        event_id INTEGER NOT NULL REFERENCES entertainment_events(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (event_id, room_id)
      );
    `);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test("additional rooms persist and are visible in JSON + calendar filters", async () => {
    const { rows: baseRooms } = await pool.query(
      `SELECT id FROM rooms WHERE name = 'Test Room' LIMIT 1;`
    );
    const primaryRoomId = baseRooms[0]?.id;
    expect(primaryRoomId).toBeTruthy();

    const { rows: extraRooms } = await pool.query(
      `INSERT INTO rooms (name, capacity) VALUES ('Extra Room', 30) RETURNING id;`
    );
    const extraRoomId = extraRooms[0]?.id;
    expect(extraRoomId).toBeTruthy();

    const today = new Date().toISOString().slice(0, 10);
    const { rows: created } = await pool.query(
      `
      INSERT INTO entertainment_events
        (title, slug, status, display_type, room_id, start_at, created_at, updated_at, currency)
      VALUES
        ($1, $2, $3, $4, $5, NOW(), NOW(), NOW(), 'NZD')
      RETURNING id;
      `,
      [
        "Multi Room Entertainment",
        `multi-room-${Date.now()}`,
        "scheduled",
        "entertainment",
        primaryRoomId,
      ]
    );
    const eventId = created[0]?.id;
    expect(eventId).toBeTruthy();

    await pool.query(
      `INSERT INTO entertainment_event_rooms (event_id, room_id) VALUES ($1, $2);`,
      [eventId, extraRoomId]
    );

    const { rows: linkRows } = await pool.query(
      `SELECT room_id FROM entertainment_event_rooms WHERE event_id = $1 ORDER BY room_id;`,
      [eventId]
    );
    expect(linkRows.map((row) => row.room_id)).toEqual([extraRoomId]);

    const agent = createAgent();
    await login(agent, email, password);

    const jsonRes = await agent.get(`/settings/entertainment/${eventId}/json`);
    expect(jsonRes.status).toBe(200);
    expect(Array.isArray(jsonRes.body?.event?.additional_rooms)).toBe(true);
    const jsonRoomIds = jsonRes.body.event.additional_rooms.map((room) => room.id);
    expect(jsonRoomIds).toContain(extraRoomId);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const calRes = await agent.get(
      `/calendar/events?include=entertainment&rooms=${extraRoomId}&start=${today}&end=${tomorrow}`
    );
    expect(calRes.status).toBe(200);
    const calendarEvents = calRes.body || [];
    const match = calendarEvents.find(
      (event) => event.extendedProps?.sourceId === eventId
    );
    expect(match).toBeTruthy();
    expect(match.extendedProps?.roomIds || []).toContain(extraRoomId);
  });
});
