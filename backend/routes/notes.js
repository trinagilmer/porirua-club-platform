// backend/routes/notes.js
const express = require("express");
const { pool } = require("../db");
const { renderNote } = require("../services/templateRenderer");

const router = express.Router();

async function ensureFunctionEndDateColumn() {
  await pool.query("ALTER TABLE functions ADD COLUMN IF NOT EXISTS end_date DATE;");
}
router.use(express.json());

/* =========================================================
   🗒️ NOTES ROUTES (UUID-safe)
   Paths preserved to avoid breaking existing links & EJS:
   - GET    /functions/:id/notes
   - POST   /functions/:id/notes/new
   - POST   /functions/notes/:noteId/update
   - DELETE /functions/notes/:noteId
   - POST   /functions/:id/notes/preview   (new)
========================================================= */

/**
 * GET: Notes page (now includes templates & merge fields for editor)
 */
router.get("/functions/:id/notes", async (req, res) => {
  const { id: functionId } = req.params;

  try {
    await ensureFunctionEndDateColumn();
    // -- Function core
    const { rows: fnRows } = await pool.query(
      `SELECT id_uuid, event_name, event_date, end_date, status, room_id
       FROM functions
       WHERE id_uuid = $1
       LIMIT 1;`,
      [functionId]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // -- Notes (show newest first)
    const { rows: notes } = await pool.query(
      `SELECT 
         n.id,
         n.function_id,
         n.note_type,              -- proposal | general | internal
         n.content,
         n.content_json,
         n.rendered_html,
         n.created_by,
         n.updated_by,
         n.created_at,
         n.updated_at,
         uc.name AS author_name,
         uu.name AS updated_by_name
       FROM function_notes n
       LEFT JOIN users uc ON uc.id = n.created_by
       LEFT JOIN users uu ON uu.id = n.updated_by
       WHERE n.function_id = $1
       ORDER BY n.created_at DESC;`,
      [functionId]
    );

    // -- Sidebar/context lookups you already use
    const [linkedContactsRes, roomsRes, eventTypesRes] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.email, c.phone, fc.is_primary
           FROM contacts c
           JOIN function_contacts fc ON fc.contact_id = c.id
          WHERE fc.function_id = $1
          ORDER BY fc.is_primary DESC, c.name ASC;`,
        [functionId]
      ),
      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`)
    ]);

    // -- Templates & merge fields for the advanced editor
    const [templatesRes, mergeFieldsRes] = await Promise.all([
      pool.query(
        `SELECT id, name, category, description, content_json, content
           FROM note_templates
          ORDER BY name ASC;`
      ),
      pool.query(
        `SELECT key, label, description, entity, jsonpath, formatter
           FROM merge_fields
          ORDER BY entity, label;`
      ),
    ]);

res.render("pages/functions/notes", {
  layout: "layouts/main",
  title: `${fn.event_name} — Notes`,
  pageName: "Notes",
  pageType: "function-detail", // ✅ triggers sidebar + tabs
  active: "functions",
  user: req.session.user || null,

  fn,
  notes,
  linkedContacts: linkedContactsRes.rows,
  rooms: roomsRes.rows,
  eventTypes: eventTypesRes.rows,
  templates: templatesRes.rows,
  mergeFields: mergeFieldsRes.rows,

  // ✅ required for layout safety
  activeTab: "notes",
  messages: [], // stub to prevent EJS crash
  grouped: null // stub for overview include
});

  } catch (err) {
    console.error("❌ [Notes GET] Error:", err);
    res.status(500).send("Failed to load notes");
  }
});

/**
 * POST: Create a new note (rich content + status)
 * Accepts JSON:
 *  - content? (plain text)
 *  - content_json? (TipTap JSON)
 *  - rendered_html? (HTML)
 *  - note_type? ('proposal'|'general'|'internal')  -> defaults to 'general'
 */
router.post("/functions/:id/notes/new", async (req, res) => {
  const { id: functionId } = req.params;
  const { content, content_json, rendered_html, note_type } = req.body;
  const userId = req.session.user?.id || null;

  if (!(content || content_json || rendered_html)) {
    return res
      .status(400)
      .json({ success: false, message: "Note content required" });
  }

  try {
    await pool.query(
      `INSERT INTO function_notes
         (function_id, content, content_json, rendered_html, note_type, created_by, updated_by, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, COALESCE($5, 'general'), $6, $6, NOW(), NOW());`,
      [
        functionId,
        content || null,
        content_json || null,
        rendered_html || null,
        note_type || null,
        userId,
      ]
    );

    console.log(`📝 [Notes CREATE] New note for function ${functionId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Notes CREATE] Error:", err);
    res.status(500).json({ success: false, message: "Failed to create note" });
  }
});

/**
 * POST: Update a note (rich content + status)
 * Accepts JSON like the create route.
 */
router.post("/functions/notes/:noteId/update", async (req, res) => {
  const { noteId } = req.params;
  const { content, content_json, rendered_html, note_type } = req.body;
  const userId = req.session.user?.id || null;

  try {
    await pool.query(
      `UPDATE function_notes
          SET content       = COALESCE($1, content),
              content_json  = COALESCE($2, content_json),
              rendered_html = COALESCE($3, rendered_html),
              note_type     = COALESCE($4, note_type),
              updated_at    = NOW(),
              updated_by    = COALESCE($5, updated_by)
        WHERE id = $6;`,
      [
        content || null,
        content_json || null,
        rendered_html || null,
        note_type || null,
        userId,
        noteId,
      ]
    );

    console.log(`✏️ [Notes UPDATE] Note ${noteId} updated`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Notes UPDATE] Error:", err);
    res.status(500).json({ success: false, message: "Failed to update note" });
  }
});

/**
 * DELETE: Remove a note
 */
router.delete("/functions/notes/:noteId", async (req, res) => {
  const { noteId } = req.params;

  try {
    await pool.query(`DELETE FROM function_notes WHERE id = $1;`, [noteId]);
    console.log(`🗑️ [Notes DELETE] Note ${noteId} deleted`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Notes DELETE] Error:", err);
    res.status(500).json({ success: false, message: "Failed to delete note" });
  }
});

/**
 * POST: Preview — server-side token merge for current function
 * Body: { raw_html?: string, rendered_html?: string }
 * Returns: { success: true, merged: "<html...>" }
 *
 * Note: We keep start/end time nullable here; your template will show empty
 * if missing. If your times live in another table, we can wire that once you
 * confirm the columns.
 */
router.post("/functions/:id/notes/preview", async (req, res) => {
  const { id: functionId } = req.params;
  const { raw_html, rendered_html } = req.body;

  try {
    await ensureFunctionEndDateColumn();
    // Function core for tokens
    const { rows: fnRows } = await pool.query(
      `SELECT id_uuid, event_name, event_date, end_date, status, room_id
         FROM functions
        WHERE id_uuid = $1
        LIMIT 1;`,
      [functionId]
    );
    const fn = fnRows[0];
    if (!fn) return res.status(404).json({ success: false, message: "Function not found" });

    // Primary contact (if any)
    const { rows: contactRows } = await pool.query(
      `SELECT c.name, c.email, c.phone
         FROM contacts c
         JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC
        LIMIT 1;`,
      [functionId]
    );
    const contact = contactRows[0] || null;

    // Room
    let room = null;
    if (fn.room_id) {
      const { rows: roomRows } = await pool.query(
        `SELECT id, name, capacity FROM rooms WHERE id = $1`,
        [fn.room_id]
      );
      room = roomRows[0] || null;
    }

    // Build data map for tokens
    const data = {
      event: {
        name: fn.event_name || "",
        date: fn.event_date || "",
        end_date: fn.end_date || "",
        // If you later confirm start/end sources, set them here:
        start_time: null,
        end_time: null,
      },
      contact: contact || {},
      room: room || {},
    };

    const merged = await renderNote({ raw_html, rendered_html }, data);
    res.json({ success: true, merged });
  } catch (err) {
    console.error("❌ [Notes PREVIEW] Error:", err);
    res.status(500).json({ success: false, message: "Failed to render preview" });
  }
});

module.exports = router;

