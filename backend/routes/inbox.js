/**
 * 📬 Porirua Club Platform – Unified Inbox (Final Enhanced Version)
 * Combines: PostgreSQL (pool) + Supabase (storage) + Microsoft Graph
 */

const fetch = require("node-fetch");
const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();

const { pool } = require("../db");
const { ensureGraphToken } = require("../middleware/graphTokenMiddleware");
const { getValidGraphToken } = require("../utils/graphAuth");
const graphService = require("../services/graphService");
const { createClient } = require("@supabase/supabase-js");

let supabase = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  console.log("✅ Supabase client initialized");
} else {
  console.warn("⚠️ Supabase credentials missing — Supabase features disabled");
}

const SHARED_MAILBOX = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
const SENDER_EMAIL = "events@poriruaclub.co.nz";

/* ---------------------------------------------------------
   🔧 Utility: Deduplicate messages by ID
--------------------------------------------------------- */
function dedupeMessages(messages) {
  const seen = new Set();
  return messages.filter((m) => {
    const id = m.id || m.graph_id || m.subject + m.from_email;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/* ---------------------------------------------------------
   🟩 1️⃣ Unified Inbox (Postgres + Graph Sync)
--------------------------------------------------------- */
router.get("/", ensureGraphToken, async (req, res) => {
  try {
    const accessToken = req.session.graphToken;
    if (!accessToken) throw new Error("Missing Graph token");

    console.log("🔄 Fetching from Microsoft Graph...");
    const graphUrl = `https://graph.microsoft.com/v1.0/users('${SHARED_MAILBOX}')/mailFolders('Inbox')/messages?$top=20`;
    const response = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log("📡 Graph response status:", response.status, response.statusText);

    if (response.ok) {
      const data = await response.json();
      let inserted = 0;
      let skipped = 0;

      for (const m of data.value || []) {
        if (!m.id || !m.from?.emailAddress?.address) {
          console.warn(`⚠️ Skipped message with missing ID or sender: ${m.subject}`);
          skipped++;
          continue;
        }

        const fromEmail = m.from.emailAddress.address;
        const subject = m.subject || "(No Subject)";
        const body = m.bodyPreview || "";
        const receivedAt = m.receivedDateTime || null;

        const result = await pool.query(
          `INSERT INTO messages (
              graph_id, subject, body, from_email, to_email, received_at, message_type, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'inbound', NOW())
           ON CONFLICT (graph_id) DO NOTHING
           RETURNING id;`,
          [m.id, subject, body, fromEmail, SHARED_MAILBOX, receivedAt]
        );

        if (result.rowCount > 0) inserted++;
      }

      console.log(`📬 Graph sync complete → inserted: ${inserted}, skipped: ${skipped}`);
    } else {
      console.error("💥 Graph API failed:", response.status, response.statusText);
    }

    const dbRes = await pool.query(`
      SELECT 
        m.id, m.subject, m.body, m.from_email, m.to_email,
        m.message_type, m.created_at, m.received_at,
        c.name AS contact_name, f.event_name AS function_name
      FROM messages m
      LEFT JOIN contacts c ON m.related_contact = c.id
      LEFT JOIN functions f ON m.related_function = f.id
      ORDER BY m.created_at DESC;
    `);

    const messages = dedupeMessages(
      dbRes.rows.map((m) => ({
        ...m,
        subject: m.subject || "(No Subject)",
        from_email: m.from_email || "(Unknown sender)",
        to_email: m.to_email || "(Unknown recipient)",
        created_at: m.created_at || m.received_at,
      }))
    );

    const total = messages.length;
    const linked = messages.filter((m) => m.contact_name || m.function_name).length;
    const unlinked = total - linked;

    res.render("pages/inbox", {
      user: req.session.user || null,
      messages,
      error: null,
      enhanced: true,
      stats: { total, linked, unlinked },
      active: "inbox",
    });
  } catch (err) {
    console.error("❌ [Unified Inbox] Error:", err);
    res.render("pages/inbox", {
      user: req.session.user || null,
      messages: [],
      error: "Failed to load inbox",
      enhanced: true,
      stats: { total: 0, linked: 0, unlinked: 0 },
      active: "inbox",
    });
  }
});

/* ---------------------------------------------------------
   📄 2️⃣ Message Detail (Postgres + Graph Fallback)
--------------------------------------------------------- */
router.get("/:id", async (req, res, next) => {
  try {
    const messageId = req.params.id;
    const reserved = ["enhanced", "match", "reply", "link", "cleanup"];
    if (reserved.includes(messageId.toLowerCase())) return next();

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(messageId)) {
      return res.status(400).send(`<h2>Invalid message ID</h2><pre>${messageId}</pre>`);
    }

    // ✅ Enhanced query with JOINs to fetch linked contact + function names
    const dbRes = await pool.query(`
      SELECT 
        m.*, 
        c.id AS contact_id,
        c.name AS contact_name,
        f.id AS function_id,
        f.event_name AS function_name
      FROM messages m
      LEFT JOIN contacts c ON m.related_contact = c.id
      LEFT JOIN functions f ON m.related_function = f.id
      WHERE m.id = $1
      LIMIT 1;
    `, [messageId]);

    let message = dbRes.rows[0];

    if (!message) {
      const accessToken = req.session.graphToken;
      const graphUrl = `https://graph.microsoft.com/v1.0/users('${SHARED_MAILBOX}')/messages/${messageId}`;
      const response = await fetch(graphUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok)
        throw new Error(`Graph fetch failed: ${response.status} ${response.statusText}`);
      const graphMessage = await response.json();

      message = {
        id: graphMessage.id,
        subject: graphMessage.subject || "(No Subject)",
        from_email: graphMessage.from?.emailAddress?.address || "(Unknown sender)",
        to_email: graphMessage.toRecipients?.[0]?.emailAddress?.address || "(Unknown recipient)",
        body_html: graphMessage.body?.content || "(No content)",
        created_at: graphMessage.receivedDateTime || new Date().toISOString(),
        source: "Outlook",
      };
    }

    const contactsRes = await pool.query("SELECT id, name FROM contacts;");

    let functionsRes;
    if (message.related_contact) {
      functionsRes = await pool.query(`
        SELECT DISTINCT f.id, f.event_name
        FROM functions f
        LEFT JOIN function_contacts fc ON fc.function_id = f.id
        WHERE (f.contact_id::text = $1 OR fc.contact_id::text = $1)
        ORDER BY f.event_name;
      `, [message.related_contact]);
    } else {
      functionsRes = { rows: [] };
    }

    res.render("pages/messageDetail", {
      message,
      contacts: contactsRes.rows,
      functions: functionsRes.rows,
      user: req.session.user || null,
      active: "inbox",
    });
  } catch (err) {
    console.error("❌ [Message Detail] Error:", err);
    res.status(500).send(`<h2>Error rendering message detail</h2><pre>${err.message}</pre>`);
  }
});

/* ---------------------------------------------------------
   💬 3️⃣ Reply with Attachments
--------------------------------------------------------- */
router.post("/reply/:id", ensureGraphToken, upload.single("attachment"), async (req, res) => {
  const messageId = req.params.id;
  const { subject, body } = req.body;
  const file = req.file;

  try {
    let accessToken = req.session.graphToken || (await getValidGraphToken(req));
    if (!accessToken) throw new Error("No Graph token available. Please log in again.");

    let uploadedFile = null;
    if (file) {
      const filePath = `inbox/${Date.now()}_${file.originalname}`;
      const { data, error } = await supabase.storage
        .from("attachments")
        .upload(filePath, file.buffer, { contentType: file.mimetype });
      if (error) throw new Error(`Supabase upload failed: ${error.message}`);
      uploadedFile = { name: file.originalname, path: data.path };
    }

    const { rows } = await pool.query(`SELECT * FROM messages WHERE id=$1 LIMIT 1;`, [messageId]);
    const original = rows[0];
    if (!original) throw new Error("Original message not found");

    const mailData = {
      to: original.from_email,
      subject,
      body,
      attachments: uploadedFile
        ? [{
            name: uploadedFile.name,
            contentType: file.mimetype,
            contentBytes: file.buffer.toString("base64"),
          }]
        : [],
    };

    await graphService.sendMail(accessToken, mailData);

    await pool.query(
      `INSERT INTO messages (message_type, from_email, to_email, subject, body, related_contact, related_function, created_at)
       VALUES ('outbound', $1, $2, $3, $4, $5, $6, NOW());`,
      [
        SENDER_EMAIL,
        original.from_email,
        subject,
        body,
        original.related_contact || null,
        original.related_function || null,
      ]
    );

    if (uploadedFile) {
      await pool.query(
        `INSERT INTO documents (message_id, file_name, file_url)
         VALUES ($1, $2, $3);`,
        [messageId, uploadedFile.name, uploadedFile.path]
      );
    }

    res.redirect(`/inbox/${messageId}`);
  } catch (err) {
    console.error("❌ [Reply] Failed:", err.message);
    res.status(500).send(`<h2>Reply Failed</h2><pre>${err.message}</pre>`);
  }
});

/* ---------------------------------------------------------
   🧹 Cleanup Utility
--------------------------------------------------------- */
router.get("/cleanup", async (req, res) => {
  try {
    if (!req.session.user)
      return res.status(403).send("<h3>Access denied. Please log in first.</h3>");

    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM messages WHERE graph_id IS NULL;`
    );
    const count = parseInt(rows[0].count, 10);

    if (count === 0)
      return res.send(`<h2>✅ Cleanup Complete</h2><p>No orphaned messages found.</p>`);

    res.send(`
      <h2>⚠️ Confirm Cleanup</h2>
      <p>This will permanently delete <strong>${count}</strong> messages without Graph IDs.</p>
      <form action="/inbox/cleanup/confirm" method="POST">
        <button type="submit" style="padding:10px 15px;background-color:#b91c1c;color:white;border:none;border-radius:5px;">Yes, Delete</button>
        <a href="/inbox" style="margin-left:15px;color:#0f766e;">Cancel</a>
      </form>
    `);
  } catch (err) {
    console.error("❌ [Cleanup] Error:", err);
    res.status(500).send(`<h3>💥 Cleanup Failed</h3><pre>${err.message}</pre>`);
  }
});

router.post("/cleanup/confirm", async (req, res) => {
  try {
    if (!req.session.user)
      return res.status(403).send("<h3>Access denied. Please log in first.</h3>");

    const result = await pool.query(`DELETE FROM messages WHERE graph_id IS NULL;`);
    res.send(`<h2>🧹 Cleanup Complete</h2><p>Deleted <strong>${result.rowCount}</strong> messages.</p>`);
  } catch (err) {
    console.error("❌ [Cleanup Confirm] Error:", err);
    res.status(500).send(`<h3>💥 Cleanup Failed</h3><pre>${err.message}</pre>`);
  }
});

/* ---------------------------------------------------------
   📡 API: Get all functions for a given contact
--------------------------------------------------------- */
router.get("/api/functions/by-contact/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;
    const { rows } = await pool.query(`
      SELECT DISTINCT f.id, f.event_name
      FROM functions f
      LEFT JOIN function_contacts fc ON fc.function_id = f.id
      WHERE (f.contact_id::text = $1 OR fc.contact_id::text = $1)
      ORDER BY f.event_name;
    `, [contactId]);

    res.json(rows);
  } catch (err) {
    console.error("❌ [API] Error loading functions:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
   🔗 Manual Link Message → Contact / Function
--------------------------------------------------------- */
router.post("/link/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let { contact_id, function_id } = req.body;

    // Get current values first
    const { rows } = await pool.query(
      `SELECT related_contact, related_function FROM messages WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Message not found" });

    const current = rows[0];

    // Keep what the user didn’t change
    if (!contact_id) contact_id = current.related_contact;
    if (!function_id) function_id = current.related_function;

    await pool.query(
      `UPDATE messages
       SET related_contact = $1,
           related_function = $2
       WHERE id = $3`,
      [contact_id || null, function_id || null, id]
    );

    res.json({
      success: true,
      redirectUrl: `/inbox/${id}`,
      message: "Message linked successfully",
    });
  } catch (err) {
    console.error("❌ [Link Message] Error:", err);
    res.status(500).json({ error: err.message });
  }
});
/* ---------------------------------------------------------
   🔗 Separate Routes for Contact and Function Linking
--------------------------------------------------------- */
router.post("/link-contact/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { contact_id } = req.body;

    await pool.query(
      `UPDATE messages SET related_contact = $1 WHERE id = $2;`,
      [contact_id || null, id]
    );

    res.json({ success: true, redirectUrl: `/inbox/${id}` });
  } catch (err) {
    console.error("❌ [Link Contact] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/link-function/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { function_id } = req.body;

    await pool.query(
      `UPDATE messages SET related_function = $1 WHERE id = $2;`,
      [function_id || null, id]
    );

    res.json({ success: true, redirectUrl: `/inbox/${id}` });
  } catch (err) {
    console.error("❌ [Link Function] Error:", err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
