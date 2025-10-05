const express = require("express");
const pool = require("../db");
const { format } = require("date-fns");

const router = express.Router();

/* =========================================================
   🧭 1. FUNCTIONS DASHBOARD
========================================================= */
router.get("/", async (req, res, next) => {
  try {
    const userId = req.session.user?.id || null;
    const statusFilter = req.query.status || "active";
    const myOnly = req.query.mine === "true";

    // Define group filters
    const statusGroups = {
      active: ["lead", "qualified", "confirmed", "balance_due"],
      lead: ["lead"],
      qualified: ["qualified"],
      confirmed: ["confirmed"],
      balance_due: ["balance_due"],
      completed: ["completed"],
    };

    const statuses = statusGroups[statusFilter] || statusGroups.active;

    // Fetch functions list
    let sql = `
      SELECT f.*, 
             r.name AS room_name, 
             u.name AS owner_name,
             c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone
      FROM public.functions f
      LEFT JOIN public.rooms r ON f.room_id = r.id
      LEFT JOIN public.users u ON f.owner_id = u.id
      LEFT JOIN public.contacts c ON f.contact_id = c.id
      WHERE f.status = ANY($1)
      ORDER BY f.event_date ASC;
    `;

    const params = [statuses];
    if (myOnly) {
      sql = sql.replace("ORDER BY", "AND f.owner_id = $2 ORDER BY");
      params.push(userId);
    }

    const { rows: events } = await pool.query(sql, params);
    
    events.forEach(e => {
      e.totals_price = e.totals_price ? parseFloat(e.totals_price) : 0;
      });

    // KPI Totals
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
   🧭 2. FUNCTION DETAIL VIEW
========================================================= */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch main function
    const { rows: fnRows } = await pool.query(
      `
      SELECT f.*, 
             r.name AS room_name,
             u.name AS owner_name,
             c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone, c.company AS contact_company
      FROM public.functions f
      LEFT JOIN public.rooms r ON f.room_id = r.id
      LEFT JOIN public.users u ON f.owner_id = u.id
      LEFT JOIN public.contacts c ON f.contact_id = c.id
      WHERE f.id = $1;
      `,
      [id]
    );

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // Notes
    const { rows: notes } = await pool.query(
      `
      SELECT id, note_type, content, created_at
      FROM public.function_notes
      WHERE function_id = $1
      ORDER BY created_at DESC;
      `,
      [id]
    );

    // Tasks
    const { rows: tasks } = await pool.query(
      `
      SELECT t.id, t.title, t.status, t.due_at, u.name AS assignee
      FROM public.tasks t
      LEFT JOIN public.users u ON t.assigned_user_id = u.id
      WHERE t.function_id = $1
      ORDER BY t.due_at ASC;
      `,
      [id]
    );

    // Documents
    const { rows: docs } = await pool.query(
      `
      SELECT id, file_name, file_url, uploaded_at
      FROM public.documents
      WHERE function_id = $1
      ORDER BY uploaded_at DESC;
      `,
      [id]
    );

    res.render("pages/function-detail", {
      title: fn.event_name,
      active: "functions",
      user: req.session.user || null,
      fn,
      notes,
      tasks,
      docs,
    });
  } catch (err) {
    console.error("❌ Error loading function detail:", err);
    next(err);
  }
});

module.exports = router;
