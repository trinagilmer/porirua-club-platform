const express = require("express");
const pool = require("../db");
const { format } = require("date-fns");
const { requireLogin } = require("../middleware/authMiddleware");

const router = express.Router();

// Functions Dashboard
// router.get("/", requireLogin, async (req, res, next) => {
router.get("/", async (req, res, next) => {


  try {
    const userId = req.session.user?.id;
    const statusFilter = req.query.status || "active";
    const myOnly = req.query.mine === "true";

    // Determine which statuses to include
    const statusMap = {
      active: ["lead", "qualified", "confirmed", "balance_due"],
      lead: ["lead"],
      qualified: ["qualified"],
      confirmed: ["confirmed"],
      balance_due: ["balance_due"],
      completed: ["completed"]
    };
    const statuses = statusMap[statusFilter] || statusMap.active;

    // Query functions
    let sql = `
      SELECT f.id, f.event_name, f.status, f.event_date, f.event_time,
             f.attendees, f.totals_price, f.last_contacted_at, f.created_at,
             r.name AS room_name, u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON u.id = f.owner_id
      WHERE f.status = ANY($1)
      ORDER BY f.event_date ASC
    `;

    const params = [statuses];
    if (myOnly) {
      sql = sql.replace("ORDER BY", "AND f.owner_id = $2 ORDER BY");
      params.push(userId);
    }

    const { rows: events } = await pool.query(sql, params);

    events.forEach(e => {
      e.event_date_str = e.event_date ? format(e.event_date, "yyyy-MM-dd") : "";
      e.last_contacted_str = e.last_contacted_at
        ? format(e.last_contacted_at, "yyyy-MM-dd")
        : "";
      e.created_str = e.created_at ? format(e.created_at, "yyyy-MM-dd") : "";
    });

    // Totals for top bar
    const { rows: totals } = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status='lead' THEN totals_price ELSE 0 END),0) AS lead_value,
        COALESCE(SUM(CASE WHEN status='qualified' THEN totals_price ELSE 0 END),0) AS qualified_value,
        COALESCE(SUM(CASE WHEN status='confirmed' THEN totals_price ELSE 0 END),0) AS confirmed_value,
        COALESCE(SUM(CASE WHEN status='balance_due' THEN totals_price ELSE 0 END),0) AS balance_due_value,
        COALESCE(SUM(CASE WHEN status='completed' THEN totals_price ELSE 0 END),0) AS completed_value
      FROM functions
    `);

    res.render("pages/functions", {
      title: "Functions Dashboard",
      active: "functions",
      user: req.session.user || null,
      statusFilter,
      events,
      totals: totals[0],
      myOnly
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
