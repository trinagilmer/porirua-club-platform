const { createAgent, login } = require("../helpers/app");
const { createPool } = require("../helpers/testDb");

describe("function room allocations", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;
  let pool;

  beforeAll(async () => {
    pool = createPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS function_room_allocations (
        id SERIAL PRIMARY KEY,
        function_id UUID NOT NULL REFERENCES functions(id_uuid) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        start_at TIMESTAMP WITHOUT TIME ZONE NULL,
        end_at TIMESTAMP WITHOUT TIME ZONE NULL,
        notes TEXT NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      );
    `);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test("allocations are included in calendar room filters", async () => {
    const { rows: baseRooms } = await pool.query(
      `SELECT id FROM rooms WHERE name = 'Test Room' LIMIT 1;`
    );
    const primaryRoomId = baseRooms[0]?.id;
    expect(primaryRoomId).toBeTruthy();

    const { rows: extraRooms } = await pool.query(
      `INSERT INTO rooms (name, capacity) VALUES ('Function Extra Room', 45) RETURNING id, name;`
    );
    const extraRoomId = extraRooms[0]?.id;
    const extraRoomName = extraRooms[0]?.name;
    expect(extraRoomId).toBeTruthy();

    const today = new Date().toISOString().slice(0, 10);
    const { rows: created } = await pool.query(
      `
      INSERT INTO functions (event_name, event_date, room_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id_uuid;
      `,
      ["Multi Room Function", today, primaryRoomId]
    );
    const functionId = created[0]?.id_uuid;
    expect(functionId).toBeTruthy();

    await pool.query(
      `
      INSERT INTO function_room_allocations (function_id, room_id, start_at, end_at, notes)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [
        functionId,
        extraRoomId,
        `${today} 18:00:00`,
        `${today} 22:00:00`,
        "Evening only",
      ]
    );

    const agent = createAgent();
    await login(agent, email, password);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const calRes = await agent.get(
      `/calendar/events?include=functions&rooms=${extraRoomId}&start=${today}&end=${tomorrow}`
    );
    expect(calRes.status).toBe(200);
    const calendarEvents = calRes.body || [];
    const match = calendarEvents.find(
      (event) => event.extendedProps?.sourceId === functionId
    );
    expect(match).toBeTruthy();
    expect(match.extendedProps?.roomIds || []).toContain(extraRoomId);
    expect(match.extendedProps?.roomNames || []).toContain(extraRoomName);
  });

  test("allocation date windows control room filter matches", async () => {
    const { rows: baseRooms } = await pool.query(
      `SELECT id FROM rooms WHERE name = 'Test Room' LIMIT 1;`
    );
    const primaryRoomId = baseRooms[0]?.id;
    expect(primaryRoomId).toBeTruthy();

    const { rows: extraRooms } = await pool.query(
      `INSERT INTO rooms (name, capacity) VALUES ('Function Window Room', 20) RETURNING id, name;`
    );
    const windowRoomId = extraRooms[0]?.id;
    expect(windowRoomId).toBeTruthy();

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { rows: created } = await pool.query(
      `
      INSERT INTO functions (event_name, event_date, end_date, room_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id_uuid;
      `,
      ["Windowed Function", todayStr, inTwoDays, primaryRoomId]
    );
    const functionId = created[0]?.id_uuid;
    expect(functionId).toBeTruthy();

    await pool.query(
      `
      INSERT INTO function_room_allocations (function_id, room_id, start_at, end_at, notes)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [
        functionId,
        windowRoomId,
        `${inTwoDays} 09:00:00`,
        `${inTwoDays} 12:00:00`,
        "Future window",
      ]
    );

    const agent = createAgent();
    await login(agent, email, password);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const calTodayRes = await agent.get(
      `/calendar/events?include=functions&rooms=${windowRoomId}&start=${todayStr}&end=${tomorrow}`
    );
    expect(calTodayRes.status).toBe(200);
    const todayMatches = (calTodayRes.body || []).filter(
      (event) => event.extendedProps?.sourceId === functionId
    );
    expect(todayMatches.length).toBe(0);

    const inTwoDaysPlus = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const calFutureRes = await agent.get(
      `/calendar/events?include=functions&rooms=${windowRoomId}&start=${inTwoDays}&end=${inTwoDaysPlus}`
    );
    expect(calFutureRes.status).toBe(200);
    const futureMatches = (calFutureRes.body || []).filter(
      (event) => event.extendedProps?.sourceId === functionId
    );
    expect(futureMatches.length).toBe(1);
  });

  test("primary room is used when no allocations exist", async () => {
    const { rows: baseRooms } = await pool.query(
      `SELECT id, name FROM rooms WHERE name = 'Test Room' LIMIT 1;`
    );
    const primaryRoomId = baseRooms[0]?.id;
    const primaryRoomName = baseRooms[0]?.name;
    expect(primaryRoomId).toBeTruthy();

    const today = new Date().toISOString().slice(0, 10);
    const { rows: created } = await pool.query(
      `
      INSERT INTO functions (event_name, event_date, room_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id_uuid;
      `,
      ["Primary Room Only", today, primaryRoomId]
    );
    const functionId = created[0]?.id_uuid;
    expect(functionId).toBeTruthy();

    const agent = createAgent();
    await login(agent, email, password);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const calRes = await agent.get(
      `/calendar/events?include=functions&rooms=${primaryRoomId}&start=${today}&end=${tomorrow}`
    );
    expect(calRes.status).toBe(200);
    const calendarEvents = calRes.body || [];
    const match = calendarEvents.find(
      (event) => event.extendedProps?.sourceId === functionId
    );
    expect(match).toBeTruthy();
    expect(match.extendedProps?.roomIds || []).toContain(primaryRoomId);
    expect(match.extendedProps?.roomNames || []).toContain(primaryRoomName);
  });

  test("multiple allocations across rooms appear in room names", async () => {
    const { rows: baseRooms } = await pool.query(
      `SELECT id FROM rooms WHERE name = 'Test Room' LIMIT 1;`
    );
    const primaryRoomId = baseRooms[0]?.id;
    expect(primaryRoomId).toBeTruthy();

    const { rows: extraRooms } = await pool.query(
      `
      INSERT INTO rooms (name, capacity)
      VALUES ('Multi Room A', 20), ('Multi Room B', 35)
      RETURNING id, name;
      `
    );
    const roomA = extraRooms[0];
    const roomB = extraRooms[1];
    expect(roomA?.id).toBeTruthy();
    expect(roomB?.id).toBeTruthy();

    const today = new Date().toISOString().slice(0, 10);
    const { rows: created } = await pool.query(
      `
      INSERT INTO functions (event_name, event_date, room_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id_uuid;
      `,
      ["Multiple Allocations", today, primaryRoomId]
    );
    const functionId = created[0]?.id_uuid;
    expect(functionId).toBeTruthy();

    await pool.query(
      `
      INSERT INTO function_room_allocations (function_id, room_id)
      VALUES ($1, $2), ($1, $3);
      `,
      [functionId, roomA.id, roomB.id]
    );

    const agent = createAgent();
    await login(agent, email, password);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const calRes = await agent.get(
      `/calendar/events?include=functions&start=${today}&end=${tomorrow}`
    );
    expect(calRes.status).toBe(200);
    const calendarEvents = calRes.body || [];
    const match = calendarEvents.find(
      (event) => event.extendedProps?.sourceId === functionId
    );
    expect(match).toBeTruthy();
    const names = match.extendedProps?.roomNames || [];
    expect(names).toEqual(expect.arrayContaining([roomA.name, roomB.name]));
  });

  test("edit clears allocations when none submitted", async () => {
    const { rows: baseRooms } = await pool.query(
      `SELECT id FROM rooms WHERE name = 'Test Room' LIMIT 1;`
    );
    const primaryRoomId = baseRooms[0]?.id;
    expect(primaryRoomId).toBeTruthy();

    const { rows: extraRooms } = await pool.query(
      `INSERT INTO rooms (name, capacity) VALUES ('Clear Room', 25) RETURNING id;`
    );
    const extraRoomId = extraRooms[0]?.id;
    expect(extraRoomId).toBeTruthy();

    const today = new Date().toISOString().slice(0, 10);
    const { rows: created } = await pool.query(
      `
      INSERT INTO functions (event_name, event_date, room_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id_uuid;
      `,
      ["Clear Allocations", today, primaryRoomId]
    );
    const functionId = created[0]?.id_uuid;
    expect(functionId).toBeTruthy();

    await pool.query(
      `INSERT INTO function_room_allocations (function_id, room_id) VALUES ($1, $2);`,
      [functionId, extraRoomId]
    );

    const agent = createAgent();
    await login(agent, email, password);

    const editRes = await agent.post(`/functions/${functionId}/edit`).type("form").send({
      event_name: "Clear Allocations",
      event_date: today,
      room_id: primaryRoomId,
      status: "lead",
    });
    expect([302, 200]).toContain(editRes.status);

    const { rows: remaining } = await pool.query(
      `SELECT id FROM function_room_allocations WHERE function_id = $1;`,
      [functionId]
    );
    expect(remaining.length).toBe(0);
  });

  test("rejects allocations with end before start", async () => {
    const { rows: baseRooms } = await pool.query(
      `SELECT id FROM rooms WHERE name = 'Test Room' LIMIT 1;`
    );
    const primaryRoomId = baseRooms[0]?.id;
    expect(primaryRoomId).toBeTruthy();

    const { rows: extraRooms } = await pool.query(
      `INSERT INTO rooms (name, capacity) VALUES ('Invalid Window Room', 20) RETURNING id;`
    );
    const extraRoomId = extraRooms[0]?.id;
    expect(extraRoomId).toBeTruthy();

    const today = new Date().toISOString().slice(0, 10);
    const { rows: created } = await pool.query(
      `
      INSERT INTO functions (event_name, event_date, room_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id_uuid;
      `,
      ["Invalid Allocation", today, primaryRoomId]
    );
    const functionId = created[0]?.id_uuid;
    expect(functionId).toBeTruthy();

    const agent = createAgent();
    await login(agent, email, password);

    const res = await agent.post(`/functions/${functionId}/edit`).type("form").send({
      event_name: "Invalid Allocation",
      event_date: today,
      room_id: primaryRoomId,
      status: "lead",
      allocation_room_id: extraRoomId,
      allocation_start_date: today,
      allocation_start_time: "18:00",
      allocation_end_date: today,
      allocation_end_time: "17:00",
      allocation_notes: "Bad window",
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Allocation end must be after start.");
  });
});
