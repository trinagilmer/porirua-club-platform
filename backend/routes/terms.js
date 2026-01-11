const express = require("express");
const { pool } = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, name, COALESCE(content, terms_and_conditions, '') AS content, is_default
        FROM proposal_settings
       ORDER BY is_default DESC, id ASC;
      `
    );
    const defaultTerm = rows.find((row) => row.is_default) || rows[0] || null;
    if (!defaultTerm || !defaultTerm.content) {
      return res.status(404).render("pages/terms", {
        layout: false,
        title: "Terms and Conditions",
        termsTitle: "Terms and Conditions",
        termsHtml: "<p>Terms are not available yet. Please check back later.</p>",
      });
    }

    res.render("pages/terms", {
      layout: false,
      title: defaultTerm.name || "Terms and Conditions",
      termsTitle: defaultTerm.name || "Terms and Conditions",
      termsHtml: defaultTerm.content,
    });
  } catch (err) {
    console.error("[Terms] Failed to load terms:", err);
    res.status(500).render("pages/terms", {
      layout: false,
      title: "Terms and Conditions",
      termsTitle: "Terms and Conditions",
      termsHtml: "<p>Unable to load terms at the moment.</p>",
    });
  }
});

module.exports = router;
