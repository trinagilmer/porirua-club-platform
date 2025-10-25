// backend/routes/index.js
const express = require("express");
const router = express.Router();

// 🏠 Root route — redirect to dashboard or homepage
router.get("/", (req, res) => {
  res.redirect("/dashboard");
});

module.exports = router;

