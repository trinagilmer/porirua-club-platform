const express = require("express");
const router = express.Router();
const { pool } = require("../db");

/* =========================================================
   🧭 BASE REDIRECT — /settings → /settings/event-types
========================================================= */
router.get("/", (req, res) => res.redirect("/settings/event-types"));

/* =========================================================
   ⚙️ SETTINGS: EVENT TYPES
========================================================= */
router.get("/event-types", async (req, res) => {
  try {
    const { rows: eventTypes } = await pool.query(
      "SELECT * FROM club_event_types ORDER BY name ASC;"
    );

    res.render("pages/settings-event-types", {
      layout: "layouts/main",
      title: "Settings — Event Types",
      pageType: "settings",
      activeTab: "event-types",
      eventTypes,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ Error loading event types:", err);
    res.status(500).render("pages/error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load event types.",
    });
  }
});

/* =========================================================
   ⚙️ SETTINGS: SPACES / ROOMS
========================================================= */
router.get("/spaces", async (req, res) => {
  try {
    const { rows: rooms } = await pool.query(
      "SELECT * FROM rooms ORDER BY name ASC;"
    );

    res.render("pages/settings-spaces", {
      layout: "layouts/main",
      title: "Settings — Rooms / Spaces",
      pageType: "settings",
      activeTab: "spaces",
      rooms,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ Error loading rooms:", err);
    res.status(500).render("pages/error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load rooms.",
    });
  }
});

/* =========================================================
   ➕ ADD NEW EVENT TYPE
========================================================= */
router.post("/event-types/add", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Event type name is required." });
    }

    const result = await pool.query(
      "INSERT INTO club_event_types (name) VALUES ($1) RETURNING id, name;",
      [name.trim()]
    );

    res.json({ success: true, eventType: result.rows[0] });
  } catch (err) {
    console.error("❌ Error adding event type:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to add event type." });
  }
});

/* =========================================================
   ✏️ EDIT EVENT TYPE
========================================================= */
router.post("/event-types/edit", async (req, res) => {
  try {
    const { id, name } = req.body;

    if (!id || !name || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid request data." });
    }

    await pool.query("UPDATE club_event_types SET name = $1 WHERE id = $2", [
      name.trim(),
      id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error editing event type:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update event type." });
  }
});

/* =========================================================
   🗑️ DELETE EVENT TYPE
========================================================= */
router.post("/event-types/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Missing event type ID." });
    }

    await pool.query("DELETE FROM club_event_types WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting event type:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete event type." });
  }
});

/* =========================================================
   🏠 ROOMS / SPACES CRUD
========================================================= */

// 🔹 ADD ROOM
router.post("/spaces/add", async (req, res) => {
  try {
    const { name, capacity } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Room name is required." });
    }

    const result = await pool.query(
      "INSERT INTO rooms (name, capacity) VALUES ($1, $2) RETURNING id, name, capacity",
      [name.trim(), capacity || null]
    );

    res.json({ success: true, room: result.rows[0] });
  } catch (err) {
    console.error("❌ Error adding room:", err);
    res.status(500).json({ success: false, message: "Failed to add room." });
  }
});

// 🔹 EDIT ROOM
router.post("/spaces/edit", async (req, res) => {
  try {
    const { id, name, capacity } = req.body;

    if (!id || !name || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid request data." });
    }

    await pool.query("UPDATE rooms SET name=$1, capacity=$2 WHERE id=$3", [
      name.trim(),
      capacity || null,
      id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error editing room:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update room." });
  }
});

// 🔹 DELETE ROOM
router.post("/spaces/delete", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Missing room ID." });
    }

    await pool.query("DELETE FROM rooms WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    if (err.code === "23503") {
      // Foreign key constraint violation
      return res.status(400).json({
        success: false,
        message:
          "This room is currently linked to one or more functions and cannot be deleted.",
      });
    }

    console.error("❌ Error deleting room:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete room." });
  }
});

module.exports = router;


