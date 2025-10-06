const express = require("express");
const pool = require("../db");
const router = express.Router();

// ✅ Ensure all fetch() calls sending JSON work
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
      SELECT f.*,
             r.name AS room_name,
             u.name AS owner_name,
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

    // Normalize totals
    events.forEach(e => {
      e.totals_price = e.totals_price ? parseFloat(e.totals_price) : 0;
    });

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
});

/* =========================================================
   🧭 2. FUNCTION DETAIL VIEW
========================================================= */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows: fnRows } = await pool.query(`
      SELECT f.*, r.name AS room_name, u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.id = $1;
    `, [id]);

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    const { rows: linkedContacts } = await pool.query(`
      SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
      FROM function_contacts fc
      JOIN contacts c ON fc.contact_id = c.id
      WHERE fc.function_id = $1
      ORDER BY fc.is_primary DESC, c.name ASC;
    `, [id]);

    const { rows: notes } = await pool.query(`
      SELECT id, note_type, content, created_at
      FROM function_notes
      WHERE function_id = $1
      ORDER BY created_at DESC;
    `, [id]);

    const { rows: tasks } = await pool.query(`
      SELECT t.id, t.title, t.status, t.due_at, u.name AS assignee
      FROM tasks t
      LEFT JOIN users u ON t.assigned_user_id = u.id
      WHERE t.function_id = $1
      ORDER BY t.due_at ASC;
    `, [id]);

    const { rows: docs } = await pool.query(`
      SELECT id, file_name, file_url, uploaded_at
      FROM documents
      WHERE function_id = $1
      ORDER BY uploaded_at DESC;
    `, [id]);

    const { rows: contacts } = await pool.query(`
      SELECT id, name, email FROM contacts ORDER BY name ASC;
    `);

    res.render("pages/function-detail", {
      title: fn.event_name,
      active: "functions",
      user: req.session.user || null,
      fn,
      notes,
      tasks,
      docs,
      contacts,
      linkedContacts,
    });
  } catch (err) {
    console.error("❌ Error loading function detail:", err);
    next(err);
  }
});
/* =========================================================
   🧭  FUNCTION COMMUNICATIONS TIMELINE
========================================================= */
router.get("/:id/communications", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch all communications for this function
    const { rows: comms } = await pool.query(`
      SELECT entry_type, entry_id, subject, body, from_email, to_email,
             message_type, entry_date, created_at
      FROM unified_communications
      WHERE related_function = $1
      ORDER BY entry_date DESC;
    `, [id]);

    // Assign grouping category
    const groupedArray = comms.map(item => {
      if (item.message_type === 'auto') return { ...item, group: 'Automated Messages' };
      if (['inbound', 'outbound'].includes(item.message_type)) return { ...item, group: 'Messages' };
      if (item.entry_type === 'note') return { ...item, group: 'Notes' };
      return { ...item, group: 'Other' };
    });

    // Fetch function info for header
    const { rows: fnRows } = await pool.query(`
      SELECT id, event_name, status, event_date
      FROM functions
      WHERE id = $1;
    `, [id]);

    const fn = fnRows[0] || { id, event_name: `Function #${id}` };

    res.render("pages/function-communications", {
      title: `${fn.event_name} — Communications`,
      active: "functions",
      user: req.session.user || null,
      fn,
      groupedArray
    });

  } catch (err) {
    console.error("❌ Error loading communications:", err);
    next(err);
  }
});


/* =========================================================
   🧭 3. CONTACT MANAGEMENT ROUTES
========================================================= */

// Link existing contact ✅ now returns JSON instead of redirect
router.post("/:id/link-contact", async (req, res) => {
  const { id } = req.params;
  const { contact_id } = req.body;
  try {
    await pool.query(`
      INSERT INTO function_contacts (function_id, contact_id, is_primary, created_at)
      VALUES ($1, $2, false, NOW())
      ON CONFLICT DO NOTHING;
    `, [id, contact_id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error linking contact:", err);
    res.status(500).json({ success: false });
  }
});

// Add new contact + link
router.post("/:id/new-contact", async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, company } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (id, name, email, phone, company, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       RETURNING id;`,
      [name, email, phone, company]
    );
    const contact_id = rows[0].id;
    await pool.query(
      `INSERT INTO function_contacts (function_id, contact_id, is_primary, created_at)
       VALUES ($1, $2, false, NOW())`,
      [id, contact_id]
    );
    res.json({ success: true, contact_id });
  } catch (err) {
    console.error("❌ Error adding contact:", err);
    res.status(500).json({ success: false });
  }
});

// Remove contact
router.post("/:id/remove-contact", async (req, res) => {
  const { id } = req.params;
  const { contact_id } = req.body;
  try {
    await pool.query(`DELETE FROM function_contacts WHERE function_id=$1 AND contact_id=$2`, [id, contact_id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error removing contact:", err);
    res.status(500).json({ success: false });
  }
});

// Set primary
router.post("/:id/set-primary", async (req, res) => {
  const { id } = req.params;
  const { contact_id } = req.body;
  try {
    await pool.query(`UPDATE function_contacts SET is_primary=false WHERE function_id=$1`, [id]);
    await pool.query(`UPDATE function_contacts SET is_primary=true WHERE function_id=$1 AND contact_id=$2`, [id, contact_id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error setting primary:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================================================
   🧭 EDIT CONTACT DETAILS
========================================================= */
router.post("/contacts/:id/update", async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, company } = req.body;

  try {
    await pool.query(
      `UPDATE contacts
       SET name = $1, email = $2, phone = $3, company = $4
       WHERE id = $5`,
      [name, email, phone, company, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error updating contact:", err);
    res.status(500).json({ success: false, message: "Error updating contact" });
  }
});

/* =========================================================
   🧭 DELETE CONTACT
========================================================= */
router.delete("/contacts/:id/delete", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM function_contacts WHERE contact_id = $1`, [id]);
    await pool.query(`DELETE FROM contacts WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting contact:", err);
    res.status(500).json({ success: false, message: "Error deleting contact" });
  }
});

/* =========================================================
   🧭 GET SINGLE CONTACT (for View)
========================================================= */
router.get("/contacts/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, company, created_at
       FROM contacts WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error loading contact:", err);
    res.status(500).json({ message: "Error loading contact" });
  }
});


// Fetch all contacts (for search)
router.get("/api/contacts", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, name, email FROM contacts ORDER BY name ASC`);
    res.json(rows);
  } catch (err) {
    console.error("❌ Error loading contacts:", err);
    res.status(500).json({ message: "Error loading contacts" });
  }
});

module.exports = router;


