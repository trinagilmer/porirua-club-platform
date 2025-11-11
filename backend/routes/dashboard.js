/**
 * 📊 Dashboard Route – Fixed for UUID migration
 * Uses functions.id_uuid instead of functions.id
 */
const express = require("express");
const { pool } = require("../db");
const router = express.Router();

// DASHBOARD ROUTE
router.get("/", async (req, res, next) => {
  try {
    // 1️⃣ --- KPIs ---
    const { rows: kpiRows } = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(f.status, fs.name) IN ('confirmed','balance_due','completed')
                          THEN f.totals_price ELSE 0 END),0) AS confirmed_price,
        COALESCE(SUM(CASE WHEN COALESCE(f.status, fs.name) IN ('confirmed','balance_due','completed')
                          THEN f.totals_cost ELSE 0 END),0) AS confirmed_cost,
        COALESCE(SUM(CASE WHEN COALESCE(f.status, fs.name) IN ('lead','qualified')
                          THEN f.totals_price ELSE 0 END),0) AS pipeline_price,
        COUNT(*) FILTER (WHERE COALESCE(f.status, fs.name) IN ('lead','qualified')) AS pipeline_count
      FROM functions f
      LEFT JOIN function_statuses fs ON f.status_id = fs.id
    `);

    const kpis = kpiRows[0];

    // 2️⃣ --- Revenue Trend (last 12 months) ---
    const { rows: revenueRows } = await pool.query(`
      SELECT to_char(date_trunc('month', event_date), 'YYYY-MM') AS ym,
             SUM(totals_price) AS revenue
      FROM functions f
      LEFT JOIN function_statuses fs ON f.status_id = fs.id
      WHERE COALESCE(f.status, fs.name) IN ('confirmed','balance_due','completed')
        AND event_date >= (CURRENT_DATE - INTERVAL '12 months')
      GROUP BY ym
      ORDER BY ym ASC
    `);

    const graph = {
      labels: revenueRows.map(r => r.ym),
      data: revenueRows.map(r => parseFloat(r.revenue || 0))
    };

    // 3️⃣ --- Upcoming Functions (next 30 days) ---
    const { rows: upcoming } = await pool.query(`
      SELECT 
        f.id_uuid AS id,              -- ✅ switched from f.id
        f.event_name, 
        COALESCE(f.status, fs.name) AS status, 
        f.event_date, 
        f.event_time,
        f.attendees, 
        f.totals_price, 
        r.name AS room_name
      FROM functions f
      LEFT JOIN function_statuses fs ON f.status_id = fs.id
      LEFT JOIN rooms r ON r.id = f.room_id
      WHERE f.event_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
      ORDER BY f.event_date ASC
      LIMIT 10
    `);

    // 4️⃣ --- Recent Leads ---
    const { rows: leads } = await pool.query(`
      SELECT 
        f.id_uuid AS id,              -- ✅ switched from f.id
        f.event_name AS client_name, 
        f.event_date, 
        fs.name AS status
      FROM functions f
      LEFT JOIN function_statuses fs ON f.status_id = fs.id
      WHERE COALESCE(f.status, fs.name) IN ('lead','qualified')
      ORDER BY f.created_at DESC
      LIMIT 10
    `);

    // 5️⃣ --- My Tasks (open) ---
    const { rows: tasks } = await pool.query(`
      SELECT 
        t.id, 
        t.title, 
        t.status, 
        t.due_at, 
        u.name AS assignee
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_user_id
      WHERE t.status = 'open'
      ORDER BY t.due_at NULLS LAST, t.created_at ASC
      LIMIT 10
    `);

    // ✅ Render dashboard
    res.render("pages/dashboard", {
      title: "Dashboard",
      active: "dashboard",
      kpis,
      graph,
      upcoming,
      leads,
      tasks,
      from: req.query.from || "",
      to: req.query.to || "",
      user: req.session.user || null
    });

  } catch (err) {
    console.error("Dashboard error:", err);
    next(err);
  }
});

module.exports = router;

