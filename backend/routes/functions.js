const express = require("express");
const { pool } = require("../db");
const router = express.Router();
const { sendMail: graphSendMail } = require("../services/graphService");

// === MSAL for app-token fallback (if no delegated token in session) ===
const { ConfidentialClientApplication } = require("@azure/msal-node");

// 🔧 Initialize MSAL Client
const cca = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
});

// 🧩 Utility: normalizeRecipients
function normalizeRecipients(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 🔐 getAppAccessToken()
 * Acquires an application-only Graph token (client credential flow)
 */
// eslint-disable-next-line no-unused-vars
async function getAppAccessToken() {
  try {
    const tokenResponse = await cca.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });

    console.log(
      "🔑 App Access Token (partial):",
      tokenResponse.accessToken.substring(0, 80) + "..."
    );
    console.log("🕒 Token expires:", tokenResponse.expiresOn?.toISOString());

    return tokenResponse.accessToken;
  } catch (err) {
    console.error("❌ Failed to acquire app access token:", err.message);
    throw err;
  }
}

/**
 * 🧠 getGraphAccessToken(req)
 * Requires a valid delegated Microsoft Graph token (user login)
 */
async function getGraphAccessToken(req, res) {
  const s = req.session || {};
  const delegated =
    s.graphToken ||
    s.graphAccessToken ||
    s.accessToken ||
    (s.graph && s.graph.accessToken);

  if (delegated) {
    console.log("🧩 Using delegated (session) Graph token ✅");
    return delegated;
  }

  console.warn("⚠️ No delegated Graph token in session — prompting re-auth.");
  if (res) return res.status(401).json({ error: "Session expired. Please sign in again." });
  throw new Error("no_delegated_token");
}


router.use(express.json());

/* =========================================================
   🧭 1. FUNCTIONS DASHBOARD (UUID-Ready, Clean Version)
========================================================= */
router.get("/", async (req, res, next) => {
  try {
    const userId = req.session.user?.id || null;
    const statusFilter = req.query.status || "active";
    const myOnly = req.query.mine === "true";

    const statusGroups = {
      active: ["lead", "qualified", "confirmed", "balance_due"],
      lead: ["lead"],
      qualified: ["qualified"],
      confirmed: ["confirmed"],
      balance_due: ["balance_due"],
      completed: ["completed"],
    };

    const statuses = statusGroups[statusFilter] || statusGroups.active;

    // 🧩 Base query
    let baseQuery = `
      SELECT 
        f.*, 
        f.id_uuid AS id, 
        r.name AS room_name, 
        u.name AS owner_name,
        COALESCE(contact_data.contacts, '[]') AS contacts
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON f.owner_id = u.id
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', c.id,
            'name', c.name,
            'email', c.email,
            'phone', c.phone,
            'is_primary', fc.is_primary
          )
        ) AS contacts
        FROM function_contacts fc
        JOIN contacts c ON fc.contact_id = c.id
        WHERE fc.function_id = f.id_uuid
      ) contact_data ON TRUE
      WHERE f.status = ANY($1)
    `;

    const params = [statuses];

    if (myOnly) {
      baseQuery += ` AND f.owner_id = $2`;
      params.push(userId);
    }

    baseQuery += ` ORDER BY f.event_date ASC;`;

    const { rows: functionEvents } = await pool.query(baseQuery, params);

    // 💰 Totals by status
    const { rows: totals } = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status='lead' THEN totals_price ELSE 0 END),0) AS lead_value,
        COALESCE(SUM(CASE WHEN status='qualified' THEN totals_price ELSE 0 END),0) AS qualified_value,
        COALESCE(SUM(CASE WHEN status='confirmed' THEN totals_price ELSE 0 END),0) AS confirmed_value,
        COALESCE(SUM(CASE WHEN status='balance_due' THEN totals_price ELSE 0 END),0) AS balance_due_value,
        COALESCE(SUM(CASE WHEN status='completed' THEN totals_price ELSE 0 END),0) AS completed_value
      FROM functions;
    `);

    // 🖥️ Render dashboard
    res.render("pages/functions/index", {
      title: "Functions Dashboard",
      active: "functions",
      user: req.session.user || null,
      events: functionEvents,
      totals: totals[0],
      statusFilter,
      myOnly,
    });
  } catch (err) {
    console.error("❌ Error loading dashboard:", err);
    next(err);
  }
});


/* =========================================================
   💬 COMMUNICATIONS ROUTES (UUID-Ready, Clean Version)
========================================================= */

// 📨 List all communications for a function
router.get("/:id/communications", async (req, res, next) => {
  const { id: functionId } = req.params; // UUID

  try {
    // 1️⃣ Fetch the parent function
    const { rows: fnRows } = await pool.query(
      `SELECT id_uuid, event_name, event_date, status, attendees, budget, totals_cost, totals_price, room_id, event_type 
       FROM functions 
       WHERE id_uuid = $1;`,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Fetch related messages
    const { rows: messages } = await pool.query(
      `SELECT 
         id,
         subject,
         body,
         body_html,
         from_email,
         to_email,
         created_at,
         related_function,
         message_type
       FROM messages
       WHERE related_function = $1
       ORDER BY created_at DESC;`,
      [functionId]
    );

    // 3️⃣ Linked contacts
    const linkedContactsRes = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
       FROM contacts c
       JOIN function_contacts fc ON fc.contact_id = c.id
       WHERE fc.function_id = $1
       ORDER BY fc.is_primary DESC, c.name ASC;`,
      [functionId]
    );

    // 4️⃣ Supporting data
    const roomsRes = await pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`);
    const eventTypesRes = await pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`);

    // 🖥️ Render page
    res.render("pages/functions/communications", {
      layout: "layouts/main",
      title: `Communications – ${fn.event_name}`,
      user: req.session.user || null,
      fn,
      messages,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      activeTab: "communications",
    });
  } catch (err) {
    console.error("❌ [Communications] Error:", err);
    next(err);
  }
});


// 📄 Single communication message detail
router.get("/:id/communications/:messageId", async (req, res, next) => {
  const { id: functionId, messageId } = req.params;

  try {
    // Fetch parent function
    const { rows: fnRows } = await pool.query(
      `SELECT id_uuid, event_name, event_date, status
       FROM functions 
       WHERE id_uuid = $1;`,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // Fetch message detail
    const { rows: msgRows } = await pool.query(
      `SELECT id, subject, body, body_html, from_email, to_email, created_at
       FROM messages
       WHERE id = $1 AND related_function = $2;`,
      [messageId, functionId]
    );

    const message = msgRows[0];
    if (!message) return res.status(404).send("Message not found");

    // Fetch related contacts, rooms, event types
    const linkedContactsRes = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
       FROM contacts c
       JOIN function_contacts fc ON fc.contact_id = c.id
       WHERE fc.function_id = $1
       ORDER BY fc.is_primary DESC, c.name ASC;`,
      [functionId]
    );

    const roomsRes = await pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`);
    const eventTypesRes = await pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`);

// Render message detail page
res.render("pages/functions/communication-detail", {
  layout: "layouts/main",
  title: `Message — ${fn.event_name}`,
  user: req.session.user || null,
  fn,
  message,
  messages: [], // ✅ prevents "messages is not defined" error
  linkedContacts: linkedContactsRes.rows,
  rooms: roomsRes.rows,
  eventTypes: eventTypesRes.rows,
  activeTab: "communications",
  pageType: "function-page" // ✅ prevents main.ejs from using function-shell
});

  } catch (err) {
    console.error("❌ [Communication DETAIL] Error:", err);
    next(err);
  }
});


// ✉️ SEND new message
router.post("/:id/communications/send", async (req, res) => {
  const { id: functionId } = req.params;
  const sender = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";

  const to = normalizeRecipients(req.body.to);
  const cc = normalizeRecipients(req.body.cc);
  const bcc = normalizeRecipients(req.body.bcc);
  const subject = (req.body.subject || "(No subject)").trim();
  const body = req.body.body || "";

  try {
    const accessToken = await getGraphAccessToken(req, res);
    if (!accessToken) return; // 401 already sent

    await graphSendMail(accessToken, { to, cc, bcc, subject, body });

    const insert = await pool.query(
      `INSERT INTO messages
         (related_function, from_email, to_email, subject, body, created_at, message_type)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'outbound')
       RETURNING id;`,
      [functionId, sender, to.join(", "), subject, body]
    );

    return res.json({ success: true, data: { id: insert.rows[0].id } });
  } catch (err) {
    console.error("❌ [Function SEND via Graph]", err?.message || err);
    res.status(500).json({ success: false, error: "Failed to send via Graph" });
  }
});


// ✉️ REPLY to message
router.post("/:id/communications/:messageId/reply", async (req, res) => {
  const { id: functionId, messageId } = req.params;
  const sender = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";

  const to = normalizeRecipients(req.body.to);
  const cc = normalizeRecipients(req.body.cc);
  const bcc = normalizeRecipients(req.body.bcc);
  const subject = (req.body.subject || "Re:").trim();
  const body = req.body.body || "";

  const nextUrl = req.body.next || `/functions/${functionId}/communications`;

  try {
    const { rows: orig } = await pool.query(
      `SELECT id FROM messages WHERE id = $1 AND related_function = $2`,
      [messageId, functionId]
    );

    if (!orig.length) return res.status(404).send("Original message not found");

    const accessToken = await getGraphAccessToken(req, res);
    if (!accessToken) return; // 401 already sent

    await graphSendMail(accessToken, { to, cc, bcc, subject, body });

    await pool.query(
      `INSERT INTO messages
         (related_function, from_email, to_email, subject, body, created_at, message_type)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'outbound');`,
      [functionId, sender, to.join(", "), subject, body]
    );

    res.redirect(nextUrl);
  } catch (err) {
    console.error("❌ [Function REPLY via Graph]", err?.message || err);
    res.status(500).json({ success: false, error: "Failed to send reply via Graph" });
  }
});

/* =========================================================
   ✏️ FUNCTION EDIT — GET + POST (UUID-Ready, Clean Version)
========================================================= */

// 🧭 GET: Function edit page
router.get("/:id/edit", async (req, res, next) => {
  const { id: functionId } = req.params;

  try {
    // 1️⃣ Load function details
    const { rows: fnRows } = await pool.query(
      `SELECT * FROM functions WHERE id_uuid = $1;`,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Load related data concurrently
    const [linkedContactsRes, roomsRes, eventTypesRes, usersRes] = await Promise.all([
      pool.query(`
        SELECT c.id, c.name, c.email, c.phone, fc.is_primary
        FROM contacts c
        JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;`,
        [functionId]
      ),
      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),
      pool.query(`SELECT id, name FROM users ORDER BY name ASC;`)
    ]);

    // 3️⃣ Render edit page
    res.render("pages/functions/edit", {
      layout: "layouts/main",
      title: `Edit — ${fn.event_name}`,
      user: req.session.user || null,
      fn,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      users: usersRes.rows,
      activeTab: "edit"
    });

  } catch (err) {
    console.error("❌ Error loading function edit page:", err);
    next(err);
  }
});


// 📝 POST: Save edited function
router.post("/:id/edit", async (req, res) => {
  const { id: functionId } = req.params;
  const {
    event_name,
    event_date,
    event_time,
    start_time,
    end_time,
    attendees,
    budget,
    totals_price,
    totals_cost,
    room_id,
    event_type,
    status,
    owner_id
  } = req.body;

  try {
    await pool.query(`
      UPDATE functions
      SET
        event_name   = $1,
        event_date   = $2,
        event_time   = $3,
        start_time   = $4,
        end_time     = $5,
        attendees    = $6,
        budget       = $7,
        totals_price = $8,
      totals_cost  = $9,
      room_id      = $10,
      event_type   = $11,
      status       = $12,
      owner_id     = $13,
      updated_at   = NOW()
    WHERE id_uuid = $14;`,
    [
      event_name,
      event_date || null,
      event_time || null,
      start_time || null,
      end_time || null,
      attendees || null,
      budget || null,
      totals_price || 0,
      totals_cost || 0,
      room_id || null,
      event_type || null,
      status,
      owner_id || null,
      functionId
    ]
    );

    console.log(`✅ Function updated successfully (UUID: ${functionId}, Name: ${event_name})`);
    res.redirect(`/functions/${functionId}`);

  } catch (err) {
    console.error("❌ Error updating function:", err);
    res.status(500).send("Failed to update function");
  }
});



/* =========================================================
   🧭 FUNCTION DETAIL VIEW — Full (Sidebar + Timeline, UUID Safe, Clean Version)
========================================================= */
router.get("/:id", async (req, res) => {
  try {
    const functionId = req.params.id.trim(); // UUID, trimmed for safety
    const activeTab = req.query.tab || "overview";

    // 1️⃣ Fetch base function info (by UUID)
    const { rows: fnRows } = await pool.query(
      `
      SELECT 
        f.*, 
        r.name AS room_name, 
        u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.id_uuid = $1;
      `,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) {
      console.warn(`⚠️ Function not found for UUID: ${functionId}`);
      return res.status(404).send("Function not found");
    }

    // 2️⃣ Load related data concurrently (UUID-safe)
    const [
      linkedContactsRes,
      notesRes,
      tasksRes,
      messagesRes,
      roomsRes,
      eventTypesRes,
      usersRes
    ] = await Promise.all([
      // Contacts
      pool.query(
        `
        SELECT 
          c.id, 
          c.name, 
          c.email, 
          c.phone, 
          c.company, 
          fc.is_primary
        FROM function_contacts fc
        JOIN contacts c ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;
        `,
        [functionId]
      ),

      // Notes
      pool.query(
        `
        SELECT 
          n.id AS entry_id,
          n.function_id,
          n.note_type,
          n.content AS body,
          n.created_at AS entry_date,
          n.updated_at,
          u.name AS author
        FROM function_notes n
        LEFT JOIN users u ON u.id = n.created_by
        WHERE n.function_id = $1
        ORDER BY n.created_at DESC;
        `,
        [functionId]
      ),

      // Tasks
      pool.query(
        `
        SELECT 
          t.id, 
          t.title, 
          t.status, 
          t.due_at, 
          t.created_at AS entry_date,
          u.name AS assigned_to_name
        FROM tasks t
        LEFT JOIN users u ON u.id::text = t.assigned_to::text
        WHERE t.function_id = $1
        ORDER BY t.created_at DESC;
        `,
        [functionId]
      ),

      // Messages
      pool.query(
        `
        SELECT 
          m.id AS entry_id,
          m.subject,
          m.created_at AS entry_date
        FROM messages m
        WHERE m.related_function = $1
        ORDER BY m.created_at DESC
        LIMIT 5;
        `,
        [functionId]
      ),

      // Static lookup data
      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),
      pool.query(`SELECT id, name FROM users ORDER BY name ASC;`)
    ]);

    // 3️⃣ Build combined timeline entries
    const allEntries = [
      ...notesRes.rows.map(n => ({ ...n, entry_type: "note" })),
      ...tasksRes.rows.map(t => ({ ...t, entry_type: "task" })),
      ...messagesRes.rows.map(m => ({ ...m, entry_type: "message" }))
    ];

    const grouped = allEntries.reduce((acc, entry) => {
      const dateKey = new Date(entry.entry_date).toISOString().split("T")[0];
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(entry);
      return acc;
    }, {});

    // 4️⃣ Render function detail view
    res.render("pages/functions/overview", {
      layout: 'layouts/main',  // ✅ use main layout again
      title: fn.event_name,
      active: "functions",
      user: req.session.user || null,
      pageType: 'function-detail',
      fn,
      linkedContacts: linkedContactsRes.rows,
      notes: notesRes.rows,
      tasks: tasksRes.rows,
      grouped,
      activeTab,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      users: usersRes.rows
    });

  } catch (err) {
    console.error("❌ [Function DETAIL] Error loading function detail:", err);
    res.status(500).send("Error loading function detail");
  }
});

/* =========================================================
   🧩 TASK MANAGEMENT (UUID-SAFE, CLEAN VERSION)
========================================================= */

// 🧭 GET: All tasks for a given function
router.get("/:id/tasks", async (req, res) => {
  const { id: functionId } = req.params;

  try {
    // 1️⃣ Fetch parent function info
    const { rows: fnRows } = await pool.query(
      `
      SELECT 
        id_uuid, event_name, event_date, status, attendees, budget, 
        totals_cost, totals_price, room_id, event_type 
      FROM functions 
      WHERE id_uuid = $1;
      `,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) {
      console.warn(`⚠️ [Tasks GET] Function not found: ${functionId}`);
      return res.status(404).send("Function not found");
    }

    // 2️⃣ Fetch tasks
    const { rows: tasks } = await pool.query(
      `
      SELECT 
        t.*, 
        u.name AS assigned_user_name, 
        u.email AS assigned_user_email
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_user_id
      WHERE t.function_id = $1
      ORDER BY t.created_at DESC;
      `,
      [functionId]
    );

    // 3️⃣ Fetch supporting data
    const [linkedContactsRes, roomsRes, eventTypesRes, usersRes] = await Promise.all([
      pool.query(`
        SELECT 
          c.id, c.name, c.email, c.phone, c.company, fc.is_primary
        FROM contacts c
        JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;
      `, [functionId]),

      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),
      pool.query(`SELECT id, name FROM users ORDER BY name ASC;`)
    ]);

    // 🖥️ Render the task management page
    res.render("pages/functions/tasks", {
      layout: "layouts/main",
      title: `${fn.event_name} — Tasks`,
      pageName: 'Tasks',   // 👈 add this
      user: req.session.user || null,
      fn,
      tasks,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      users: usersRes.rows,
      activeTab: "tasks"
    });

    console.log(`🧾 [Tasks GET] Loaded ${tasks.length} tasks for function ${functionId}`);

  } catch (err) {
    console.error("❌ [Tasks GET] Error:", err);
    res.status(500).send("Failed to load tasks");
  }
});


// 🆕 POST: Create a new task for a function
router.post("/:id/tasks/new", async (req, res) => {
  const { id: functionId } = req.params;
  const { title, description, assigned_to, due_at } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ success: false, error: "Task title is required" });
  }

  try {
    // 🧠 Convert frontend variable to correct type
    const assignedUserId = assigned_to ? parseInt(assigned_to, 10) : null;

    const { rows } = await pool.query(
      `
      INSERT INTO tasks (title, description, function_id, assigned_user_id, due_at, status, created_at)
      VALUES ($1, $2, $3, $4, $5, 'open', NOW())
      RETURNING *;
      `,
      [title.trim(), description || null, functionId, assignedUserId, due_at || null]
    );

    const newTask = rows[0];
    console.log(`✅ [Tasks NEW] Created task '${title}' for function ${functionId}`);

    res.json({ success: true, task: newTask });
  } catch (err) {
    console.error("❌ [Tasks NEW] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ✏️ UPDATE an existing task
router.post("/tasks/:taskId/update", async (req, res) => {
  const { taskId } = req.params;
  const { title, description, assigned_to, due_at, status } = req.body;

  try {
    const assignedUserId = assigned_to ? parseInt(assigned_to, 10) : null;

    const { rowCount } = await pool.query(
      `
      UPDATE tasks
      SET 
        title = $1,
        description = $2,
        assigned_user_id = $3,
        due_at = $4,
        status = COALESCE($5, status),
        updated_at = NOW()
      WHERE id = $6;
      `,
      [title, description || null, assignedUserId, due_at || null, status || null, taskId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    console.log(`✏️ [Tasks UPDATE] Task ${taskId} updated successfully`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Tasks UPDATE] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ✅ MARK TASK AS COMPLETED
router.post("/tasks/:taskId/complete", async (req, res) => {
  const { taskId } = req.params;

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE tasks
      SET status = 'completed', updated_at = NOW()
      WHERE id = $1;
      `,
      [taskId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    console.log(`🏁 [Tasks COMPLETE] Task ${taskId} marked as completed`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Tasks COMPLETE] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// 🔁 REOPEN a completed task
router.post("/tasks/:taskId/reopen", async (req, res) => {
  const { taskId } = req.params;

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE tasks
      SET status = 'open', updated_at = NOW()
      WHERE id = $1;
      `,
      [taskId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    console.log(`🔄 [Tasks REOPEN] Task ${taskId} reopened`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Tasks REOPEN] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// 🗑️ DELETE an existing task
router.delete("/tasks/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const result = await pool.query("DELETE FROM tasks WHERE id = $1;", [taskId]);
    if (result.rowCount === 0)
      return res.status(404).json({ success: false, error: "Task not found" });

    console.log(`🗑️ [Tasks DELETE] Task ${taskId} deleted`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Tasks DELETE] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


/* =========================================================
   🕒 FUNCTION FIELD UPDATE (UUID-SAFE, TYPE-SAFE VERSION)
========================================================= */
router.post("/:id/update-field", async (req, res) => {
  const { id: functionId } = req.params; // UUID string
  let { field, value } = req.body;

  // ✅ Define only allowed, safe-to-update columns
  const allowed = new Map([
    ["start_time", "start_time"],
    ["end_time", "end_time"],
    ["event_date", "event_date"],
    ["event_time", "event_time"],
    ["status", "status"],
    ["event_name", "event_name"],
    ["event_type", "event_type"],
    ["attendees", "attendees"],
    ["budget", "budget"],
    ["totals_price", "totals_price"],
    ["totals_cost", "totals_cost"],
    ["notes", "notes"],
    ["room_id", "room_id"] // integer column - handle separately
  ]);

  const column = allowed.get(field);
  if (!column) {
    console.warn(`⚠️ [Update-Field] Invalid field attempted: ${field}`);
    return res.status(400).json({ success: false, error: "Invalid field name" });
  }

  // 🧩 Normalize time formats
  if (["start_time", "end_time"].includes(column) && value && /^\d{2}:\d{2}$/.test(value)) {
    value = `${value}:00`;
  }

  // 🧩 Coerce types for numeric fields
  if (["budget", "totals_price", "totals_cost"].includes(column)) {
    value = value === "" ? null : parseFloat(value);
  }

  if (column === "room_id") {
    value = value === "" ? null : parseInt(value, 10);
  }

  // 💬 Debug logging before query
  console.log(`🛠️ [Function UPDATE-FIELD] Updating ${column} to '${value}' for function ${functionId}`);

  try {
    const query = `
      UPDATE functions 
      SET ${column} = $1, updated_at = NOW()
      WHERE id_uuid = $2
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [value, functionId]);

    if (!rows.length) {
      console.warn(`⚠️ [Update-Field] Function not found for UUID: ${functionId}`);
      return res.status(404).json({ success: false, error: "Function not found" });
    }

    console.log(`✅ [Function UPDATE-FIELD] Updated ${column} successfully for ${functionId}`);
    res.json({ success: true, data: rows[0] });

  } catch (err) {
    console.error("❌ [Function UPDATE-FIELD] Error:", err.message);
    res.status(500).json({ success: false, error: "Database update failed" });
  }
});

module.exports = router;
