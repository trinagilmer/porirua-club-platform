/**
 * =========================================================
 * 📇 CONTACTS ROUTER (UUID-SAFE for Supabase)
 * Handles listing, creating, linking, editing contacts
 * =========================================================
 */
const express = require("express");
const { pool } = require("../db");
const router = express.Router();

/* =========================================================
   📋 1. GET: All contacts
========================================================= */
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, company
       FROM contacts
       ORDER BY name ASC;`
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ [Contacts] Load error:", err);
    res.status(500).json({ success: false, message: "Failed to load contacts" });
  }
});

/* =========================================================
   👁️ 2. GET: Single contact by UUID
========================================================= */
router.get("/:contactId", async (req, res) => {
  const { contactId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, id_uuid, name, email, phone, company, notes
       FROM contacts
       WHERE id = $1;`,
      [contactId]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: "Contact not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ [Contact GET by UUID] Error:", err);
    res.status(500).json({ success: false, message: "Failed to load contact" });
  }
});

/* =========================================================
   🆕 3. POST: Create new contact
========================================================= */
router.post("/", async (req, res) => {
  const { name, email, phone, company } = req.body;
  if (!name?.trim())
    return res.status(400).json({ success: false, message: "Name is required" });

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, email, phone, company)
       VALUES ($1, $2, $3, $4)
       RETURNING id;`,
      [name, email, phone, company]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error("❌ [Contacts] Create error:", err);
    res.status(500).json({ success: false, message: "Failed to create contact" });
  }
});

/* =========================================================
   🔗 4. POST: Link existing contact to a function
========================================================= */
router.post("/link/:fnId", async (req, res) => {
  const { fnId } = req.params;
  const { contact_id } = req.body;

  if (!fnId || !contact_id)
    return res.status(400).json({ success: false, message: "Missing function or contact ID" });

  try {
    await pool.query(
      `INSERT INTO function_contacts (function_id, contact_id, is_primary, created_at)
       VALUES ($1, $2, false, NOW())
       ON CONFLICT (function_id, contact_id) DO NOTHING;`,
      [fnId, contact_id]
    );
    console.log(`🔗 [Contact LINK] Contact ${contact_id} linked to function ${fnId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Contact LINK] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   🗑️ 5. POST: Unlink contact from function
========================================================= */
router.post("/:fnId/remove-contact", async (req, res) => {
  const { fnId } = req.params;
  const { contact_id } = req.body;
  if (!fnId || !contact_id)
    return res.status(400).json({ success: false, message: "Missing IDs" });

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM function_contacts WHERE function_id = $1 AND contact_id = $2;`,
      [fnId, contact_id]
    );

    if (rowCount === 0)
      return res.status(404).json({ success: false, message: "Link not found" });

    console.log(`🗑️ [Contact REMOVE] Contact ${contact_id} unlinked from function ${fnId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Contact REMOVE] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   ⭐ 6. POST: Set contact as primary
========================================================= */
router.post("/:fnId/set-primary", async (req, res) => {
  const { fnId } = req.params;
  const { contact_id } = req.body;

  try {
    await pool.query(`UPDATE function_contacts SET is_primary = false WHERE function_id = $1;`, [fnId]);
    await pool.query(
      `UPDATE function_contacts SET is_primary = true WHERE function_id = $1 AND contact_id = $2;`,
      [fnId, contact_id]
    );

    console.log(`⭐ [Contact PRIMARY] Contact ${contact_id} set as primary for function ${fnId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Contact PRIMARY] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   ✏️ 7. PUT: Update existing contact (UUID-safe)
========================================================= */
router.put("/:contactId", async (req, res) => {
  const { contactId } = req.params;
  const { name, email, phone, company } = req.body;

  if (!contactId || !name?.trim()) {
    return res.status(400).json({ success: false, message: "Invalid contact data" });
  }

  try {
    const { rowCount } = await pool.query(
      `UPDATE contacts
       SET name = $1, email = $2, phone = $3, company = $4, updated_at = NOW()
       WHERE id::text = $5 OR id_uuid::text = $5;`,
      [name, email, phone, company, contactId]
    );

    if (rowCount === 0) {
      console.warn(`⚠️ No contact found for ID/UUID ${contactId}`);
      return res.status(404).json({ success: false, message: "Contact not found" });
    }

    console.log(`✏️ [Contact EDIT] Updated contact ${contactId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Contact EDIT] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


module.exports = router;