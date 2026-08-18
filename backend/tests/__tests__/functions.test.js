const { createAgent, login } = require("../helpers/app");
const { pool } = require("../../db");

describe("functions form", () => {
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD;

  test("create function requires event name", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const res = await agent.post("/functions/new").type("form").send({
      event_name: "",
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Event name is required");
  });

  test("create function succeeds with minimal data", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const res = await agent.post("/functions/new").type("form").send({
      event_name: "Test Function",
      event_date: new Date().toISOString().slice(0, 10),
    });
    expect([302, 200]).toContain(res.status);
  });

  test("function overview shows a simplified booking summary", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const createRes = await agent.post("/functions/new").type("form").send({
      event_name: "Simplified Overview Test",
      event_date: new Date().toISOString().slice(0, 10),
      status: "confirmed",
    });

    expect([302, 200]).toContain(createRes.status);

    const { rows } = await pool.query(
      `SELECT id_uuid FROM functions WHERE event_name = $1 ORDER BY created_at DESC LIMIT 1;`,
      ["Simplified Overview Test"]
    );

    expect(rows[0]).toBeDefined();

    const overviewRes = await agent.get(`/functions/${rows[0].id_uuid}`);
    expect(overviewRes.status).toBe(302);
    expect(overviewRes.headers.location).toBe(`/functions/${rows[0].id_uuid}/edit`);

    const editRes = await agent.get(overviewRes.headers.location);
    expect(editRes.status).toBe(200);
    expect(editRes.text).toContain("Update the booking, room setup and pricing from one screen.");
    expect(editRes.text).toContain("Notes &amp; room setup");
  });

  test("create function stores simplified payment flags", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const res = await agent.post("/functions/new").type("form").send({
      event_name: "Payment Flags Test",
      event_date: new Date().toISOString().slice(0, 10),
      status: "confirmed",
      deposit_paid: "on",
      fully_paid: "on",
    });

    expect([302, 200]).toContain(res.status);

    const { rows } = await pool.query(
      `SELECT status, deposit_paid, fully_paid FROM functions WHERE event_name = $1 ORDER BY created_at DESC LIMIT 1;`,
      ["Payment Flags Test"]
    );

    expect(rows[0]).toMatchObject({
      status: "confirmed",
      deposit_paid: true,
      fully_paid: true,
    });
  });

  test("edit saves room facilities without overwriting quote totals", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const suffix = Date.now();
    const { rows: roomRows } = await pool.query(
      `INSERT INTO rooms (name, capacity) VALUES ($1, 80) RETURNING id;`,
      [`Facility Test Room ${suffix}`]
    );
    const roomId = roomRows[0].id;
    await pool.query(`
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
    `);
    const { rows: facilityRows } = await pool.query(
      `INSERT INTO room_facilities (room_id, name) VALUES ($1, 'Projector') RETURNING id;`,
      [roomId]
    );
    const facilityId = facilityRows[0].id;
    const { rows: functionRows } = await pool.query(
      `INSERT INTO functions (event_name, event_date, room_id, status, totals_price, totals_cost, created_at, updated_at)
       VALUES ($1, CURRENT_DATE, $2, 'confirmed', 1250, 700, NOW(), NOW())
       RETURNING id_uuid;`,
      [`Facility Edit Test ${suffix}`, roomId]
    );
    const functionId = functionRows[0].id_uuid;

    const editRes = await agent.post(`/functions/${functionId}/edit`).type("form").send({
      event_name: `Facility Edit Test ${suffix}`,
      event_date: new Date().toISOString().slice(0, 10),
      room_id: roomId,
      status: "confirmed",
      facility_ids: facilityId,
      catering_time: ["10:30", "18:00"],
      catering_label: ["Morning tea", "Dinner"],
      catering_description: ["Tea, coffee and slices", "Buffet service"],
      dietary_requirements: "Two gluten-free meals and one nut allergy",
    });
    expect(editRes.status).toBe(302);

    const { rows: savedRows } = await pool.query(
            `SELECT f.totals_price, f.totals_cost, f.catering_schedule,
              f.dietary_requirements, frfs.facility_id
         FROM functions f
         LEFT JOIN function_room_facility_selections frfs ON frfs.function_id = f.id_uuid
        WHERE f.id_uuid = $1;`,
      [functionId]
    );
    expect(Number(savedRows[0].totals_price)).toBe(1250);
    expect(Number(savedRows[0].totals_cost)).toBe(700);
    expect(savedRows[0].facility_id).toBe(facilityId);
    expect(savedRows[0].catering_schedule).toEqual([
      { time: "10:30", label: "Morning tea", description: "Tea, coffee and slices" },
      { time: "18:00", label: "Dinner", description: "Buffet service" },
    ]);
    expect(savedRows[0].dietary_requirements).toBe("Two gluten-free meals and one nut allergy");

    const runSheetRes = await agent.get(`/functions/${functionId}/run-sheet?facilities=true&catering=true&dietary=true&items=none`);
    expect(runSheetRes.status).toBe(200);
    expect(runSheetRes.text).toContain("Projector");
    expect(runSheetRes.text).toContain("Morning tea");
    expect(runSheetRes.text).toContain("Buffet service");
    expect(runSheetRes.text).toContain("Two gluten-free meals and one nut allergy");

    const hiddenCateringRes = await agent.get(
      `/functions/${functionId}/run-sheet?facilities=true&catering=false&dietary=false&items=none`
    );
    expect(hiddenCateringRes.status).toBe(200);
    expect(hiddenCateringRes.text).not.toContain("Morning tea");
    expect(hiddenCateringRes.text).not.toContain("Two gluten-free meals and one nut allergy");
  });

  test("room conflict check accepts an overnight booking range", async () => {
    const agent = createAgent();
    await login(agent, email, password);
    const suffix = Date.now();
    const { rows: roomRows } = await pool.query(
      `INSERT INTO rooms (name, capacity) VALUES ($1, 40) RETURNING id;`,
      [`Overnight Test Room ${suffix}`]
    );

    const response = await agent.post("/functions/room-conflicts").send({
      room_id: roomRows[0].id,
      event_date: new Date().toISOString().slice(0, 10),
      start_time: "19:00",
      end_time: "01:00",
      allocations: [],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, hasConflicts: false });
  });

  test("active dashboards hide cancelled and past functions", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO functions (id_uuid, event_name, status, event_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW());`,
      ["Past Function", "confirmed", pastDate]
    );

    await pool.query(
      `INSERT INTO functions (id_uuid, event_name, status, event_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW());`,
      ["Cancelled Function", "cancelled", futureDate]
    );

    await pool.query(
      `INSERT INTO functions (id_uuid, event_name, status, event_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW());`,
      ["Upcoming Function", "confirmed", futureDate]
    );

    const functionsRes = await agent.get("/functions?status=active");
    expect(functionsRes.status).toBe(200);
    expect(functionsRes.text).toContain("Upcoming Function");
    expect(functionsRes.text).not.toContain("Past Function");
    expect(functionsRes.text).not.toContain("Cancelled Function");

    const dashboardRes = await agent.get("/").redirects(1);
    expect(dashboardRes.status).toBe(200);
    expect(dashboardRes.text).toContain("Upcoming Function");
    expect(dashboardRes.text).not.toContain("Past Function");
    expect(dashboardRes.text).not.toContain("Cancelled Function");
  });

  test("quote add-item creates one-off line item and recalculates totals", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const eventName = `Quote Add Item Test ${Date.now()}`;
    const createRes = await agent.post("/functions/new").type("form").send({
      event_name: eventName,
      event_date: new Date().toISOString().slice(0, 10),
      status: "confirmed",
    });
    expect([302, 200]).toContain(createRes.status);

    const {
      rows: [fn],
    } = await pool.query(
      `SELECT id_uuid FROM functions WHERE event_name = $1 ORDER BY created_at DESC LIMIT 1;`,
      [eventName]
    );
    expect(fn).toBeDefined();

    const addItemRes = await agent.post(`/functions/${fn.id_uuid}/quote/add-item`).send({
      name: "Portable bar setup",
      category: "Extras",
      qty: 3,
      unit_price: 45,
      cost_each: 20,
      client_selectable: true,
    });

    expect(addItemRes.status).toBe(200);
    expect(addItemRes.body).toMatchObject({ success: true });
    expect(addItemRes.body.itemId).toBeTruthy();

    const {
      rows: [proposal],
    } = await pool.query(
      `SELECT id FROM proposals WHERE function_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [fn.id_uuid]
    );
    expect(proposal).toBeDefined();

    const {
      rows: [item],
    } = await pool.query(
      `SELECT id, description, unit_price, client_selectable
         FROM proposal_items
        WHERE proposal_id = $1
        ORDER BY id DESC
        LIMIT 1;`,
      [proposal.id]
    );

    expect(item).toBeDefined();
    expect(item.id).toBe(addItemRes.body.itemId);
    expect(Number(item.unit_price)).toBeCloseTo(45, 2);
    expect(item.client_selectable).toBe(true);
    expect(item.description).toContain("Portable bar setup x 3");
    expect(item.description).toContain("[category:Extras]");
    expect(item.description).toContain("[qty:3]");
    expect(item.description).toContain("[base:45]");
    expect(item.description).toContain("[quick_item:true]");
    expect(item.description).toContain("[cost_each:20]");
    expect(item.description).toContain("[client_selectable:true]");

    const categoryRes = await agent.post(`/functions/proposal-items/${item.id}/price`).send({
      unit_price: 45,
      cost_each: 20,
      category: "Equipment",
      include: true,
    });
    expect(categoryRes.status).toBe(200);

    const {
      rows: [updatedItem],
    } = await pool.query(`SELECT description FROM proposal_items WHERE id = $1;`, [item.id]);
    expect(updatedItem.description).toContain("[category:Equipment]");

    const includedRunSheet = await agent.get(
      `/functions/${fn.id_uuid}/run-sheet?categories=Equipment&prices=true`
    );
    expect(includedRunSheet.status).toBe(200);
    expect(includedRunSheet.text).toContain("Portable bar setup");

    const excludedRunSheet = await agent.get(
      `/functions/${fn.id_uuid}/run-sheet?categories=Food&prices=true`
    );
    expect(excludedRunSheet.status).toBe(200);
    expect(excludedRunSheet.text).not.toContain("Portable bar setup");

    const updateLineRes = await agent
      .post(`/functions/proposal-items/${item.id}/update-line`)
      .send({
        name: "Evening service team",
        category: "Staffing",
        qty: 4,
        cost_each: 25,
        unit_price: 55,
      });
    expect(updateLineRes.status).toBe(200);
    expect(updateLineRes.body).toMatchObject({ success: true });
    expect(Number(updateLineRes.body.totals.totals_price)).toBeCloseTo(220, 2);
    expect(Number(updateLineRes.body.totals.totals_cost)).toBeCloseTo(100, 2);

    const {
      rows: [savedLine],
    } = await pool.query(
      `SELECT pi.description, pi.unit_price, f.totals_price, f.totals_cost
         FROM proposal_items pi
         JOIN proposals p ON p.id = pi.proposal_id
         JOIN functions f ON f.id_uuid = p.function_id
        WHERE pi.id = $1;`,
      [item.id]
    );
    expect(savedLine.description).toContain("Evening service team x 4");
    expect(savedLine.description).toContain("[category:Staffing]");
    expect(savedLine.description).toContain("[qty:4]");
    expect(savedLine.description).toContain("[base:55]");
    expect(savedLine.description).toContain("[cost_each:25]");
    expect(Number(savedLine.unit_price)).toBeCloseTo(55, 2);
    expect(Number(savedLine.totals_price)).toBeCloseTo(220, 2);
    expect(Number(savedLine.totals_cost)).toBeCloseTo(100, 2);

    const editPageRes = await agent.get(`/functions/${fn.id_uuid}/edit`);
    expect(editPageRes.status).toBe(200);
    expect(editPageRes.text).toContain('value="Evening service team"');
    expect(editPageRes.text).toContain('value="4"');
    expect(editPageRes.text).toContain('value="55.00"');

    const {
      rows: [totals],
    } = await pool.query(
      `SELECT subtotal, remaining_due
         FROM proposal_totals
        WHERE proposal_id = $1
        LIMIT 1;`,
      [proposal.id]
    );

    expect(Number(totals.subtotal)).toBeCloseTo(220, 2);
    expect(Number(totals.remaining_due)).toBeCloseTo(220, 2);

    const {
      rows: [fnTotals],
    } = await pool.query(
      `SELECT totals_price, totals_cost
         FROM functions
        WHERE id_uuid = $1
        LIMIT 1;`,
      [fn.id_uuid]
    );

    expect(Number(fnTotals.totals_price)).toBeCloseTo(220, 2);
    expect(Number(fnTotals.totals_cost)).toBeCloseTo(100, 2);
  });

  test("quote add-item rejects invalid payload", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const eventName = `Quote Add Item Invalid Test ${Date.now()}`;
    const createRes = await agent.post("/functions/new").type("form").send({
      event_name: eventName,
      event_date: new Date().toISOString().slice(0, 10),
      status: "lead",
    });
    expect([302, 200]).toContain(createRes.status);

    const {
      rows: [fn],
    } = await pool.query(
      `SELECT id_uuid FROM functions WHERE event_name = $1 ORDER BY created_at DESC LIMIT 1;`,
      [eventName]
    );
    expect(fn).toBeDefined();

    const res = await agent.post(`/functions/${fn.id_uuid}/quote/add-item`).send({
      name: "",
      category: "Food",
      qty: 0,
      unit_price: -1,
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(String(res.body.error || "").toLowerCase()).toContain("item name");
  });

  test("quote add-item can save reusable menu item", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const eventName = `Quote Reuse Save Test ${Date.now()}`;
    const createRes = await agent.post("/functions/new").type("form").send({
      event_name: eventName,
      event_date: new Date().toISOString().slice(0, 10),
      status: "confirmed",
    });
    expect([302, 200]).toContain(createRes.status);

    const {
      rows: [fn],
    } = await pool.query(
      `SELECT id_uuid FROM functions WHERE event_name = $1 ORDER BY created_at DESC LIMIT 1;`,
      [eventName]
    );
    expect(fn).toBeDefined();

    const {
      rows: [category],
    } = await pool.query(
      `INSERT INTO menu_categories (name)
       VALUES ($1)
       RETURNING id;`,
      [`Quick Reuse Category ${Date.now()}`]
    );
    expect(category).toBeDefined();

    const res = await agent.post(`/functions/${fn.id_uuid}/quote/add-item`).send({
      name: "Reusable Lighting Package",
      category: "Extras",
      qty: 1,
      unit_price: 120,
      save_for_reuse: true,
      reuse_category_id: category.id,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reusableMenuId).toBeTruthy();
    expect(res.body.saveWarning).toBeNull();

    const {
      rows: [savedMenu],
    } = await pool.query(
      `SELECT id, category_id, name, price
         FROM menus
        WHERE id = $1
        LIMIT 1;`,
      [res.body.reusableMenuId]
    );

    expect(savedMenu).toBeDefined();
    expect(Number(savedMenu.category_id)).toBe(Number(category.id));
    expect(savedMenu.name).toBe("Reusable Lighting Package");
    expect(Number(savedMenu.price)).toBeCloseTo(120, 2);
  });

  test("quote room charge can update booked room and sync metadata", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const eventName = `Quote Room Sync Test ${Date.now()}`;
    const createRes = await agent.post("/functions/new").type("form").send({
      event_name: eventName,
      event_date: new Date().toISOString().slice(0, 10),
      status: "confirmed",
    });
    expect([302, 200]).toContain(createRes.status);

    const {
      rows: [fn],
    } = await pool.query(
      `SELECT id_uuid FROM functions WHERE event_name = $1 ORDER BY created_at DESC LIMIT 1;`,
      [eventName]
    );
    expect(fn).toBeDefined();

    const {
      rows: [roomA],
    } = await pool.query(
      `INSERT INTO rooms (name, capacity)
       VALUES ($1, 120)
       RETURNING id, name;`,
      [`Room Sync A ${Date.now()}`]
    );

    const {
      rows: [roomB],
    } = await pool.query(
      `INSERT INTO rooms (name, capacity)
       VALUES ($1, 120)
       RETURNING id, name;`,
      [`Room Sync B ${Date.now()}`]
    );

    const addRoomChargeRes = await agent.post(`/functions/${fn.id_uuid}/quote/add-item`).send({
      name: "Room hire",
      category: "Room",
      room_id: roomA.id,
      qty: 1,
      unit_price: 250,
    });

    expect(addRoomChargeRes.status).toBe(200);
    expect(addRoomChargeRes.body.success).toBe(true);

    const {
      rows: [afterAdd],
    } = await pool.query(
      `SELECT room_id FROM functions WHERE id_uuid = $1 LIMIT 1;`,
      [fn.id_uuid]
    );
    expect(Number(afterAdd.room_id)).toBe(Number(roomA.id));

    const syncRes = await agent.post(`/functions/${fn.id_uuid}/quote/sync-room`).send({
      room_id: roomB.id,
    });

    expect(syncRes.status).toBe(200);
    expect(syncRes.body.success).toBe(true);
    expect(Number(syncRes.body.room.id)).toBe(Number(roomB.id));

    const {
      rows: [afterSync],
    } = await pool.query(
      `SELECT room_id FROM functions WHERE id_uuid = $1 LIMIT 1;`,
      [fn.id_uuid]
    );
    expect(Number(afterSync.room_id)).toBe(Number(roomB.id));

    const {
      rows: [proposal],
    } = await pool.query(
      `SELECT id FROM proposals WHERE function_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [fn.id_uuid]
    );
    expect(proposal).toBeDefined();

    const {
      rows: [roomLine],
    } = await pool.query(
      `SELECT description
         FROM proposal_items
        WHERE proposal_id = $1
          AND description ILIKE '%[category:Room]%'
        ORDER BY id DESC
        LIMIT 1;`,
      [proposal.id]
    );

    expect(roomLine).toBeDefined();
    expect(roomLine.description).toContain(`[room_id:${roomB.id}]`);
    expect(roomLine.description).toContain(`[room_match:true]`);
  });

  test("quote remove-item deletes one-off line from active proposal", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const eventName = `Quote Remove One-off Test ${Date.now()}`;
    const createRes = await agent.post("/functions/new").type("form").send({
      event_name: eventName,
      event_date: new Date().toISOString().slice(0, 10),
      status: "confirmed",
    });
    expect([302, 200]).toContain(createRes.status);

    const {
      rows: [fn],
    } = await pool.query(
      `SELECT id_uuid FROM functions WHERE event_name = $1 ORDER BY created_at DESC LIMIT 1;`,
      [eventName]
    );
    expect(fn).toBeDefined();

    const addRes = await agent.post(`/functions/${fn.id_uuid}/quote/add-item`).send({
      name: "One-off remove me",
      category: "Extras",
      qty: 1,
      unit_price: 50,
    });
    expect(addRes.status).toBe(200);
    expect(addRes.body.success).toBe(true);
    expect(addRes.body.itemId).toBeTruthy();

    const removeRes = await agent.post(`/functions/${fn.id_uuid}/quote/remove-item`).send({
      item_id: addRes.body.itemId,
    });
    expect(removeRes.status).toBe(200);
    expect(removeRes.body.success).toBe(true);

    const {
      rows: [proposal],
    } = await pool.query(
      `SELECT id FROM proposals WHERE function_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [fn.id_uuid]
    );
    expect(proposal).toBeDefined();

    const {
      rows: [leftover],
    } = await pool.query(
      `SELECT id
         FROM proposal_items
        WHERE proposal_id = $1
          AND id = $2
        LIMIT 1;`,
      [proposal.id, addRes.body.itemId]
    );
    expect(leftover).toBeUndefined();
  });

  test("quote sync-room updates metadata only when no room charge line exists", async () => {
    const agent = createAgent();
    await login(agent, email, password);

    const eventName = `Quote Room Sync Metadata Only ${Date.now()}`;
    const createRes = await agent.post("/functions/new").type("form").send({
      event_name: eventName,
      event_date: new Date().toISOString().slice(0, 10),
      status: "confirmed",
    });
    expect([302, 200]).toContain(createRes.status);

    const {
      rows: [fn],
    } = await pool.query(
      `SELECT id_uuid FROM functions WHERE event_name = $1 ORDER BY created_at DESC LIMIT 1;`,
      [eventName]
    );
    expect(fn).toBeDefined();

    const {
      rows: [room],
    } = await pool.query(
      `INSERT INTO rooms (name, capacity)
       VALUES ($1, 80)
       RETURNING id, name;`,
      [`Metadata Sync Room ${Date.now()}`]
    );
    expect(room).toBeDefined();

    const syncRes = await agent.post(`/functions/${fn.id_uuid}/quote/sync-room`).send({
      room_id: room.id,
    });

    expect(syncRes.status).toBe(200);
    expect(syncRes.body.success).toBe(true);
    expect(Number(syncRes.body.room.id)).toBe(Number(room.id));
    expect(Number(syncRes.body.roomChargeCount || 0)).toBe(0);

    const {
      rows: [proposal],
    } = await pool.query(
      `SELECT id FROM proposals WHERE function_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [fn.id_uuid]
    );
    expect(proposal).toBeDefined();

    const {
      rows: roomLines,
    } = await pool.query(
      `SELECT id
         FROM proposal_items
        WHERE proposal_id = $1
          AND description ILIKE '%[category:Room]%'
        ORDER BY id DESC;`,
      [proposal.id]
    );

    expect(roomLines.length).toBe(0);
  });
});
