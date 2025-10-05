const express = require("express");
const pool = require("../db");

const router = express.Router();

/* =========================================================
   🧭 1. FUNCTIONS DASHBOARD (with multi-contact support)
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
                   'phone', c.phone
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

    // Compute totals safely
    events.forEach(e => {
      e.totals_price = e.totals_price ? parseFloat(e.totals_price) : 0;
    });

    // KPI summary
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
    next(err);
  }
});

/* =========================================================
   🧭 2. FUNCTION DETAIL VIEW (multi-contact enabled)
========================================================= */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Primary function data
    const { rows: fnRows } = await pool.query(`
      SELECT f.*, r.name AS room_name, u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.id = $1;
    `, [id]);

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // All linked contacts
    const { rows: linkedContacts } = await pool.query(`
      SELECT c.id, c.name, c.email, c.phone, c.company
      FROM function_contacts fc
      JOIN contacts c ON fc.contact_id = c.id
      WHERE fc.function_id = $1
      ORDER BY c.name ASC;
    `, [id]);

    // Notes, tasks, docs (as before)
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

    // All contacts for dropdown
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
   🧭 3. CONTACT MANAGEMENT (multi-link logic)
========================================================= */

// Link existing contact
router.post("/:id/link-contact", async (req, res, next) => {
  const { id } = req.params;
  const { contact_id } = req.body;
  try {
    await pool.query(`
      INSERT INTO function_contacts (function_id, contact_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING;
    `, [id, contact_id]);
    res.redirect(`/functions/${id}`);
  } catch (err) {
    console.error("Error linking contact:", err);
    next(err);
  }
});

// Add new contact + link
router.post("/:id/new-contact", async (req, res, next) => {
  const { id } = req.params;
  const { name, email, phone, company } = req.body;
  try {
    const { rows: [newContact] } = await pool.query(`
      INSERT INTO contacts (id, name, email, phone, company, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
      RETURNING id;
    `, [name, email, phone, company]);

    await pool.query(`
      INSERT INTO function_contacts (function_id, contact_id)
      VALUES ($1, $2);
    `, [id, newContact.id]);

    res.redirect(`/functions/${id}`);
  } catch (err) {
    console.error("Error adding new contact:", err);
    next(err);
  }
});

module.exports = router;

