const express = require("express");
const bcrypt = require("bcrypt");
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

router.post("/password", async (req, res) => {
  try {
    const userId = req.session.user?.id;
    const currentPassword = String(req.body.current_password || "");
    const newPassword = String(req.body.new_password || "");
    const confirmPassword = String(req.body.confirm_password || "");
    if (!currentPassword || !newPassword || !confirmPassword) {
      req.flash("flashMessage", "All password fields are required.");
      req.flash("flashType", "warning");
      return res.redirect("/profile");
    }
    if (newPassword.length < 8) {
      req.flash("flashMessage", "New password must be at least 8 characters.");
      req.flash("flashType", "warning");
      return res.redirect("/profile");
    }
    if (newPassword !== confirmPassword) {
      req.flash("flashMessage", "New passwords do not match.");
      req.flash("flashType", "warning");
      return res.redirect("/profile");
    }
    const { rows: columnRows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND table_schema = 'public';`
    );
    const columns = columnRows.map((r) => r.column_name);
    if (!columns.includes("password_hash")) {
      req.flash("flashMessage", "Password updates are not available for this account type.");
      req.flash("flashType", "warning");
      return res.redirect("/profile");
    }
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1 LIMIT 1;`, [
      userId,
    ]);
    const user = rows[0];
    const valid = user?.password_hash ? await bcrypt.compare(currentPassword, user.password_hash) : false;
    if (!valid) {
      req.flash("flashMessage", "Current password is incorrect.");
      req.flash("flashType", "error");
      return res.redirect("/profile");
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2;`, [hash, userId]);
    req.flash("flashMessage", "Password updated.");
    req.flash("flashType", "success");
    res.redirect("/profile");
  } catch (err) {
    console.error("[Profile] Failed to update password:", err);
    req.flash("flashMessage", "Failed to update password.");
    req.flash("flashType", "error");
    res.redirect("/profile");
  }
});

module.exports = router;
