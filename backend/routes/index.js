const express = require("express");
const router = express.Router();

// Redirect root to main dashboard
router.get("/", (req, res) => {
  res.redirect("/dashboard");
});

module.exports = router;

