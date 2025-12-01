/**
 * 📬 Porirua Club Platform – Unified Inbox (Final with Reply)
 * Combines PostgreSQL + Supabase (attachments) + Microsoft Graph
 */

const fetch = require("node-fetch");
const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const { pool } = require("../db");
const { getAppToken } = require("../utils/graphAuth");
const graphService = require("../services/graphService");
const { createClient } = require("@supabase/supabase-js");

// --- Add near the top of inbox.js ---
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

// 🧩 Supabase Init (attachments bucket)
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  console.log("✅ Supabase client initialized");
} else {
  console.warn("⚠️ Supabase credentials missing — Supabase features disabled");
}

const SHARED_MAILBOX = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
const SENDER_EMAIL = "events@poriruaclub.co.nz";

async function findLatestFunctionForContact(contactId) {
  if (!contactId) return null;

  const { rows } = await pool.query(
    `
    SELECT f.id_uuid
    FROM functions f
    LEFT JOIN function_contacts fc ON fc.function_id = f.id_uuid
    WHERE f.contact_id::text = $1::text OR fc.contact_id::text = $1::text
    ORDER BY f.updated_at DESC NULLS LAST, f.event_date DESC NULLS LAST
    LIMIT 1;
    `,
    [contactId]
  );

  return rows[0]?.id_uuid || null;
}

/* Utility: Deduplicate messages by ID */
// eslint-disable-next-line no-unused-vars
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
   🟢 Unified Inbox (with Follow-Up + Leads + Sent + Deleted)
--------------------------------------------------------- */
router.get("/", async (req, res) => {
  try {
    const accessToken = await getAppToken();
    if (!accessToken) throw new Error("Missing Graph token - please log in");

    // --- Sync from Microsoft Graph ---
    console.log("🔄 Fetching from Microsoft Graph...");
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      SHARED_MAILBOX
    )}/mailFolders('Inbox')/messages?$top=20`;

    const graphRes = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!graphRes.ok) throw new Error(`Graph API error: ${graphRes.status}`);

    const data = await graphRes.json();
    let inserted = 0,
      skipped = 0;

    for (const m of data.value || []) {
      if (!m.id || !m.from?.emailAddress?.address) continue;

      const fromEmail = m.from.emailAddress.address;
      const subject = m.subject || "(No Subject)";
      const body = m.bodyPreview || "";
      const receivedAt = m.receivedDateTime || null;
      const conversationId = m.conversationId || `local-${m.id}`;
      const toRecipients = (m.toRecipients || [])
        .map((r) => r.emailAddress?.address)
        .filter(Boolean)
        .join(", ");
      const ccRecipients = (m.ccRecipients || [])
        .map((r) => r.emailAddress?.address)
        .filter(Boolean)
        .join(", ");

      // Try linking to a contact automatically
      let relatedContact = null;
      const contactRes = await pool.query(
        `SELECT id FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
        [fromEmail]
      );
      if (contactRes.rows.length > 0)
        relatedContact = contactRes.rows[0].id;

      const relatedFunction = await findLatestFunctionForContact(relatedContact);

      // Skip if exists but backfill missing links if we can
      const exists = await pool.query(
        `SELECT id, related_contact, related_function FROM messages WHERE graph_id = $1 LIMIT 1;`,
        [m.id]
      );
      if (exists.rowCount > 0) {
        const existingId = exists.rows[0].id;
        if (relatedContact || relatedFunction) {
          await pool.query(
            `
            UPDATE messages
            SET 
              related_contact = COALESCE(related_contact, $1),
              related_function = COALESCE(related_function, $2)
            WHERE id = $3;
            `,
            [relatedContact || null, relatedFunction || null, existingId]
          );
        }
        skipped++;
        continue;
      }

      // Insert inbound message
      await pool.query(
        `INSERT INTO messages (
          graph_id, subject, body, from_email, to_email, to_recipients,
          cc_recipients, received_at, message_type, conversation_id,
          related_contact, related_function, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,'inbound',$9,$10,$11,NOW()
        ) ON CONFLICT (graph_id) DO NOTHING;`,
        [
          m.id,
          subject,
          body,
          fromEmail,
          SHARED_MAILBOX,
          toRecipients || null,
          ccRecipients || null,
          receivedAt,
          conversationId,
          relatedContact || null,
          relatedFunction || null,
        ]
      );
      inserted++;
    }

    console.log(`📬 Sync complete → inserted: ${inserted}, skipped: ${skipped}`);

    // --- Fetch all messages ---
    const { rows: allMessages } = await pool.query(`
      SELECT 
        m.id, m.subject, m.body, m.body_html, m.from_email, m.to_email,
        m.message_type, m.created_at, m.received_at, m.deleted, m.deleted_at,
        c.name AS contact_name, f.event_name AS function_name,
        m.related_contact, m.related_function
      FROM messages m
      LEFT JOIN contacts c ON m.related_contact = c.id
      LEFT JOIN functions f ON m.related_function = f.id_uuid
      ORDER BY m.created_at DESC;
    `);

    // --- Categorize messages ---
    const inbox = allMessages.filter(m => !m.deleted && m.message_type !== "outbound");
    const leads = inbox.filter(m => !m.related_contact && !m.related_function);
    const followUp = inbox.filter(m => m.related_contact && !m.related_function);
    const sent = allMessages.filter(m => m.message_type === "outbound" && !m.deleted);
    const deleted = allMessages.filter(m => m.deleted);

    // --- Format times for NZ ---
    const formatDate = (d) =>
      d ? dayjs(d).tz("Pacific/Auckland").format("DD MMM YYYY, h:mm A") : "";

    const formatMsgs = (arr) =>
      arr.map((m) => ({
        ...m,
        created_at_nz: formatDate(m.created_at),
        received_at_nz: formatDate(m.received_at),
      }));

    // --- Render page ---
    res.render("pages/inbox", {
      layout: "layouts/main",
      title: "Inbox",
      user: req.session.user || null,
      messages: formatMsgs(inbox),
      leads: formatMsgs(leads),
      followUp: formatMsgs(followUp),
      sent: formatMsgs(sent),
      deleted: formatMsgs(deleted),
      stats: {
        total: inbox.length,
        leads: leads.length,
        followUp: followUp.length,
        sent: sent.length,
        deleted: deleted.length,
      },
      active: "inbox",
      pageJs: ["/js/inbox.js"],
    });
  } catch (err) {
    console.error("❌ [Unified Inbox] Error:", err);
    res.render("pages/inbox", {
      layout: "layouts/main",
      title: "Inbox",
      user: req.session.user || null,
      messages: [],
      leads: [],
      followUp: [],
      sent: [],
      deleted: [],
      error: "Failed to load inbox",
      enhanced: true,
      stats: { total: 0, leads: 0, followUp: 0, sent: 0, deleted: 0 },
      active: "inbox",
    });
  }
});

/* ---------------------------------------------------------
   ♻️ Restore Deleted Message
--------------------------------------------------------- */
router.post("/restore/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE messages 
       SET deleted = FALSE, deleted_at = NULL
       WHERE id = $1;`,
      [id]
    );
    console.log(`✅ Restored message ID: ${id}`);
    res.redirect("/inbox?restored=true");
  } catch (err) {
    console.error("❌ [Restore Message] Error:", err);
    res.status(500).send("Failed to restore message");
  }
});



/* ---------------------------------------------------------
   2️⃣ Message Detail
--------------------------------------------------------- */
router.get("/:id", async (req, res, next) => {
  try {
    const messageId = req.params.id;
    const reserved = ["reply", "link", "api"];
    if (reserved.includes(messageId.toLowerCase())) return next();

    // 🧩 Fetch message + linked contact/function details
    const dbRes = await pool.query(
      `SELECT m.*, c.id AS contact_id, c.name AS contact_name,
              f.id_uuid AS function_id, f.event_name AS function_name
       FROM messages m
       LEFT JOIN contacts c ON m.related_contact = c.id
       LEFT JOIN functions f ON m.related_function = f.id_uuid
       WHERE m.id = $1 LIMIT 1;`,
      [messageId]
    );
    const message = dbRes.rows[0];
    if (!message) return res.status(404).send("Message not found");

    // 🧩 Get all contacts (for contact dropdown)
    const contactsRes = await pool.query(
      "SELECT id, name FROM contacts ORDER BY name ASC;"
    );

    // 🧩 Prefer functions linked to the contact; otherwise provide recent functions as a fallback
    const functionsRes = message.related_contact
      ? await pool.query(
          `SELECT DISTINCT f.id_uuid AS id, f.event_name
           FROM functions f
           LEFT JOIN function_contacts fc ON fc.function_id = f.id_uuid
           WHERE f.contact_id::text = $1 OR fc.contact_id::text = $1
           ORDER BY f.updated_at DESC NULLS LAST, f.event_date DESC NULLS LAST;`,
          [message.related_contact]
        )
      : await pool.query(
          `SELECT f.id_uuid AS id, f.event_name
           FROM functions f
           ORDER BY f.updated_at DESC NULLS LAST, f.event_date DESC NULLS LAST
           LIMIT 50;`
        );

    // 🧩 Debug check
    console.log("🧩 [DEBUG] functions passed to EJS:", functionsRes.rows[0]);

    // ✅ Render message detail
    res.render("pages/messageDetail", {
      user: req.session.user || null,
      message,
      thread: [message], // fallback so EJS never breaks
      SENDER_EMAIL: process.env.SENDER_EMAIL || "events@poriruaclub.co.nz",
      contacts: contactsRes.rows,
      functions: functionsRes.rows || [],
      enhanced: true,
      active: "inbox",
    });
  } catch (err) {
    console.error("❌ [Message Detail] Error:", err);
    res.status(500).send(`<pre>${err.message}</pre>`);
  }
});

/* ---------------------------------------------------------
   3️⃣ Reply to Message (with Supabase Upload)
--------------------------------------------------------- */
router.post("/reply/:id", upload.single("attachment"), async (req, res) => {
  const messageId = req.params.id;
  const { subject, body_html, body, to_email, cc_email, bcc_email } = req.body;
  const file = req.file;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(`SELECT * FROM messages WHERE id=$1 LIMIT 1;`, [messageId]);
    const original = rows[0];
    if (!original) throw new Error("Original message not found");

    let accessToken = await getAppToken();
    if (!accessToken) throw new Error("No Graph token available.");

    // Optional Supabase attachment
    let uploadedFile = null;
    if (file) {
      const filePath = `inbox/${Date.now()}_${file.originalname}`;
      const { data, error } = await supabase.storage
        .from("attachments")
        .upload(filePath, file.buffer, { contentType: file.mimetype });
      if (error) throw error;
      uploadedFile = { name: file.originalname, path: data.path };
      console.log(`📎 Uploaded attachment: ${uploadedFile.path}`);
    }

    const htmlContent = body_html || body || "(No content)";

    // Auto-link contact/function
    let linkedContact = original.related_contact;
    let linkedFunction = original.related_function;

    if (!linkedContact) {
      const contactLookup = await client.query(
        `SELECT id FROM contacts WHERE LOWER(email) = ANY($1::text[]) LIMIT 1;`,
        [[(original.from_email || "").toLowerCase(), (original.to_email || "").toLowerCase()]]
      );
      if (contactLookup.rows.length > 0) linkedContact = contactLookup.rows[0].id;
    }

    if (linkedContact && !linkedFunction) {
      const funcLookup = await client.query(
        `SELECT f.id_uuid FROM functions f
         LEFT JOIN function_contacts fc ON fc.function_id = f.id_uuid
         WHERE f.contact_id=$1 OR fc.contact_id=$1
         ORDER BY f.updated_at DESC LIMIT 1;`,
        [linkedContact]
      );
      if (funcLookup.rows.length > 0) linkedFunction = funcLookup.rows[0].id_uuid;
    }

    const conversationId = original.conversation_id || `local-${original.id}`;

    // Send via Microsoft Graph
    const mailData = {
      to: (to_email ? to_email.split(",") : [original.from_email]).map((e) => e.trim()),
      cc: cc_email ? cc_email.split(",").map((e) => e.trim()) : [],
      bcc: bcc_email ? bcc_email.split(",").map((e) => e.trim()) : [],
      subject,
      body: htmlContent,
      attachments: uploadedFile
        ? [
            {
              name: uploadedFile.name,
              contentType: file.mimetype,
              contentBytes: file.buffer.toString("base64"),
            },
          ]
        : [],
    };

    await graphService.sendMail(accessToken, mailData);
    console.log(`📧 Sent reply → ${mailData.to.join(", ")}`);

    // Save outbound message
    await client.query(
      `INSERT INTO messages (
        message_type, from_email, to_email, subject, body, body_html,
        to_recipients, cc_recipients, related_contact, related_function,
        conversation_id, created_at, updated_at
      ) VALUES (
        'outbound', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()
      );`,
      [
        SENDER_EMAIL,
        mailData.to.join(", "),
        subject,
        htmlContent.replace(/<[^>]+>/g, ""),
        htmlContent,
        mailData.to.join(", "),
        mailData.cc.join(", ") || null,
        linkedContact || null,
        linkedFunction || null,
        conversationId,
      ]
    );

    await client.query("COMMIT");
    res.redirect(`/inbox/${messageId}?sent=true`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ [Reply] Error:", err.message);
    res.status(500).send(`<h2>Reply Failed</h2><pre>${err.message}</pre>`);
  } finally {
    client.release();
  }
});
/* ---------------------------------------------------------
   4️⃣ Link Message → Contact / Function (Final Safe Redirect Version)
--------------------------------------------------------- */
router.post("/link/:id", async (req, res) => {
  try {
    console.log("🧩 [DEBUG] req.body:", req.body);
    const { id } = req.params;
    const { contact_id, function_id } = req.body;

    if (!id) throw new Error("Missing message ID");

    // Dynamic query to only update provided fields
    let query = "";
    let params = [];

    if (contact_id && function_id) {
      query = `
        UPDATE messages 
        SET related_contact = $1, related_function = $2
        WHERE id = $3;`;
      params = [contact_id, function_id, id];
    } else if (contact_id) {
      query = `
        UPDATE messages 
        SET related_contact = $1
        WHERE id = $2;`;
      params = [contact_id, id];
    } else if (function_id) {
      query = `
        UPDATE messages 
        SET related_function = $1
        WHERE id = $2;`;
      params = [function_id, id];
    } else {
      throw new Error("No contact or function provided to link");
    }

    await pool.query(query, params);

    console.log(
      `✅ Linked message ${id} → contact:${contact_id || "none"} function:${function_id || "none"}`
    );

    // ✅ Safe HTML redirect (no JSON)
    res.redirect(`/inbox/${id}?linked=both`);
  } catch (err) {
    console.error("❌ [Link Message] Error:", err);
    res.status(500).send("Failed to link message");
  }
});

/* ---------------------------------------------------------
   5️⃣ Get Functions by Contact (API)
--------------------------------------------------------- */
router.get("/api/functions/by-contact/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;
    const { rows } = await pool.query(
      `SELECT DISTINCT f.id_uuid AS id, f.event_name
       FROM functions f
       LEFT JOIN function_contacts fc ON fc.function_id = f.id_uuid
       WHERE f.contact_id::text = $1 OR fc.contact_id::text = $1
       ORDER BY f.event_name;`,
      [contactId]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ [API] Functions by Contact:", err);
    res.status(500).json({ error: err.message });
  }
});
/* ---------------------------------------------------------
   🗑️ Delete Message (Soft delete)
--------------------------------------------------------- */
router.post("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE messages 
       SET deleted = TRUE, deleted_at = NOW()
       WHERE id = $1;`,
      [id]
    );
    console.log(`🗑️ Message ${id} soft-deleted.`);
    res.redirect("/inbox?deleted=true");
  } catch (err) {
    console.error("❌ [Delete Message] Error:", err);
    res.status(500).send("Failed to delete message");
  }
});


module.exports = router;
