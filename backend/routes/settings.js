/**
 * =========================================================
 * ⚙️ Settings Routes
 * Organized per-section (Overview, Event Types, Spaces)
 * =========================================================
 */

const express = require("express");
const router = express.Router();
const { pool } = require("../db");

/* =========================================================
   🧭 BASE REDIRECT — /settings → /settings/overview
========================================================= */
router.get("/", (req, res) => res.redirect("/settings/overview"));

/* =========================================================
   🧩 SETTINGS OVERVIEW
========================================================= */
router.get("/overview", async (req, res) => {
  try {
    const { rows: eventTypes } = await pool.query("SELECT COUNT(*) FROM club_event_types;");
    const { rows: rooms } = await pool.query("SELECT COUNT(*) FROM rooms;");

    res.render("settings/index", {
      layout: "layouts/settings",
      title: "Settings Overview",
      pageType: "settings",
      activeTab: "overview",
      counts: {
        eventTypes: eventTypes[0].count || 0,
        rooms: rooms[0].count || 0,
      },
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ Error loading settings overview:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load settings overview.",
    });
  }
});

/* =========================================================
   ⚙️ SETTINGS: EVENT TYPES
========================================================= */
router.get("/event-types", async (req, res) => {
  try {
    const { rows: eventTypes } = await pool.query(
      "SELECT * FROM club_event_types ORDER BY name ASC;"
    );

    res.render("settings/event-types", {
      layout: "layouts/settings",
      title: "Settings — Event Types",
      pageType: "settings",
      activeTab: "event-types",
      eventTypes,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ Error loading event types:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load event types.",
    });
  }
});

/* =========================================================
   ⚙️ SETTINGS: ROOMS / SPACES
========================================================= */
router.get("/spaces", async (req, res) => {
  try {
    const { rows: rooms } = await pool.query("SELECT * FROM rooms ORDER BY name ASC;");

    res.render("settings/spaces", {
      layout: "layouts/settings",
      title: "Settings — Rooms / Spaces",
      pageType: "settings",
      activeTab: "spaces",
      rooms,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ Error loading rooms:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load rooms.",
    });
  }
});

/* =========================================================
   ➕ ADD NEW EVENT TYPE (Flash + Redirect)
========================================================= */
router.post("/event-types/add", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Please enter a valid event type name.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/event-types");
    }

    const result = await pool.query(
      "INSERT INTO club_event_types (name) VALUES ($1) RETURNING id, name;",
      [name.trim()]
    );

    req.flash("flashMessage", `✅ "${result.rows[0].name}" added successfully!`);
    req.flash("flashType", "success");
    res.redirect("/settings/event-types");
  } catch (err) {
    console.error("❌ Error adding event type:", err);
    req.flash("flashMessage", "❌ Failed to add event type.");
    req.flash("flashType", "error");
    res.redirect("/settings/event-types");
  }
});

/* =========================================================
   ✏️ EDIT EVENT TYPE (Flash + Redirect)
========================================================= */
router.post("/event-types/edit", async (req, res) => {
  try {
    const { id, name } = req.body;

    if (!id || !name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Invalid event type data.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/event-types");
    }

    await pool.query("UPDATE club_event_types SET name = $1 WHERE id = $2;", [name.trim(), id]);

    req.flash("flashMessage", `✅ Event type updated successfully.`);
    req.flash("flashType", "success");
    res.redirect("/settings/event-types");
  } catch (err) {
    console.error("❌ Error editing event type:", err);
    req.flash("flashMessage", "❌ Failed to update event type.");
    req.flash("flashType", "error");
    res.redirect("/settings/event-types");
  }
});

/* =========================================================
   🗑️ DELETE EVENT TYPE (Flash + Redirect)
========================================================= */
router.post("/event-types/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      req.flash("flashMessage", "⚠️ Missing event type ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/event-types");
    }

    await pool.query("DELETE FROM club_event_types WHERE id = $1;", [id]);

    req.flash("flashMessage", "🗑️ Event type deleted successfully.");
    req.flash("flashType", "success");
    res.redirect("/settings/event-types");
  } catch (err) {
    console.error("❌ Error deleting event type:", err);
    req.flash("flashMessage", "❌ Failed to delete event type.");
    req.flash("flashType", "error");
    res.redirect("/settings/event-types");
  }
});

/* =========================================================
   🏠 SPACES CRUD (Flash + Redirect)
========================================================= */

// ➕ Add
router.post("/spaces/add", async (req, res) => {
  try {
    const { name, capacity } = req.body;

    if (!name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Please enter a valid room name.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/spaces");
    }

    const result = await pool.query(
      "INSERT INTO rooms (name, capacity) VALUES ($1, $2) RETURNING id, name;",
      [name.trim(), capacity || null]
    );

    req.flash("flashMessage", `✅ "${result.rows[0].name}" added successfully!`);
    req.flash("flashType", "success");
    res.redirect("/settings/spaces");
  } catch (err) {
    console.error("❌ Error adding room:", err);
    req.flash("flashMessage", "❌ Failed to add room.");
    req.flash("flashType", "error");
    res.redirect("/settings/spaces");
  }
});

// ✏️ Edit
router.post("/spaces/edit", async (req, res) => {
  try {
    const { id, name, capacity } = req.body;

    if (!id || !name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Invalid room data.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/spaces");
    }

    await pool.query("UPDATE rooms SET name=$1, capacity=$2 WHERE id=$3", [
      name.trim(),
      capacity || null,
      id,
    ]);

    req.flash("flashMessage", "✅ Room updated successfully.");
    req.flash("flashType", "success");
    res.redirect("/settings/spaces");
  } catch (err) {
    console.error("❌ Error editing room:", err);
    req.flash("flashMessage", "❌ Failed to update room.");
    req.flash("flashType", "error");
    res.redirect("/settings/spaces");
  }
});

// 🗑️ Delete
router.post("/spaces/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      req.flash("flashMessage", "⚠️ Missing room ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/spaces");
    }

    await pool.query("DELETE FROM rooms WHERE id = $1;", [id]);

    req.flash("flashMessage", "🗑️ Room deleted successfully.");
    req.flash("flashType", "success");
    res.redirect("/settings/spaces");
  } catch (err) {
    if (err.code === "23503") {
      req.flash("flashMessage", "⚠️ This room is linked to one or more functions and cannot be deleted.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/spaces");
    }

    console.error("❌ Error deleting room:", err);
    req.flash("flashMessage", "❌ Failed to delete room.");
    req.flash("flashType", "error");
    res.redirect("/settings/spaces");
  }
});

module.exports = router;

