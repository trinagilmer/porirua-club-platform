const express = require("express");
const pool = require("../db");
const router = express.Router();

// 🧭 GET: Edit function view
router.get("/:id/edit", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Fetch function details
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

// 🧭 POST: Save edited function
router.post("/:id/edit", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { event_name, event_date, event_time, attendees, totals_price, totals_cost, status } = req.body;

    await pool.query(
      `UPDATE functions 
       SET event_name=$1, event_date=$2, event_time=$3, attendees=$4, 
           totals_price=$5, totals_cost=$6, status=$7 
       WHERE id=$8`,
      [event_name, event_date, event_time, attendees, totals_price, totals_cost, status, id]
    );

    res.redirect("/functions");
  } catch (err) {
    next(err);
  }
});

module.exports = router;


