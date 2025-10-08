// backend/routes/health.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db"); // use your shared db connection

router.get("/db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS time;");
    res.json({
      status: "healthy",
      message: "✅ Database connection OK",
      serverTime: result.rows[0].time,
    });
  } catch (err) {
    console.error("💥 DB Health Check Failed:", err.message);
    res.status(500).json({
      status: "unhealthy",
      message: "❌ Database connection failed",
      error: err.message,
    });
  }
});
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "✅ Porirua Club Platform backend is running",
    uptime: process.uptime(),
  });
});
module.exports = router;
