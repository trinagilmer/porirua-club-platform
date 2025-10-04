const express = require("express");
const pool = require("../db");
const { format } = require("date-fns");
const { requireLogin } = require("../middleware/authMiddleware");

const router = express.Router();

// View or edit a single function
router.get("/:id", requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Main event details
    const { rows: funcRows } = await pool.query(`
      SELECT f.*, r.name AS room_name, u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON r.id = f.room_id
      LEFT JOIN users u ON u.id = f.owner_id
      WHERE f.id = $1
    `, [id]);

    if (!funcRows.length) return res.status(404).send("Function not found");
    const fn = funcRows[0];

    fn.event_date_str = fn.event_date ? format(fn.event_date, "yyyy-MM-dd") : "";

    // Fetch related info (tasks, items, documents, etc.)
    const { rows: tasks } = await pool.query(`SELECT * FROM tasks WHERE function_id = $1 ORDER BY due_at ASC`, [id]);
    const { rows: items } = await pool.query(`SELECT * FROM function_items WHERE function_id = $1`, [id]);
    const { rows: docs } = await pool.query(`SELECT * FROM documents WHERE function_id = $1 ORDER BY created_at DESC`, [id]);

    res.render("pages/function_detail", {
      title: "Edit Function",
      active: "functions",
      user: req.session.user || null,
      fn,
      tasks,
      items,
      docs
    });
  } catch (err) {
    next(err);
  }
});

// Update event (POST)
router.post("/:id/update", requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { event_name, status, event_date, event_time, attendees, room_id, totals_price, notes } = req.body;

    await pool.query(`
      UPDATE functions
      SET event_name = $1, status = $2, event_date = $3, event_time = $4,
          attendees = $5, room_id = $6, totals_price = $7, notes = $8
      WHERE id = $9
    `, [event_name, status, event_date, event_time, attendees, room_id, totals_price, notes, id]);

    res.redirect(`/function/${id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

