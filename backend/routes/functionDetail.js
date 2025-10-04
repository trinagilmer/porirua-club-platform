const express = require("express");
const pool = require("../db");
const router = express.Router();

/**
 * 🧭 GET: Function Detail View (main view page)
 * URL: /functions/:id
 */
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // --- Fetch the main function record ---
    const { rows: fnRows } = await pool.query(
      `SELECT * FROM functions WHERE id = $1`,
      [id]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // --- Fetch related subtables ---
    const { rows: items } = await pool.query(
      `SELECT * FROM function_items WHERE function_id = $1 ORDER BY id ASC`,
      [id]
    );

    const { rows: tasks } = await pool.query(
      `SELECT * FROM tasks WHERE function_id = $1 ORDER BY due_at ASC`,
      [id]
    );

    const { rows: documents } = await pool.query(
      `SELECT * FROM documents WHERE function_id = $1 ORDER BY uploaded_at DESC`,
      [id]
    );

    // --- Render the view ---
    res.render("pages/function_detail", {
      title: "Function Details",
      active: "functions",
      user: req.session.user,
      fn,
      items,
      tasks,
      documents,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 🧭 GET: Edit function main info
 * URL: /functions/:id/edit
 */
router.get("/:id/edit", async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM functions WHERE id = $1`,
      [id]
    );
    const fn = rows[0];
    if (!fn) return res.status(404).send("Function not found");

    res.render("pages/function-edit", {
      title: "Edit Function",
      active: "functions",
      user: req.session.user,
      fn,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 🧭 POST: Save edited function main info
 */
router.post("/:id/edit", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      event_name,
      event_date,
      event_time,
      attendees,
      totals_price,
      totals_cost,
      status,
    } = req.body;

    await pool.query(
      `UPDATE functions
       SET event_name=$1, event_date=$2, event_time=$3, attendees=$4,
           totals_price=$5, totals_cost=$6, status=$7
       WHERE id=$8`,
      [
        event_name,
        event_date,
        event_time,
        attendees,
        totals_price,
        totals_cost,
        status,
        id,
      ]
    );

    res.redirect(`/functions/${id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;



