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
    // 🔍 Basic validation
    if (!m.id || !m.from?.emailAddress?.address) {
      console.warn(`⚠️ Skipped message with missing ID or sender: ${m.subject}`);
      skipped++;
      continue;
    }

    // 📦 Core fields
    const fromEmail = m.from?.emailAddress?.address || "";
    const subject = m.subject || "(No Subject)";
    const body = m.bodyPreview || "";
    const receivedAt = m.receivedDateTime || null;
   // 🧩 Determine conversation ID intelligently
let conversationId = m.conversationId || null;

if (!conversationId) {
  try {
    // 1️⃣  Try to find an existing local thread by subject + contact
    const convLookup = await pool.query(
      `
      SELECT conversation_id
      FROM messages
      WHERE LOWER(subject) = LOWER($1)
        AND (
          related_contact = $2
          OR from_email = $3
          OR to_email = $3
        )
        AND conversation_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1;
      `,
      [m.subject || "", relatedContact || null, fromEmail]
    );

    if (convLookup.rows.length > 0) {
      conversationId = convLookup.rows[0].conversation_id;
      console.log(`🔗 Re-used existing conversation ID: ${conversationId}`);
    } else {
      // 2️⃣  Generate a synthetic local thread ID
      conversationId = `local-${m.id}`;
      console.log(`🧵 Created new local conversation ID: ${conversationId}`);
    }
  } catch (convErr) {
    console.warn("⚠️ Conversation ID lookup failed:", convErr.message);
    conversationId = `local-${m.id}`;
  }
}


    // 🧩 Extract all recipients (To + CC)
    const toRecipients = (m.toRecipients || [])
      .map(r => r.emailAddress?.address)
      .filter(Boolean)
      .join(", ");

    const ccRecipients = (m.ccRecipients || [])
      .map(r => r.emailAddress?.address)
      .filter(Boolean)
      .join(", ");

    try {
      // 🚫 Skip if message already exists
      const existing = await pool.query(
        `SELECT id FROM messages WHERE graph_id = $1 LIMIT 1;`,
        [m.id]
      );
      if (existing.rowCount > 0) {
        skipped++;
        continue;
      }

      // 👤 Try to match sender with an existing contact
      let relatedContact = null;
      const contactMatch = await pool.query(
        `SELECT id FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
        [fromEmail]
      );
      if (contactMatch.rows.length > 0) {
        relatedContact = contactMatch.rows[0].id;
        console.log(`📇 Matched contact for inbound email: ${fromEmail}`);
      }

      // 🧠 Try to link this email to a prior conversation (thread)
      let relatedFunction = null;
      if (conversationId) {
        const prevMsg = await pool.query(
          `SELECT related_contact, related_function
           FROM messages
           WHERE conversation_id = $1
           ORDER BY created_at DESC
           LIMIT 1;`,
          [conversationId]
        );

        if (prevMsg.rows.length > 0) {
          // Link to same contact or function as prior messages
          relatedContact = relatedContact || prevMsg.rows[0].related_contact || null;
          relatedFunction = prevMsg.rows[0].related_function || null;
          console.log(`🔗 Linked inbound via conversation (${conversationId})`);
        }
      }

      // 🧩 If still no contact match, try matching any of the To/CC recipients
      if (!relatedContact) {
        const possibleMatchEmails = [
          ...toRecipients.split(",").map(e => e.trim()),
          ...ccRecipients.split(",").map(e => e.trim())
        ].filter(Boolean);

        if (possibleMatchEmails.length > 0) {
          const matchRes = await pool.query(
            `SELECT id FROM contacts WHERE LOWER(email) = ANY($1::text[]) LIMIT 1;`,
            [possibleMatchEmails.map(e => e.toLowerCase())]
          );

          if (matchRes.rows.length > 0) {
            relatedContact = matchRes.rows[0].id;
            console.log(`📬 Matched contact from recipients: ${possibleMatchEmails.join(", ")}`);
          }
        }
      }

      // 🧾 Insert message record (single, unified insert)
      const insertRes = await pool.query(
        `INSERT INTO messages (
          graph_id,
          subject,
          body,
          from_email,
          to_email,
          to_recipients,
          cc_recipients,
          received_at,
          message_type,
          conversation_id,
          related_contact,
          related_function,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'inbound', $9, $10, $11, NOW()
        )
        ON CONFLICT (graph_id) DO NOTHING
        RETURNING id;`,
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
          relatedFunction || null
        ]
      );

      if (insertRes.rowCount > 0) {
        inserted++;
        console.log(`📥 Saved new inbound email: ${subject}`);
      } else {
        skipped++;
      }
    } catch (err) {
      console.error("❌ [Graph Sync Insert Error]:", err.message);
      skipped++;
    }
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
  layout: "layouts/main",
  title: "Inbox",
  user: req.session.user || null,
  messages,
  error: null,
  enhanced: true,
  stats: { total, linked, unlinked },
  active: "inbox",
  pageCss: ["/css/inbox.css"],   // ✅ <-- load your inbox styles
  pageJs: ["/js/inbox.js"],      // ✅ <-- load your inbox JS
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
   📄 2️⃣ Message Detail (Postgres + Graph Fallback + Conversation Thread)
--------------------------------------------------------- */
router.get("/:id", async (req, res, next) => {
  try {
    const messageId = req.params.id;
    const reserved = ["enhanced", "match", "reply", "link", "cleanup"];
    if (reserved.includes(messageId.toLowerCase())) return next();

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(messageId)) {
      return res
        .status(400)
        .send(`<h2>Invalid message ID</h2><pre>${messageId}</pre>`);
    }

    // ✅ Fetch message with linked contact + function info
    const dbRes = await pool.query(
      `
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
    `,
      [messageId]
    );

    let message = dbRes.rows[0];

    // 📨 If not found in DB, try Graph API as fallback
    if (!message) {
      const accessToken = req.session.graphToken;
      const graphUrl = `https://graph.microsoft.com/v1.0/users('${SHARED_MAILBOX}')/messages/${messageId}`;
      const response = await fetch(graphUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok)
        throw new Error(
          `Graph fetch failed: ${response.status} ${response.statusText}`
        );

      const graphMessage = await response.json();

      message = {
        id: graphMessage.id,
        subject: graphMessage.subject || "(No Subject)",
        from_email:
          graphMessage.from?.emailAddress?.address || "(Unknown sender)",
        to_email:
          graphMessage.toRecipients?.[0]?.emailAddress?.address ||
          "(Unknown recipient)",
        body_html: graphMessage.body?.content || "(No content)",
        created_at:
          graphMessage.receivedDateTime || new Date().toISOString(),
        source: "Outlook",
        conversation_id: graphMessage.conversationId || null, // ✅ include Graph thread id if exists
      };
    }

    // 📇 Load contacts for dropdown linking
    const contactsRes = await pool.query("SELECT id, name FROM contacts;");

    // 📅 Load functions linked to contact (if any)
    let functionsRes;
    if (message.related_contact) {
      functionsRes = await pool.query(
        `
        SELECT DISTINCT f.id, f.event_name
        FROM functions f
        LEFT JOIN function_contacts fc ON fc.function_id = f.id
        WHERE (f.contact_id::text = $1 OR fc.contact_id::text = $1)
        ORDER BY f.event_name;
      `,
        [message.related_contact]
      );
    } else {
      functionsRes = { rows:   [] };
    }

// 🧩 Conversation Thread Fetch (Enhanced)
let thread = [];

try {
  if (message.conversation_id) {
    // ✅ Normal thread retrieval by conversation_id
    const threadRes = await pool.query(
      `
      SELECT id, subject, from_email, to_email, body_html, body, message_type, created_at
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC;
      `,
      [message.conversation_id]
    );
    thread = threadRes.rows;
  } else {
    // ⚙️ Fallback: match by subject + contact or show single message
    const threadRes = await pool.query(
      `
      SELECT id, subject, from_email, to_email, body_html, body, message_type, created_at
      FROM messages
      WHERE LOWER(subject) = LOWER($1)
        AND (
          related_contact = $2
          OR from_email = $3
          OR to_email = $3
        )
      ORDER BY created_at ASC;
      `,
      [message.subject || "", message.related_contact || null, message.from_email || ""]
    );
    thread = threadRes.rows;
    if (!thread || thread.length === 0) {
      // If no related thread found, show just the single message
      thread = [message];
    } else {
      console.log(`🧵 Fallback thread loaded (${thread.length} messages)`);
    }
  }
} catch (threadErr) {
  console.warn("⚠️ Failed to load conversation thread:", threadErr.message);
  // Ensure UI still gets at least the single message
  thread = thread.length ? thread : [message];
}

// Render the message detail page
res.render("pages/messageDetail", {
  user: req.session.user || null,
  message,
  thread,
  SENDER_EMAIL: process.env.SENDER_EMAIL || "events@poriruaclub.co.nz",
  contacts: contactsRes.rows,
  functions: functionsRes.rows || [],
  enhanced: true,
  active: "inbox",
});
} catch (err) {
  console.error("❌ [Message Detail] Error:", err);
  res.status(500).send(`<h3>Failed to load message</h3><pre>${err.message}</pre>`);
}
});
/* ---------------------------------------------------------
   📄  REPLY (Transaction-safe + Auto-linking)
--------------------------------------------------------- */
router.post("/reply/:id", ensureGraphToken, upload.single("attachment"), async (req, res) => {
  const messageId = req.params.id;
  const { subject, body, body_html, redirect, to_email, cc_email, bcc_email } = req.body;
  const file = req.file;

  const client = await pool.connect(); // 🧠 Manual connection for transaction
  try {
    await client.query("BEGIN");
    let accessToken = req.session.graphToken || (await getValidGraphToken(req));
    if (!accessToken) throw new Error("No Graph token available. Please log in again.");

    // ✅ Find the original message
    const { rows } = await client.query(`SELECT * FROM messages WHERE id=$1 LIMIT 1;`, [messageId]);
    const original = rows[0];
    if (!original) throw new Error("Original message not found");

    // ✅ Upload attachment (Supabase)
    let uploadedFile = null;
    if (file) {
      try {
        const filePath = `inbox/${Date.now()}_${file.originalname}`;
        const { data, error } = await supabase.storage
          .from("attachments")
          .upload(filePath, file.buffer, { contentType: file.mimetype });
        if (error) throw error;
        uploadedFile = { name: file.originalname, path: data.path };
        console.log(`📎 File uploaded → ${uploadedFile.path}`);
      } catch (uploadErr) {
        console.error("❌ [Supabase Upload Failed]:", uploadErr.message);
      }
    }

    const htmlContent = body_html || body || "(No content)";

    // 🧩 Auto-link contact & function
    let linkedContact = original.related_contact;
    let linkedFunction = original.related_function;

    // 1️⃣ Lookup by sender/recipient
    if (!linkedContact) {
      const contactLookup = await client.query(
        `SELECT id FROM contacts WHERE LOWER(email) = ANY($1::text[]) LIMIT 1;`,
        [[
          (original.from_email || "").toLowerCase(),
          (original.to_email || "").toLowerCase(),
          (SENDER_EMAIL || "").toLowerCase(),
        ].filter(Boolean)]
      );
      if (contactLookup.rows.length > 0) {
        linkedContact = contactLookup.rows[0].id;
        console.log(`📇 Auto-linked contact from email match → ${linkedContact}`);
      }
    }

    // 2️⃣ Fallback: thread-based adoption
    if (!linkedContact && original.conversation_id) {
      const threadLookup = await client.query(
        `SELECT related_contact FROM messages
         WHERE conversation_id=$1 AND related_contact IS NOT NULL
         ORDER BY created_at DESC LIMIT 1;`,
        [original.conversation_id]
      );
      if (threadLookup.rows.length > 0) {
        linkedContact = threadLookup.rows[0].related_contact;
        console.log(`🔗 Adopted contact from thread → ${linkedContact}`);
      }
    }

    // 3️⃣ Attach function if contact found
    if (linkedContact && !linkedFunction) {
      const funcLookup = await client.query(
        `SELECT f.id
         FROM functions f
         LEFT JOIN function_contacts fc ON fc.function_id = f.id
         WHERE f.contact_id=$1 OR fc.contact_id=$1
         ORDER BY f.updated_at DESC NULLS LAST
         LIMIT 1;`,
        [linkedContact]
      );
      if (funcLookup.rows.length > 0) {
        linkedFunction = funcLookup.rows[0].id;
        console.log(`🧩 Auto-linked function for contact → ${linkedFunction}`);
      }
    }

    // 🧠 Determine conversation ID
    let conversationId = original.conversation_id || original.graph_id || null;
    if (!conversationId) {
      try {
        const convLookup = await client.query(
          `SELECT conversation_id
           FROM messages
           WHERE LOWER(subject)=LOWER($1)
             AND (related_contact=$2 OR from_email=$3 OR to_email=$3)
             AND conversation_id IS NOT NULL
           ORDER BY created_at DESC LIMIT 1;`,
          [original.subject || "", linkedContact || null, original.from_email]
        );

        if (convLookup.rows.length > 0) {
          conversationId = convLookup.rows[0].conversation_id;
          console.log(`🔗 Re-used conversation ID → ${conversationId}`);
        } else {
          conversationId = `local-${original.id}`;
          console.log(`🧵 Created new local conversation ID → ${conversationId}`);
        }
      } catch (convErr) {
        console.warn("⚠️ Conversation ID lookup failed:", convErr.message);
        conversationId = `local-${original.id}`;
      }
    }

    // ✅ Prepare mail for Microsoft Graph
    const mailData = {
      to: (to_email && to_email.trim())
        ? to_email.split(",").map(a => a.trim()).filter(Boolean)
        : [original.from_email],
      cc: (cc_email && cc_email.trim())
        ? cc_email.split(",").map(a => a.trim()).filter(Boolean)
        : [],
      bcc: (bcc_email && bcc_email.trim())
        ? bcc_email.split(",").map(a => a.trim()).filter(Boolean)
        : [],
      subject,
      body: htmlContent,
      attachments: uploadedFile
        ? [{
            name: uploadedFile.name,
            contentType: file.mimetype,
            contentBytes: file.buffer.toString("base64"),
          }]
        : [],
    };

    // ✅ Send via Microsoft Graph
    await graphService.sendMail(accessToken, mailData);
    console.log(`📧 Sent reply → ${mailData.to.join(", ")}`);

    // ✅ Insert outbound message (atomic transaction)
    const insertRes = await client.query(
      `INSERT INTO messages (
        message_type, from_email, to_email, subject, body, body_html,
        to_recipients, cc_recipients, related_contact, related_function,
        conversation_id, created_at, updated_at
      ) VALUES (
        'outbound', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()
      ) RETURNING id;`,
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
    console.log(`✅ Outbound reply saved — DB ID: ${insertRes.rows[0].id}`);

    return res.redirect(redirect || `/inbox/${messageId}?sent=true`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ [Reply] Failed:", err.message);
    res.status(500).send(`<h2>Reply Failed</h2><pre>${err.message}</pre>`);
  } finally {
    client.release();
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
