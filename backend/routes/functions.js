const express = require("express");
const { pool } = require("../db");
const router = express.Router();

// ✅ Ensure JSON body parsing
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

    res.render("pages/functions", {
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
});/* =========================================================
   💬 2A. FUNCTION COMMUNICATIONS VIEW
========================================================= */
router.get("/:id/communications", async (req, res, next) => {
  try {
    const { id } = req.params;
    const activeTab = "communications";

    const { rows: fnRows } = await pool.query(`
      SELECT f.id, f.event_name, u.name AS owner_name
      FROM functions f
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.id = $1;
    `, [id]);
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    const [messages, notes, tasks] = await Promise.all([
      pool.query(`
        SELECT id AS entry_id, 'message' AS entry_type, message_type, subject, body, from_email, to_email, created_by, created_at AS entry_date
        FROM messages
        WHERE related_function = $1
      `, [id]),
      pool.query(`
        SELECT id AS entry_id, 'note' AS entry_type, note_type AS message_type, content AS body, created_at AS entry_date
        FROM function_notes
        WHERE function_id = $1
      `, [id]),
      pool.query(`
        SELECT id AS entry_id, 'task' AS entry_type, status AS message_type, title AS subject, created_at AS entry_date
        FROM tasks
        WHERE function_id = $1 OR related_function_id = $1
      `, [id])
    ]);

    const comms = [
      ...messages.rows,
      ...notes.rows,
      ...tasks.rows
    ].sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date));

    const grouped = {};
    for (const c of comms) {
      const date = new Date(c.entry_date).toLocaleDateString("en-NZ", {
        year: "numeric", month: "short", day: "numeric"
      });
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(c);
    }

    res.render("pages/function-communications", {
      title: `Communications — ${fn.event_name}`,
      active: "functions",
      activeTab,
      user: req.session.user || null,
      fn,
      grouped,
    });
  } catch (err) {
    console.error("❌ Error loading communications:", err);
    next(err);
  }
});
/* =========================================================
   🗒️ NOTES ROUTES
========================================================= */
router.get("/:id/notes", async (req, res) => {
  const { id } = req.params;

  try {
    // ✅ Fetch the parent function name
    const fnRes = await pool.query(
      `SELECT id, event_name FROM functions WHERE id = $1;`,
      [id]
    );
    const fn = fnRes.rows[0];
    if (!fn) return res.status(404).send("Function not found");

    // ✅ Fetch notes with author name and updated timestamp
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

    res.render("pages/function-notes", {
      fn,
      notes,
      activeTab: "notes",
      user: req.session.user
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
   🧭 2. FUNCTION DETAIL VIEW
========================================================= */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const activeTab = req.query.tab || "info";

    const { rows: fnRows } = await pool.query(`
      SELECT f.*, r.name AS room_name, u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.id = $1;
    `, [id]);

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // ✅ Load related data concurrently
    const [linkedContacts, notes, tasks, messages] = await Promise.all([
      pool.query(`
        SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
        FROM function_contacts fc
        JOIN contacts c ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;
      `, [id]),

      // 🗒️ Notes (function-level only)
      pool.query(`
        SELECT 
          n.id AS entry_id,
          'note' AS entry_type,
          n.function_id,
          n.contact_id,
          n.note_type,
          n.content AS body,
          n.created_at AS entry_date,
          n.updated_at,
          u.name AS author
        FROM function_notes n
        LEFT JOIN users u ON u.id = n.created_by
        WHERE n.function_id = $1
          AND n.contact_id IS NULL
        ORDER BY n.created_at DESC;
      `, [id]),

      // ✅ Tasks
  pool.query(`
  SELECT t.*, u.name AS assigned_to_name
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assigned_to
  WHERE t.function_id = $1
  ORDER BY t.created_at DESC;
`, [id]),


      // ✅ Messages
      pool.query(`
        SELECT id AS entry_id, 'message' AS entry_type, message_type, subject, body,
               from_email, to_email, created_at AS entry_date
        FROM messages
        WHERE related_function = $1;
      `, [id])
    ]);

    const communications = [
      ...messages.rows,
      ...notes.rows,
      ...tasks.rows
    ].sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date));

    // ✅ Render page
    res.render("pages/function-detail", {
      title: fn.event_name,
      active: "functions",
      user: req.session.user || null,
      fn,
      linkedContacts: linkedContacts.rows,
      notes: notes.rows,
      tasks: tasks.rows,
      communications,
      activeTab,
    });

  } catch (err) {
    console.error("❌ Error loading function detail:", err);
    next(err);
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
const { sendTaskAssignmentEmail } = require("../services/taskMailer");


// ✅ Get tasks for a function (with function name)
router.get("/:id/tasks", async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Fetch the function’s name
    const { rows: fnRows } = await pool.query(
      `SELECT id, event_name, event_date FROM functions WHERE id = $1`,
      [id]
    );
    const fn = fnRows[0] || { id, event_name: "Function" };

    // 2️⃣ Fetch the tasks
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

    // 3️⃣ Render page with function info
    res.render("pages/function-tasks", {
      user: req.session.user,
      fn,
      tasks,
      activeTab: "tasks",
    });
  } catch (err) {
    console.error("❌ [Tasks GET] Error:", err);
    res.status(500).send("Failed to load tasks");
  }
});


// ✅ Create a new task (fixed for your schema)
router.post("/:id/tasks/new", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, assigned_to, due_at } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO tasks (title, function_id, assigned_to, due_at, status, created_at)
       VALUES ($1, $2, $3, $4, 'open', NOW())
       RETURNING *;`,
      [title, id, assigned_to || null, due_at || null]
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
          const { sendTaskAssignmentEmail } = require("../services/taskMailer");
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

    const { rows } = await pool.query(
      `UPDATE tasks
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           assigned_to = COALESCE($3, assigned_to),
           due_at = COALESCE($4, due_at),
           status = COALESCE($5, status),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *;`,
      [title, description, assigned_to, due_at, status, taskId]
    );

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
// ✅ Update or complete a task
router.post("/tasks/:taskId/update", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, assigned_to, due_at, status } = req.body;

    // Build a dynamic SQL update query based on which fields are sent
    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(title);
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
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

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

module.exports = router;




