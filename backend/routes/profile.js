const express = require("express");
const { pool } = require("../db");

const router = express.Router();

async function ensureUserLandingColumn() {
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_landing TEXT;");
}

function getLandingOptions() {
  return [
    { value: "/dashboard", label: "Dashboard" },
    { value: "/functions", label: "Functions" },
    { value: "/calendar", label: "Calendar" },
    { value: "/inbox", label: "Inbox" },
    { value: "/contacts", label: "Contacts" },
    { value: "/tasks", label: "Tasks" },
    { value: "/reports", label: "Reports" },
    { value: "/settings", label: "Settings" },
    { value: "/dashboard/restaurant", label: "Restaurant dashboard" },
    { value: "/dashboard/events", label: "Club events dashboard" },
  ];
}

function normalizeLanding(value) {
  const allowed = new Set(getLandingOptions().map((opt) => opt.value));
  const cleaned = String(value || "").trim();
  return allowed.has(cleaned) ? cleaned : null;
}

router.get("/", async (req, res) => {
  try {
    await ensureUserLandingColumn();
    const userId = req.session.user?.id;
    const { rows } = await pool.query(
      `SELECT id, name, email, role, default_landing FROM users WHERE id = $1 LIMIT 1;`,
      [userId]
    );
    const profile = rows[0];
    res.render("pages/profile", {
      layout: "layouts/main",
      title: "My Profile",
      active: "",
      user: req.session.user || null,
      profile,
      landingOptions: getLandingOptions(),
    });
  } catch (err) {
    console.error("[Profile] Failed to load profile:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load profile.",
      error: err.message,
      stack: err.stack,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureUserLandingColumn();
    const userId = req.session.user?.id;
    const name = (req.body.name || "").trim();
    const defaultLanding = normalizeLanding(req.body.default_landing);
    if (!name) {
      req.flash("flashMessage", "Name is required.");
      req.flash("flashType", "warning");
      return res.redirect("/profile");
    }
    await pool.query(
      `UPDATE users SET name = $1, default_landing = $2 WHERE id = $3;`,
      [name, defaultLanding, userId]
    );
    req.session.user.name = name;
    req.flash("flashMessage", "Profile updated.");
    req.flash("flashType", "success");
    res.redirect("/profile");
  } catch (err) {
    console.error("[Profile] Failed to update profile:", err);
    req.flash("flashMessage", "Failed to update profile.");
    req.flash("flashType", "error");
    res.redirect("/profile");
  }
});

module.exports = router;
