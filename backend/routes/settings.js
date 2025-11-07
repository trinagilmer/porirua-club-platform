/**
 * =========================================================
 * ⚙️ Settings Routes
 * Organized per-section (Overview, Event Types, Spaces)
 * =========================================================
 */

const express = require("express");
const router = express.Router();
const { pool } = require("../db");

// Use the settings layout for everything in this router
router.use((req, res, next) => {
  res.locals.layout = 'layouts/settings';
  next();
});

// ✅ Make sure form posts are parsed (HTML forms use urlencoded)
router.use(express.urlencoded({ extended: true, limit: "5mb" }));
router.use(express.json({ limit: "5mb" })); // if any JSON posts too
/* =========================================================
   🧭 BASE REDIRECT — /settings → /settings/overview
========================================================= */
router.get("/", (req, res) => res.redirect("/settings/overview"));

/* =========================================================
   🧩 SETTINGS OVERVIEW
========================================================= */
router.get("/overview", async (req, res) => {
  try {
    const [eventTypesRes, roomsRes, templatesRes] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM club_event_types;"),
      pool.query("SELECT COUNT(*)::int AS count FROM rooms;"),
      pool.query("SELECT COUNT(*)::int AS count FROM note_templates;"),
      pool.query("SELECT COUNT(*)::int AS count FROM menus;")
    ]);

    res.render("settings/index", {
      layout: "layouts/settings",
      title: "Settings Overview",
      pageType: "settings",
      activeTab: "overview",
      counts: {
        eventTypes: eventTypesRes.rows[0]?.count ?? 0,
        rooms: roomsRes.rows[0]?.count ?? 0,
        noteTemplates: templatesRes.rows[0]?.count ?? 0,
      },
      user: req.session.user || null,
      flashMessage: req.flash?.("flashMessage"),
      flashType: req.flash?.("flashType"),
    });
  } catch (err) {
    console.error("❌ Settings overview error:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load settings overview.",
      error: err.message,
      stack: err.stack,
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
      error: err.message,
      stack: err.stack,
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
      error: err.message,
      stack: err.stack,
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
/* =========================================================
   🧩 SETTINGS: NOTE TEMPLATES (Templates for Notes/Proposals)
   - List/create/edit/delete templates stored in public.note_templates
   - Uses HTML content (content) as the primary field for now
========================================================= */

// LIST
router.get("/note-templates", async (req, res) => {
  try {
    const { rows: templates } = await pool.query(
      `SELECT id, name, category, description, content
         FROM note_templates
        ORDER BY name ASC;`
    );

    const { rows: mergeFields } = await pool.query(
      `SELECT key, label, description, entity, formatter
         FROM merge_fields
        ORDER BY entity, label;`
    );

    res.render("settings/note-templates", {
      layout: "layouts/settings",
      title: "Settings — Note Templates",
      pageType: "settings",
      activeTab: "note-templates",
      templates,
      mergeFields,
      user: req.session.user || null,
      flashMessage: req.flash("flashMessage"),
      flashType: req.flash("flashType"),
    });
  } catch (err) {
    console.error("❌ Error loading note templates:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load note templates.",
      error: err.message,
      stack: err.stack,
    });
  }
});

// ADD
router.post("/note-templates/add", async (req, res) => {
  try {
    const { name, category, description, content } = req.body;

    if (!name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Please provide a template name.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/note-templates");
    }

    await pool.query(
      `INSERT INTO note_templates (name, category, description, content, created_by)
       VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4, $5);`,
      [name.trim(), category || null, description || null, content || "", req.session.user?.id || null]
    );

    req.flash("flashMessage", "✅ Template created.");
    req.flash("flashType", "success");
    res.redirect("/settings/note-templates");
  } catch (err) {
    console.error("❌ Error adding template:", err);
    req.flash("flashMessage", "❌ Failed to create template.");
    req.flash("flashType", "error");
    res.redirect("/settings/note-templates");
  }
});

// EDIT
router.post("/note-templates/edit", async (req, res) => {
  try {
    const { id, name, category, description, content } = req.body;

    if (!id || !name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Invalid template data.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/note-templates");
    }

    await pool.query(
      `UPDATE note_templates
          SET name = $1,
              category = NULLIF($2,''),
              description = NULLIF($3,''),
              content = $4,
              updated_at = NOW()
        WHERE id = $5;`,
      [name.trim(), category || null, description || null, content || "", id]
    );

    req.flash("flashMessage", "✅ Template updated.");
    req.flash("flashType", "success");
    res.redirect("/settings/note-templates");
  } catch (err) {
    console.error("❌ Error editing template:", err);
    req.flash("flashMessage", "❌ Failed to update template.");
    req.flash("flashType", "error");
    res.redirect("/settings/note-templates");
  }
});

// DELETE
router.post("/note-templates/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      req.flash("flashMessage", "⚠️ Missing template ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/note-templates");
    }

    await pool.query("DELETE FROM note_templates WHERE id = $1;", [id]);

    req.flash("flashMessage", "🗑️ Template deleted.");
    req.flash("flashType", "success");
    res.redirect("/settings/note-templates");
  } catch (err) {
    console.error("❌ Error deleting template:", err);
    req.flash("flashMessage", "❌ Failed to delete template.");
    req.flash("flashType", "error");
    res.redirect("/settings/note-templates");
  }
});

router.get("/note-templates/api/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid template id." });
  }
  try {
    const {
      rows,
    } = await pool.query(
      `SELECT id, name, category, description, content
         FROM note_templates
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Template not found." });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("Error loading note template:", err);
    res.status(500).json({ success: false, error: "Failed to load template." });
  }
});
// 🔹 Menus (✅ this is the fix)
router.use("/menus", require("./settings/menus"));

// 🔹 Menus Builder (optional extended UI)
//router.use("/menus-builder", require("./settings/menus-builder"));

// Redirect any /settings/menus-builder[...] to /settings/menus
router.use('/menus-builder', (req, res) => {
  return res.redirect(301, '/settings/menus');
});



module.exports = router;

