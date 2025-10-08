const express = require("express");
const router = express.Router();
const { pool } = require("../db");

// Simple test route to check database connectivity
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() as server_time");
    res.send(`<h3>✅ Connected to Supabase!</h3>
              <p>Server time: ${result.rows[0].server_time}</p>`);
  } catch (err) {
    console.error("❌ Database connection failed:", err);
    res.status(500).send(`<h3>❌ Database connection failed:</h3><pre>${err.message}</pre>`);
  }
});

module.exports = router;
