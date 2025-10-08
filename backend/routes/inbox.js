/**
 * 📬 Porirua Club Platform
 * Module 2C: Enhanced Inbox + Linked Intelligence + Safe Normalization
 * Dependencies: ensureGraphToken, Supabase, graphService
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles memory uploads
const { supabase } = require("../db");
const { ensureGraphToken } = require("../middleware/graphTokenMiddleware");
const { getValidGraphToken } = require("../utils/graphAuth");
const graphService = require("../services/graphService");

// 🧩 Apply Graph token validation to all inbox routes
router.use(ensureGraphToken);

/* ---------------------------------------------------------
   📥 1️⃣ Microsoft Graph Inbox (Outlook Messages)
--------------------------------------------------------- */
router.get("/", async (req, res, next) => {
  try {
    const sharedMailbox = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
    const keywords = ["Function", "Booking", "Proposal", "Porirua Club"];
    const searchQuery = keywords.map(k => `"${k}"`).join(" OR ");
    const graphUrl = `https://graph.microsoft.com/v1.0/users('${sharedMailbox}')/mailFolders('Inbox')/messages?$top=20&$search=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(graphUrl, {
      headers: {
        Authorization: `Bearer ${req.session.graphToken}`,
        ConsistencyLevel: "eventual",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ Graph API Error:", errText);
      throw new Error(`Graph API failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Retrieved ${data.value?.length || 0} messages`);

    // ✅ Normalize messages to prevent "undefined from" crashes
    const normalizedMessages = (data.value || []).map(m => ({
      ...m,
      source: "Outlook",
      from: m.from || { emailAddress: { address: "(Unknown sender)", name: "(Unknown)" } },
      toRecipients: m.toRecipients || [],
    }));

    res.render("pages/inbox", {
      user: req.session.user || null,
      messages: normalizedMessages,
      error: null,
    });
  } catch (err) {
    console.error("💥 Full error trace:", err);
    next(err);
  }
});

/* ---------------------------------------------------------
   📄 2️⃣ Message Detail View (Supabase Messages)
--------------------------------------------------------- */
router.get("/:id", async (req, res) => {
  try {
    const messageId = req.params.id;

    const { data: message, error } = await supabase
      .from("messages")
      .select("*, documents(file_name, file_url)")
      .eq("id", messageId)
      .single();

    if (error) throw error;
    if (!message) return res.status(404).send("Message not found");

    // 🧠 Normalize Supabase message (avoid .from undefined)
    message.source = "Supabase";
    if (message && typeof message.from === "object") {
      message.from_email =
        message.from?.emailAddress?.address ||
        message.from_email ||
        "(Unknown sender)";
    }

    if (!message.to_email && message.to?.emailAddress?.address) {
      message.to_email = message.to.emailAddress.address;
    }

    const { data: contacts } = await supabase.from("contacts").select("id, name");
    const { data: functions } = await supabase.from("functions").select("id, event_name");

    res.render("pages/messageDetail", {
      message: {
        ...message,
        from_email: message.from_email || "(Unknown sender)",
        to_email: message.to_email || "(Unknown recipient)",
        subject: message.subject || "(No subject)",
        body_html: message.body || "",
      },
      contacts,
      functions,
    });
  } catch (err) {
    console.error("❌ Error rendering message detail:", err.message);
    res
      .status(500)
      .send(`<h2>Error rendering message detail</h2><pre>${err.message}</pre>`);
  }
});

/* ---------------------------------------------------------
   🔗 3️⃣ Manual Link Route
--------------------------------------------------------- */
router.post("/link/:id", async (req, res) => {
  try {
    const { contact_id, function_id } = req.body;
    const messageId = req.params.id;

    const { error } = await supabase
      .from("messages")
      .update({
        related_contact: contact_id || null,
        related_function: function_id || null,
      })
      .eq("id", messageId);

    if (error) throw error;

    console.log(
      `🔗 Message ${messageId} linked to contact:${contact_id} / function:${function_id}`
    );
    return res.json({ success: true, message: "Message successfully linked." });
  } catch (err) {
    console.error("❌ Manual link failed:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ---------------------------------------------------------
   💬 4️⃣ Reply with Attachments
--------------------------------------------------------- */
router.post("/reply/:id", upload.single("attachment"), async (req, res) => {
  const messageId = req.params.id;
  const { subject, body } = req.body;
  const file = req.file;

  try {
    const accessToken = await getValidGraphToken(req);

    // 🗂️ Upload attachment if exists
    let uploadedFile = null;
    if (file) {
      const filePath = `inbox/${Date.now()}_${file.originalname}`;
      const { data, error } = await supabase.storage
        .from("attachments")
        .upload(filePath, file.buffer, { contentType: file.mimetype });

      if (error) throw error;
      uploadedFile = { name: file.originalname, path: data.path };
    }

    // 📨 Fetch original message
    const { data: original, error: fetchError } = await supabase
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .single();
    if (fetchError) throw fetchError;

    // 🧩 Build reply payload
    const mailData = {
      to: original.from_email,
      subject,
      body,
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

    // ✉️ Send via Microsoft Graph
    await graphService.sendMail(accessToken, mailData);

    // 🧾 Insert outbound record
    const { error: insertError } = await supabase.from("messages").insert({
      conversation_id: original.conversation_id,
      from_email: "events@poriruaclub.co.nz",
      to_email: original.from_email,
      subject,
      body,
      message_type: "outbound",
      related_contact: original.related_contact || null,
      related_function: original.related_function || null,
      created_at: new Date(),
    });
    if (insertError) throw insertError;

    // 🧱 Log document if uploaded
    if (uploadedFile) {
      await supabase.from("documents").insert({
        message_id: messageId,
        file_name: uploadedFile.name,
        file_url: uploadedFile.path,
      });
    }

    console.log(`✅ Reply sent successfully to ${original.from_email}`);
    return res.redirect(`/inbox/${messageId}`);
  } catch (err) {
    console.error("❌ Reply failed:", err.message);
    res
      .status(500)
      .send(`<h2>Reply Failed</h2><pre>${err.message}</pre>`);
  }
});

/* ---------------------------------------------------------
   🚀 5️⃣ Enhanced Inbox – Supabase-Joined Intelligence View
--------------------------------------------------------- */
router.get("/enhanced", async (req, res) => {
  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select(`
        id, subject, body, message_type, created_at, received_at, from_email, to_email,
        related_contact, related_function, related_booking,
        contacts:related_contact(name, email, phone),
        functions:related_function(event_name, event_date)
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Compute stats for filters
    const total = messages.length;
    const linked = messages.filter(m => m.related_contact || m.related_function).length;
    const unlinked = total - linked;

    // ✅ Add source badges
    const enhancedMessages = messages.map(m => ({
      ...m,
      source: "Supabase",
    }));

    res.render("pages/inbox", {
      user: req.session.user || null,
      messages: enhancedMessages,
      error: null,
      enhanced: true,
      stats: { total, linked, unlinked },
    });
  } catch (err) {
    console.error("❌ Enhanced Inbox Error:", err);
    res.render("pages/inbox", {
      user: req.session.user || null,
      messages: [],
      error: "Failed to load enhanced inbox",
      enhanced: true,
      stats: { total: 0, linked: 0, unlinked: 0 },
    });
  }
});

module.exports = router;

