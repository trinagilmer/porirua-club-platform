/**
 * =========================================================
 * 📇 CONTACTS ROUTER (UUID-SAFE for Supabase)
 * Handles listing, creating, linking, editing contacts
 * =========================================================
 */
const express = require("express");
const ExcelJS = require("exceljs");
const multer = require("multer");
const { parse: parseCsv } = require("csv-parse/sync");
const { pool } = require("../db");
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

function isApiRequest(req) {
  return req.baseUrl.startsWith("/api");
}

function ensureLoggedIn(req, res) {
  if (req.session?.user) return true;
  const nextUrl = encodeURIComponent(req.originalUrl || "/contacts");
  res.redirect(`/auth/login?next=${nextUrl}`);
  return false;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (!normalised) return false;
    return ["true", "1", "yes", "y", "on"].includes(normalised);
  }
  return false;
}

async function fetchContactRecord(identifier) {
  if (!identifier) return null;
  const { rows } = await pool.query(
    `
    SELECT *,
           COALESCE(feedback_opt_out, FALSE) AS feedback_opt_out
      FROM contacts
     WHERE id::text = $1
        OR COALESCE(id_uuid::text, '') = $1
     LIMIT 1;
    `,
    [String(identifier)]
  );
  return rows[0] || null;
}

async function loadContactList() {
  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.id_uuid,
      c.name,
      c.email,
      c.phone,
      c.company,
      c.notes,
      c.created_at,
      c.updated_at,
      COALESCE(c.feedback_opt_out, FALSE) AS feedback_opt_out,
      COUNT(DISTINCT fc.function_id) AS function_count
    FROM contacts c
    LEFT JOIN function_contacts fc ON fc.contact_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC;
    `
  );
  return rows;
}

async function upsertContactRecord(client, record) {
  const name = (record.name || "").trim();
  const email = (record.email || "").trim();
  const phone = (record.phone || "").trim();
  const company = (record.company || "").trim();
  const optOut = parseBoolean(record.feedback_opt_out);

  if (!name) return { status: "skipped" };

  if (email) {
    const update = await client.query(
      `
      UPDATE contacts
         SET name = $1,
             phone = NULLIF($2, ''),
             company = NULLIF($3, ''),
             feedback_opt_out = $4,
             updated_at = NOW()
       WHERE LOWER(email) = LOWER($5)
       RETURNING id;
      `,
      [name, phone, company, optOut, email]
    );
    if (update.rowCount) return { status: "updated" };
  }

  await client.query(
    `
    INSERT INTO contacts (name, email, phone, company, feedback_opt_out, created_at, updated_at)
    VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), $5, NOW(), NOW());
    `,
    [name, email, phone, company, optOut]
  );
  return { status: "created" };
}

/* =========================================================
   📋 1. GET: All contacts / Contacts page
========================================================= */
router.get("/", async (req, res) => {
  if (isApiRequest(req)) {
    try {
      const list = await loadContactList();
      res.json(list);
    } catch (err) {
      console.error("❌ [Contacts] Load error:", err);
      res.status(500).json({ success: false, message: "Failed to load contacts" });
    }
    return;
  }

  if (!ensureLoggedIn(req, res)) return;
  try {
    const contacts = await loadContactList();
    res.render("pages/contacts/index", {
      layout: "layouts/main",
      title: "Contacts",
      active: "contacts",
      pageType: "contacts",
      user: req.session.user || null,
      contacts,
      pageJs: ["/js/contacts/index.js"],
    });
  } catch (err) {
    console.error("❌ [Contacts] Page load error:", err);
    res.status(500).send("Unable to load contacts.");
  }
});

router.get("/export", async (req, res) => {
  if (isApiRequest(req)) {
    return res.status(404).json({ success: false, message: "Not available via API" });
  }
  if (!ensureLoggedIn(req, res)) return;
  try {
    const contacts = await loadContactList();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Contacts");
    sheet.columns = [
      { header: "Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Company", key: "company", width: 18 },
      { header: "Functions linked", key: "function_count", width: 16 },
      { header: "Survey opt-out", key: "feedback_opt_out", width: 16 },
    ];
    contacts.forEach((contact) => {
      sheet.addRow({
        name: contact.name,
        email: contact.email || "",
        phone: contact.phone || "",
        company: contact.company || "",
        function_count: contact.function_count || 0,
        feedback_opt_out: contact.feedback_opt_out ? "Yes" : "No",
      });
    });
    sheet.getRow(1).font = { bold: true };
    const filename = `contacts-${Date.now()}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("❌ [Contacts EXPORT] Error:", err);
    res.status(500).send("Unable to export contacts.");
  }
});

router.post("/import", upload.single("contacts_file"), async (req, res) => {
  const wantsJson = isApiRequest(req);
  if (!req.session?.user) {
    if (wantsJson) return res.status(401).json({ success: false, message: "Login required" });
    if (!ensureLoggedIn(req, res)) return;
  }
  if (!req.file?.buffer) {
    const message = "Please upload a CSV file.";
    return wantsJson
      ? res.status(400).json({ success: false, message })
      : res.status(400).send(message);
  }
  let records = [];
  try {
    records = parseCsv(req.file.buffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }).map((row) => {
      const mapped = {};
      Object.entries(row || {}).forEach(([key, value]) => {
        mapped[(key || "").toLowerCase()] = value ?? "";
      });
      return {
        name: mapped.name || mapped.fullname || "",
        email: mapped.email || "",
        phone: mapped.phone || mapped.mobile || "",
        company: mapped.company || mapped.organisation || "",
        feedback_opt_out:
          mapped.feedback_opt_out ||
          mapped.survey_opt_out ||
          mapped.opt_out ||
          "",
      };
    });
  } catch (err) {
    console.error("❌ [Contacts IMPORT] CSV parse error:", err);
    return wantsJson
      ? res.status(400).json({ success: false, message: "Invalid CSV format." })
      : res.status(400).send("Invalid CSV.");
  }

  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const record of records) {
      const result = await upsertContactRecord(client, record);
      if (result.status === "created") created += 1;
      else if (result.status === "updated") updated += 1;
    }
    await client.query("COMMIT");
    const payload = { success: true, created, updated };
    return wantsJson ? res.json(payload) : res.json(payload);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ [Contacts IMPORT] Error:", err);
    const message = err.message || "Unable to import contacts.";
    return wantsJson ? res.status(500).json({ success: false, message }) : res.status(500).send(message);
  } finally {
    client.release();
  }
});

/* =========================================================
   👁️ 2. GET: Single contact by UUID
========================================================= */
router.get("/:contactId", async (req, res) => {
  if (!isApiRequest(req)) {
    return res.redirect(`/contacts?selected=${encodeURIComponent(req.params.contactId)}`);
  }
  const { contactId } = req.params;
  try {
    const contact = await fetchContactRecord(contactId);
    if (!contact) {
      return res.status(404).json({ success: false, message: "Contact not found" });
    }
    res.json(contact);
  } catch (err) {
    console.error("❌ [Contact GET by UUID] Error:", err);
    res.status(500).json({ success: false, message: "Failed to load contact" });
  }
});

router.get("/:contactId/full", async (req, res) => {
  if (!isApiRequest(req)) {
    return res.status(404).send("Not found");
  }
  const { contactId } = req.params;
  try {
    const contact = await fetchContactRecord(contactId);
    if (!contact) {
      return res.status(404).json({ success: false, message: "Contact not found" });
    }
    const [functionsRes, bookingsRes] = await Promise.all([
      pool.query(
        `
        SELECT
          f.id_uuid,
          f.event_name,
          f.event_date,
          f.start_time,
          f.status
        FROM function_contacts fc
        JOIN functions f ON f.id_uuid = fc.function_id
        WHERE fc.contact_id = $1
        ORDER BY f.event_date DESC NULLS LAST, COALESCE(f.start_time, '00:00:00') DESC;
        `,
        [contact.id]
      ),
      pool.query(
        `
        SELECT id, party_name, booking_date, booking_time, status
          FROM restaurant_bookings
         WHERE contact_id = $1
            OR (contact_id IS NULL AND LOWER(contact_email) = LOWER($2))
         ORDER BY booking_date DESC, booking_time DESC NULLS LAST;
        `,
        [contact.id, contact.email || ""]
      ),
    ]);

    res.json({
      success: true,
      contact,
      functions: functionsRes.rows,
      bookings: bookingsRes.rows,
      events: [],
    });
  } catch (err) {
    console.error("❌ [Contact FULL] Error:", err);
    res.status(500).json({ success: false, message: "Failed to load contact" });
  }
});

/* =========================================================
   🆕 3. POST: Create new contact
========================================================= */
router.post("/", async (req, res) => {
  const { name, email, phone, company, feedback_opt_out } = req.body;
  if (!name?.trim())
    return res.status(400).json({ success: false, message: "Name is required" });

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, email, phone, company, feedback_opt_out)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id;`,
      [name, email, phone, company, parseBoolean(feedback_opt_out)]
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
  const { name, email, phone, company, feedback_opt_out } = req.body;

  if (!contactId || !name?.trim()) {
    return res.status(400).json({ success: false, message: "Invalid contact data" });
  }

  try {
    const { rowCount } = await pool.query(
      `UPDATE contacts
       SET name = $1,
           email = $2,
           phone = $3,
           company = $4,
           feedback_opt_out = $5,
           updated_at = NOW()
       WHERE id::text = $6 OR id_uuid::text = $6;`,
      [name, email, phone, company, parseBoolean(feedback_opt_out), contactId]
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

router.delete("/:contactId", async (req, res) => {
  const { contactId } = req.params;
  if (!contactId) return res.status(400).json({ success: false, message: "Missing contact id" });
  try {
    const contact = await fetchContactRecord(contactId);
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    await pool.query(`DELETE FROM function_contacts WHERE contact_id = $1;`, [contact.id]);
    await pool.query(`DELETE FROM contacts WHERE id = $1;`, [contact.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Contact DELETE] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
