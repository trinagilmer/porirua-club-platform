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
 * — If missing, redirect user to /auth/graph/login
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

  console.warn("⚠️ No delegated Graph token in session — user must sign in again.");
  throw new Error("no_delegated_token");
}


router.use(express.json());



/* =========================================================
   🧭 1. FUNCTIONS DASHBOARD
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

    let sql = `
      SELECT f.*, r.name AS room_name, u.name AS owner_name,
             COALESCE(contact_data.contacts, '[]'::json) AS contacts
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
        WHERE fc.function_id = f.id
      ) contact_data ON TRUE
      WHERE f.status = ANY($1)
      ORDER BY f.event_date ASC;
    `;

    const params = [statuses];
    if (myOnly) {
      sql = sql.replace("ORDER BY", "AND f.owner_id = $2 ORDER BY");
      params.push(userId);
    }

    const { rows: events } = await pool.query(sql, params);

    const { rows: totals } = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status='lead' THEN totals_price ELSE 0 END),0) AS lead_value,
        COALESCE(SUM(CASE WHEN status='qualified' THEN totals_price ELSE 0 END),0) AS qualified_value,
        COALESCE(SUM(CASE WHEN status='confirmed' THEN totals_price ELSE 0 END),0) AS confirmed_value,
        COALESCE(SUM(CASE WHEN status='balance_due' THEN totals_price ELSE 0 END),0) AS balance_due_value,
        COALESCE(SUM(CASE WHEN status='completed' THEN totals_price ELSE 0 END),0) AS completed_value
      FROM public.functions;
    `);

    // ✅ updated render path
    res.render("pages/functions/index", {
      title: "Functions Dashboard",
      active: "functions",
      user: req.session.user || null,
      events,
      totals: totals[0],
      statusFilter,
      myOnly,
    });
  } catch (err) {
    console.error("❌ Error loading dashboard:", err);
    next(err);
  }
});


// ======================================================
// 💬 FUNCTION OVERVIEW
// - List messages for a function
// - Send new message (returns inserted id)
// - View a function-scoped message detail
// - Reply to that message (returns inserted id)
// ======================================================

// Helpers to store/retrieve recipients consistently
const toArrayList = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    return v.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
};
const toStringList = (v) => toArrayList(v).join(", ");

// ======================================================
// 📜 LIST: Function → Communications
// GET /functions/:id/communications
// ======================================================
router.get("/:id/communications", async (req, res, next) => {
  const { id } = req.params;

  try {
    // 1️⃣ Function header info
    const { rows: fnRows } = await pool.query(
      `SELECT id, event_name, event_date, status, attendees, budget, totals_cost, totals_price, room_id, event_type 
       FROM functions 
       WHERE id = $1;`,
      [id]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Messages for this function (newest first)
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
      [id]
    );

    // 3️⃣ Sidebar data
    const linkedContactsRes = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
         FROM contacts c
         JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;`,
      [id]
    );
    const roomsRes = await pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`);
    const eventTypesRes = await pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`);

      res.render("pages/functions/communications", {
      layout: "layouts/main",
  title: `Communications – ${fn.event_name}`,
  user: req.session.user || null,
  fn,
  messages,
  linkedContacts: linkedContactsRes.rows,
  rooms: roomsRes.rows,
  eventTypes: eventTypesRes.rows,
  activeTab: "Communications",
});

  } catch (err) {
    console.error("❌ [Communications] Error:", err);
    next(err);
  }
});
// ======================================================
// 📄 DETAIL: Single Communication Message
// GET /functions/:id/communications/:messageId
// ======================================================
router.get("/:id/communications/:messageId", async (req, res, next) => {
  const { id, messageId } = req.params;

  try {
    // 1️⃣ Fetch the parent function
    const { rows: fnRows } = await pool.query(
      `SELECT id, event_name, event_date, status
         FROM functions WHERE id = $1;`,
      [id]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Fetch the specific message
    const { rows: msgRows } = await pool.query(
      `SELECT id, subject, body, body_html, from_email, to_email, created_at
         FROM messages
        WHERE id = $1 AND related_function = $2;`,
      [messageId, id]
    );
    const message = msgRows[0];
    if (!message) return res.status(404).send("Message not found");

    // 3️⃣ Sidebar context (contacts, rooms, event types)
    const linkedContactsRes = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
         FROM contacts c
         JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;`,
      [id]
    );
    const roomsRes = await pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`);
    const eventTypesRes = await pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`);

    // 4️⃣ Render the detail page
    res.render("pages/functions/communication-detail", {
      layout: "layouts/main",
      title: `Message — ${fn.event_name}`,
      user: req.session.user || null,
      fn,
      message,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      activeTab: "communications"
    });
  } catch (err) {
    console.error("❌ [Communication DETAIL] Error:", err);
    next(err);
  }
});

// ======================================================
// ✉️ SEND: New message from Function → Communications
// POST /functions/:id/communications/send
// Returns: { success, data: { id } }
// ======================================================
router.post("/:id/communications/send", async (req, res) => {
  const { id } = req.params;
  const sender = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";

  const to      = normalizeRecipients(req.body.to);
  const cc      = normalizeRecipients(req.body.cc);
  const bcc     = normalizeRecipients(req.body.bcc);
  const subject = (req.body.subject || "(No subject)").trim();
  const body    = req.body.body || "";

  try {
    const accessToken = await getGraphAccessToken(req);
    // 1) send via Microsoft Graph
    await graphSendMail(accessToken, { to, cc, bcc, subject, body });

    // 2) store DB record as 'outbound'
    const insert = await pool.query(
      `INSERT INTO messages
         (related_function, from_email, to_email, subject, body, created_at, message_type)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'outbound')
       RETURNING id;`,
      [id, sender, to.join(", "), subject, body]
    );

    return res.json({ success: true, data: { id: insert.rows[0].id } });
  } catch (err) {
    console.error("❌ [Function SEND via Graph]", err?.message || err);
    // If token is invalid/expired and this was an XHR, hint login
    if (String(err).includes("invalid_grant") || String(err).includes("401")) {
      return res
        .status(401)
        .json({ success: false, error: "auth", redirect: `/auth/login?next=${encodeURIComponent(req.originalUrl)}` });
    }
    return res.status(500).json({ success: false, error: "Failed to send via Graph" });
  }
});


// ✉️ POST: Reply to a specific function message
// Sends via Microsoft Graph (using your graphservice.js),
// stores the outbound in DB, then redirects back
// ======================================================
router.post("/:id/communications/:messageId/reply", async (req, res) => {
  const { id: functionId, messageId } = req.params;
  const sender = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";

  console.log(
    "SESSION GRAPH TOKEN:",
    req.session?.graphAccessToken ? "✅ Present" : "❌ Missing"
  );

  // Accept JSON or form-encoded posts
  const to = normalizeRecipients(req.body.to);
  const cc = normalizeRecipients(req.body.cc);
  const bcc = normalizeRecipients(req.body.bcc);
  const subject = (req.body.subject || "Re:").trim();
  const body = req.body.body || "";

  // Where to go after sending (allow override via hidden input "next")
  const nextUrl =
    req.body.next && typeof req.body.next === "string"
      ? req.body.next
      : `/functions/${encodeURIComponent(functionId)}/communications`;

  try {
    // (Optional) ensure the original belongs to this function
    const { rows: orig } = await pool.query(
      `SELECT id FROM messages WHERE id = $1 AND related_function = $2`,
      [messageId, functionId]
    );

    if (!orig.length) {
      const wantsJSON = (req.headers.accept || "").includes("application/json");
      return wantsJSON
        ? res
            .status(404)
            .json({ success: false, error: "Original message not found" })
        : res.status(404).send("Original message not found");
    }

// 1️⃣ Acquire a token (delegated from session; redirect if missing)
let accessToken;
try {
  accessToken = await getGraphAccessToken(req);
} catch (err) {
  if (err && err.message === "no_delegated_token") {
    console.warn("🧭 Redirecting user to Microsoft login to restore Graph token");

    // Preserve the user's intended page for redirect after login
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/auth/graph/login?next=${returnTo}`);
  }
  throw err;
}

// 2️⃣ Send via Microsoft Graph
await graphSendMail(accessToken, { to, cc, bcc, subject, body });

    // 3️⃣ Store the sent message
    const insert = await pool.query(
      `INSERT INTO messages
         (related_function, from_email, to_email, subject, body, created_at, message_type)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'outbound')
       RETURNING id;`,
      [functionId, sender, to.join(", "), subject, body]
    );

    // 4️⃣ Return response
    const wantsJSON =
      req.xhr ||
      req.headers["x-requested-with"] === "XMLHttpRequest" ||
      (req.headers.accept || "").includes("application/json") ||
      (req.headers["content-type"] || "").includes("application/json");

    if (wantsJSON)
      return res.json({ success: true, data: { id: insert.rows[0].id } });

    return res.redirect(nextUrl);
  } catch (err) {
    console.error("❌ [Function REPLY via Graph]", err?.message || err);
    const wantsJSON =
      req.xhr ||
      req.headers["x-requested-with"] === "XMLHttpRequest" ||
      (req.headers.accept || "").includes("application/json") ||
      (req.headers["content-type"] || "").includes("application/json");

    return wantsJSON
      ? res
          .status(500)
          .json({ success: false, error: "Failed to send reply via Graph" })
      : res.status(500).send("Failed to send reply via Graph");
  }
});
/* =========================================================
   ✏️ FUNCTION EDIT — GET + POST
========================================================= */

// 🧭 GET: Edit Form
router.get("/:id/edit", async (req, res, next) => {
  const { id } = req.params;

  try {
    // 1️⃣ Fetch the function
    const { rows: fnRows } = await pool.query(`
      SELECT * FROM functions WHERE id = $1;
    `, [id]);
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Sidebar Data
    const [linkedContactsRes, roomsRes, eventTypesRes] = await Promise.all([
      pool.query(`
        SELECT c.id, c.name, c.email, c.phone, fc.is_primary
        FROM contacts c
        JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;
      `, [id]),
      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`)
    ]);

    // 3️⃣ Render the edit page
    res.render("pages/functions/edit", {
      layout: "layouts/main",
      title: `Edit — ${fn.event_name}`,
      user: req.session.user || null,
      fn,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      activeTab: "edit"
    });

  } catch (err) {
    console.error("❌ Error loading function edit page:", err);
    next(err);
  }
});

// 💾 POST: Save changes
router.post("/:id/edit", async (req, res) => {
  const { id } = req.params;
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
    status
  } = req.body;

  try {
    await pool.query(`
      UPDATE functions
      SET
        event_name = $1,
        event_date = $2,
        event_time = $3,
        start_time = $4,
        end_time = $5,
        attendees = $6,
        budget = $7,
        totals_price = $8,
        totals_cost = $9,
        room_id = $10,
        event_type = $11,
        status = $12,
        updated_at = NOW()
      WHERE id = $13;
    `, [
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
      id
    ]);

    console.log(`✅ Function ${id} updated successfully`);
    res.redirect(`/functions/${id}`);

  } catch (err) {
    console.error("❌ Error updating function:", err);
    res.status(500).send("Failed to update function");
  }
});



/* =========================================================
   🗒️ NOTES ROUTE (with layout + sidebar integration)
========================================================= */

router.get("/:id/notes", async (req, res) => {
  const { id } = req.params;

  try {
    // ✅ Fetch function
    const fnRes = await pool.query(
      `SELECT id, event_name, event_date, status, attendees, budget, totals_cost, totals_price, room_id, event_type 
       FROM functions WHERE id = $1;`,
      [id]
    );
    const fn = fnRes.rows[0];
    if (!fn) return res.status(404).send("Function not found");

    // ✅ Fetch notes with author and timestamps
    const { rows: notes } = await pool.query(
      `
      SELECT 
        n.id AS entry_id,
        n.function_id,
        n.content AS body,
        n.note_type,
        n.created_at AS entry_date,
        n.updated_at,
        u.name AS author
      FROM function_notes n
      LEFT JOIN users u ON u.id = n.created_by
      WHERE n.function_id = $1
      ORDER BY n.created_at DESC;
      `,
      [id]
    );

    // ✅ Fetch sidebar data (contacts, rooms, event types)
   const linkedContactsRes = await pool.query(
  `
  SELECT c.id, c.name, c.email, c.phone, fc.is_primary
  FROM contacts c
  JOIN function_contacts fc ON fc.contact_id = c.id
  WHERE fc.function_id = $1
  ORDER BY fc.is_primary DESC, c.name ASC;
  `,
  [id]
);


    const roomsRes = await pool.query(
      `SELECT id, name, capacity FROM rooms ORDER BY name ASC;`
    );

    const eventTypesRes = await pool.query(
      `SELECT name FROM club_event_types ORDER BY name ASC;`
    );

    // ✅ Render with full layout + sidebar context
    res.render("pages/functions/notes", {
      layout: "layouts/main",
      title: `${fn.event_name} — Notes`,
      pageType: "function/notes",      // 👈 helps JS autoload correct modules
      active: "functions",             // 👈 highlights nav item
      user: req.session.user || null,  // 👈 for header
      fn,
      notes,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      activeTab: "notes",
    });
  } catch (err) {
    console.error("❌ Error loading notes:", err);
    res.status(500).send("Failed to load notes");
  }
});


// 🆕 Create a new note
router.post("/:id/notes/new", async (req, res) => {
  const { id } = req.params;
  const { content, note_type } = req.body;
  const userId = req.session.user?.id || null;

  try {
    await pool.query(
      `
      INSERT INTO function_notes (function_id, content, note_type, created_by, created_at)
      VALUES ($1, $2, $3, $4, NOW());
      `,
      [id, content, note_type || "general", userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error creating note:", err);
    res.status(500).json({ success: false, message: "Failed to create note" });
  }
});



// ✏️ Update a note
router.post("/notes/:noteId/update", async (req, res) => {
  const { noteId } = req.params;
  const { content, note_type } = req.body;

  try {
    await pool.query(
      `
      UPDATE function_notes
      SET content = $1,
          note_type = COALESCE($2, 'general'),
          updated_at = NOW()
      WHERE id = $3;
      `,
      [content, note_type, noteId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error updating note:", err);
    res.status(500).json({ success: false });
  }
});

// 🗑️ Delete a note
router.delete("/notes/:noteId", async (req, res) => {
  const { noteId } = req.params;

  try {
    await pool.query(`DELETE FROM function_notes WHERE id = $1;`, [noteId]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting note:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================================================
   🧭 FUNCTION DETAIL VIEW — Full (Sidebar + Timeline)
========================================================= */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const activeTab = req.query.tab || "overview";

    // 1️⃣ Fetch base function info
    const { rows: fnRows } = await pool.query(`
      SELECT f.*, r.name AS room_name, u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.id = $1;
    `, [id]);

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Load all related data concurrently
    const [
      linkedContacts,
      notes,
      tasks,
      messages,
      rooms,
      eventTypes
    ] = await Promise.all([
      pool.query(`
        SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
        FROM function_contacts fc
        JOIN contacts c ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;
      `, [id]),

      pool.query(`
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
      `, [id]),

      pool.query(`
        SELECT 
          t.id, 
          t.title, 
          t.status, 
          t.due_at, 
          t.created_at AS entry_date,
          u.name AS assigned_to_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.function_id = $1
        ORDER BY t.created_at DESC;
      `, [id]),

pool.query(`
  SELECT 
    m.id AS entry_id,
    m.subject,
    m.created_at AS entry_date
  FROM messages m
  WHERE m.related_function = $1
  ORDER BY m.created_at DESC
  LIMIT 5;
`, [id]),


      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`)
    ]);

    // 3️⃣ Combine & group entries
    const allEntries = [
      ...notes.rows.map(n => ({ ...n, entry_type: "note" })),
      ...tasks.rows.map(t => ({ ...t, entry_type: "task" })),
      ...messages.rows.map(m => ({ ...m, entry_type: "message" }))
    ];

    const grouped = allEntries.reduce((acc, entry) => {
      const dateKey = new Date(entry.entry_date).toISOString().split("T")[0];
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(entry);
      return acc;
    }, {});

// 4️⃣ Render Function Detail Page (using unified layout)
res.render("pages/functions/overview", {
  layout: "layouts/main",
 // 🧩 this line is the key addition
  title: fn.event_name,
  active: "functions",
  user: req.session.user || null,
  fn,
  linkedContacts: linkedContacts.rows,
  notes: notes.rows,
  tasks: tasks.rows,
  grouped,
  activeTab,
  rooms: rooms.rows,
  eventTypes: eventTypes.rows
});


  } catch (err) {
    console.error("❌ Error loading function detail:", err);
    res.status(500).send("Error loading function detail");
  }
});


/* =========================================================
   📇 3. CONTACT MANAGEMENT (RESTFUL)
========================================================= */

// ✅ Fetch contact by ID
router.get("/:fnId/contacts/:contactId", async (req, res) => {
  const { contactId } = req.params;
  try {
    const { rows } = await pool.query("SELECT * FROM contacts WHERE id = $1", [contactId]);
    if (rows.length === 0) return res.status(404).json({ error: "Contact not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error fetching contact:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Fetch recent communications for contact
router.get("/:fnId/contacts/:contactId/communications", async (req, res) => {
  const { contactId } = req.params;
  try {
    const [messages, notes, tasks] = await Promise.all([
      pool.query(`
        SELECT id AS entry_id, 'message' AS entry_type, message_type, subject, body, from_email, to_email, created_at AS entry_date
        FROM messages
        WHERE related_contact = $1
      `, [contactId]),
      pool.query(`
        SELECT id AS entry_id, 'note' AS entry_type, note_type AS message_type, content AS body, created_at AS entry_date
        FROM function_notes
        WHERE function_id IN (SELECT function_id FROM function_contacts WHERE contact_id = $1)
      `, [contactId]),
      pool.query(`
        SELECT id AS entry_id, 'task' AS entry_type, status AS message_type, title AS subject, created_at AS entry_date
        FROM tasks
        WHERE function_id IN (SELECT function_id FROM function_contacts WHERE contact_id = $1)
      `, [contactId])
    ]);

    const rows = [...messages.rows, ...notes.rows, ...tasks.rows]
      .sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date))
      .slice(0, 10);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error loading contact communications:", err);
    res.status(500).json({ message: "Error loading communications" });
  }
});


// ✅ Link an existing contact
router.post("/:fnId/link-contact", async (req, res) => {
  const { fnId } = req.params;
  const { contact_id } = req.body;
  try {
    await pool.query(`
      INSERT INTO function_contacts (function_id, contact_id, is_primary, created_at)
      VALUES ($1, $2, false, NOW())
      ON CONFLICT DO NOTHING;
    `, [fnId, contact_id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error linking contact:", err);
    res.status(500).json({ success: false });
  }
});
// ✅ Fetch all contacts (for "Link Existing Contact" dropdown)
router.get("/api/contacts", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email FROM contacts ORDER BY name ASC;"
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Error loading contacts list:", err);
    res.status(500).json({ success: false, message: "Failed to load contacts" });
  }
});

// ✅ Add a new contact
router.post("/:fnId/new-contact", async (req, res) => {
  const { fnId } = req.params;
  const { name, email, phone, company } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, email, phone, company) VALUES ($1, $2, $3, $4) RETURNING id;`,
      [name, email, phone, company]
    );
    const contactId = rows[0].id;

    await pool.query(`
      INSERT INTO function_contacts (function_id, contact_id, is_primary, created_at)
      VALUES ($1, $2, false, NOW());
    `, [fnId, contactId]);

    res.json({ success: true, id: contactId });
  } catch (err) {
    console.error("❌ Error creating contact:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Remove a linked contact
router.post("/:fnId/remove-contact", async (req, res) => {
  const { fnId } = req.params;
  const { contact_id } = req.body;
  try {
    await pool.query(`DELETE FROM function_contacts WHERE function_id = $1 AND contact_id = $2;`, [fnId, contact_id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error removing contact:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Set a primary contact
router.post("/:fnId/set-primary", async (req, res) => {
  const { fnId } = req.params;
  const { contact_id } = req.body;
  try {
    await pool.query(`UPDATE function_contacts SET is_primary = false WHERE function_id = $1;`, [fnId]);
    await pool.query(`UPDATE function_contacts SET is_primary = true WHERE function_id = $1 AND contact_id = $2;`, [fnId, contact_id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error setting primary contact:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Delete a contact permanently
router.delete("/contacts/:id/delete", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM contacts WHERE id = $1;`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting contact:", err);
    res.status(500).json({ success: false });
  }
});
// ✅ Update an existing contact
router.post("/contacts/:id/update", async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, company } = req.body;
  try {
    await pool.query(
      `
      UPDATE contacts
      SET name = $1, email = $2, phone = $3, company = $4, updated_at = NOW()
      WHERE id = $5
      `,
      [name, email, phone, company, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error updating contact:", err);
    res.status(500).json({ success: false, message: "Failed to update contact" });
  }
});
// ======================================================
// 🧩 TASK MANAGEMENT ROUTES
// ======================================================
router.get("/:id/tasks", async (req, res) => {
  const { id } = req.params;

  try {
    // 1️⃣ Fetch function
    const { rows: fnRows } = await pool.query(
      `SELECT id, event_name, event_date, status, attendees, budget, totals_cost, totals_price, room_id, event_type 
       FROM functions WHERE id = $1;`,
      [id]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Fetch tasks
    const { rows: tasks } = await pool.query(
      `SELECT 
         t.*, 
         u.name AS assigned_user_name, 
         u.email AS assigned_user_email
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.function_id = $1
       ORDER BY t.created_at DESC;`,
      [id]
    );

    // 3️⃣ Sidebar data
    const linkedContactsRes = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
       FROM contacts c
       JOIN function_contacts fc ON fc.contact_id = c.id
       WHERE fc.function_id = $1
       ORDER BY fc.is_primary DESC, c.name ASC;`,
      [id]
    );

    const roomsRes = await pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`);
    const eventTypesRes = await pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`);

    // 4️⃣ Fetch all users for Assign dropdown
    const usersRes = await pool.query(`SELECT id, name FROM users ORDER BY name ASC;`);

    // 5️⃣ Render with full context
    res.render("pages/functions/tasks", {
      layout: "layouts/main",
      user: req.session.user || null,
      fn,
      tasks,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      users: usersRes.rows, // ✅ this now works properly
      activeTab: "tasks",
    });

  } catch (err) {
    console.error("❌ [Tasks GET] Error:", err);
    res.status(500).send("Failed to load tasks");
  }
});



// ✅ Create a new task (now includes `description`)
router.post("/:id/tasks/new", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, assigned_to, due_at } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO tasks (title, description, function_id, assigned_to, due_at, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'open', NOW())
       RETURNING *;`,
      [title, description || null, id, assigned_to || null, due_at || null]
    );

    const newTask = rows[0];

    // ✉️ Send email if user assigned
    if (assigned_to && req.session.graphToken) {
      const { rows: users } = await pool.query(
        `SELECT id, name, email FROM users WHERE id = $1`,
        [assigned_to]
      );

      const assignedUser = users[0];
      if (assignedUser && assignedUser.email) {
        try {
          await sendTaskAssignmentEmail(
            req.session.graphToken,
            newTask,
            assignedUser,
            req.session.user || { name: "System" }
          );
          console.log(`📧 Task assignment email sent to ${assignedUser.email}`);
        } catch (err) {
          console.error("⚠️ Failed to send assignment email:", err.message);
        }
      }
    }

    res.json({ success: true, task: newTask });
  } catch (err) {
    console.error("❌ [Tasks NEW] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Update or complete a task
router.post("/tasks/:taskId/update", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, description, assigned_to, due_at, status } = req.body;

    // Build a dynamic SQL update query based on which fields are sent
    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(title);
    }
    if (description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(description);
    }
    if (assigned_to !== undefined) {
      fields.push(`assigned_to = $${idx++}`);
      values.push(assigned_to);
    }
    if (due_at !== undefined) {
      fields.push(`due_at = $${idx++}`);
      values.push(due_at);
    }
    if (status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(status);
    }

    if (fields.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No fields to update" });
    }

    // Always update updated_at
    fields.push(`updated_at = NOW()`);

    values.push(taskId);

    const query = `
      UPDATE tasks
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *;
    `;

    const { rows } = await pool.query(query, values);
    res.json({ success: true, task: rows[0] });
  } catch (err) {
    console.error("❌ [Tasks UPDATE] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Delete a task
router.delete("/tasks/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    await pool.query(`DELETE FROM tasks WHERE id = $1;`, [taskId]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Tasks DELETE] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
/* =========================================================
   🕒 FUNCTION FIELD UPDATE (start_time / end_time etc.)
========================================================= */
router.post("/:id/update-field", async (req, res) => {
  const { id } = req.params;
  let { field, value } = req.body; // 👈 use let instead of const so we can modify value

  // ✅ Whitelist of safe, editable fields
  const allowed = [
    "start_time",
    "end_time",
    "event_date",
    "event_time",
    "status",
    "event_name",
    "event_type",
    "budget",
    "totals_price",
    "totals_cost",
    "notes",
    "room_id"
  ];

  if (!allowed.includes(field)) {
    return res.status(400).json({ success: false, error: "Invalid field name" });
  }

  // ✅ Normalize time format (e.g. "10:30" → "10:30:00")
  if (["start_time", "end_time"].includes(field) && value) {
    if (/^\d{2}:\d{2}$/.test(value)) {
      value = `${value}:00`;
    }
  }

  try {
    const query = `
      UPDATE functions 
      SET ${field} = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [value, id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Function not found" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("❌ [Function Field Update] Error:", err);
    res.status(500).json({ success: false, error: "Database update failed" });
  }
});


module.exports = router;