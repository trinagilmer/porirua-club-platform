/**
 * 📬 Porirua Club Platform
 * Module 2C: Enhanced Inbox + Linked Intelligence + Safe Normalization
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const fetch = require("node-fetch");

const { supabase } = require("../db");
const { ensureGraphToken } = require("../middleware/graphTokenMiddleware");
const { getValidGraphToken } = require("../utils/graphAuth");
const graphService = require("../services/graphService");

/* ---------------------------------------------------------
   🟩 1️⃣ Enhanced Supabase Inbox (Safe + Intelligent)
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

    // ✅ Normalize safely
    const enhancedMessages = (messages || []).map((m) => ({
      id: m.id,
      subject: m.subject || "(No Subject)",
      body: m.body || "(No Content)",
      from_email: m.from_email || "(Unknown sender)",
      to_email: m.to_email || "(Unknown recipient)",
      created_at: m.created_at || m.received_at || new Date().toISOString(),
      related_contact: m.related_contact || null,
      related_function: m.related_function || null,
      contacts: m.contacts || null,
      functions: m.functions || null,
      source: "Supabase",
    }));

    const total = enhancedMessages.length;
    const linked = enhancedMessages.filter(
      (m) => m.related_contact || m.related_function
    ).length;
    const unlinked = total - linked;

    // 🧠 Developer summary (for console)
    console.log("========================================");
    console.log("📊 Enhanced Inbox Summary");
    console.log(`📦 Total: ${total}`);
    console.log(`🔗 Linked: ${linked}`);
    console.log(`❌ Unlinked: ${unlinked}`);
    console.log(
      "📧 Recent senders:",
      enhancedMessages.slice(0, 5).map((m) => m.from_email)
    );
    console.log("========================================\n");

    res.render("pages/inbox", {
      user: req.session.user || null,
      messages: enhancedMessages,
      error: null,
      enhanced: true,
      stats: { total, linked, unlinked },
    });
  } catch (err) {
    console.error("❌ [Enhanced Inbox] Error:", err);
    res.render("pages/inbox", {
      user: req.session.user || null,
      messages: [],
      error: "Failed to load enhanced inbox",
      enhanced: true,
      stats: { total: 0, linked: 0, unlinked: 0 },
    });
  }
});

/* ---------------------------------------------------------
   🟦 2️⃣ Outlook Inbox via Microsoft Graph
--------------------------------------------------------- */
router.get("/", ensureGraphToken, async (req, res, next) => {
  try {
    const sharedMailbox = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
    const keywords = ["Function", "Booking", "Proposal", "Porirua Club"];
    const searchQuery = keywords.map((k) => `"${k}"`).join(" OR ");
    const graphUrl = `https://graph.microsoft.com/v1.0/users('${sharedMailbox}')/mailFolders('Inbox')/messages?$top=20&$search=${encodeURIComponent(
      searchQuery
    )}`;

    const response = await fetch(graphUrl, {
      headers: {
        Authorization: `Bearer ${req.session.graphToken}`,
        ConsistencyLevel: "eventual",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Graph API failed: ${response.status} ${response.statusText} – ${errText}`);
    }

    const data = await response.json();
    console.log(`✅ [Graph Inbox] Retrieved ${data.value?.length || 0} messages`);

    const messages = (data.value || []).map((m) => ({
      ...m,
      from: m?.from?.emailAddress
        ? m.from
        : { emailAddress: { name: "(Unknown)", address: "(Unknown sender)" } },
      toRecipients:
        Array.isArray(m?.toRecipients) && m.toRecipients.length > 0
          ? m.toRecipients
          : [{ emailAddress: { name: "(Unknown)", address: "(Unknown recipient)" } }],
      source: "Outlook",
    }));

    res.render("pages/inbox", {
      user: req.session.user || null,
      messages,
      error: null,
      enhanced: false,
      stats: {},
    });
  } catch (err) {
    console.error("💥 [Graph Inbox] Error:", err);
    next(err);
  }
});

/* ---------------------------------------------------------
   📄 3️⃣ Message Detail View (Supabase + Outlook fallback)
--------------------------------------------------------- */
router.get("/:id", async (req, res, next) => {
  try {
    const messageId = req.params.id;
    const reserved = ["enhanced"];
    if (reserved.includes(messageId.toLowerCase())) return next();

    console.log(`🧠 [Message Detail] Called with ID: ${messageId}`);

    const { data: message, error } = await supabase
      .from("messages")
      .select("*, documents(file_name, file_url)")
      .eq("id", messageId)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    if (!message) {
      console.log("🟦 [Fallback] Fetching message from Outlook (Graph)");
      const sharedMailbox = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
      const graphUrl = `https://graph.microsoft.com/v1.0/users('${sharedMailbox}')/messages/${messageId}`;

      const response = await fetch(graphUrl, {
        headers: { Authorization: `Bearer ${req.session.graphToken}` },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Graph fetch failed: ${response.status} ${text}`);
      }

      const graphMessage = await response.json();
      const safeMessage = {
        id: graphMessage.id,
        subject: graphMessage.subject || "(No Subject)",
        from_email: graphMessage.from?.emailAddress?.address || "(Unknown sender)",
        to_email:
          graphMessage.toRecipients?.[0]?.emailAddress?.address ||
          "(Unknown recipient)",
        body_html: graphMessage.body?.content || "(No content)",
        created_at: graphMessage.receivedDateTime || new Date().toISOString(),
        source: "Outlook",
      };

      return res.render("pages/messageDetail", {
        message: safeMessage,
        contacts: [],
        functions: [],
      });
    }

    const [contactsRes, functionsRes] = await Promise.all([
      supabase.from("contacts").select("id, name"),
      supabase.from("functions").select("id, event_name"),
    ]);

    const safeMessage = {
      ...message,
      from_email: message.from_email || "(Unknown sender)",
      to_email: message.to_email || "(Unknown recipient)",
      subject: message.subject || "(No subject)",
      body_html: message.body || "",
      source: "Supabase",
    };

    res.render("pages/messageDetail", {
      message: safeMessage,
      contacts: contactsRes.data || [],
      functions: functionsRes.data || [],
    });
  } catch (err) {
    console.error("❌ [Message Detail] Error:", err);
    res
      .status(500)
      .send(`<h2>Error rendering message detail</h2><pre>${err.message}</pre>`);
  }
});

/* ---------------------------------------------------------
   🔗 4️⃣ Manual Link Route
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
      `🔗 [Link] Message ${messageId} linked to contact:${contact_id} / function:${function_id}`
    );
    return res.json({ success: true, message: "Message successfully linked." });
  } catch (err) {
    console.error("❌ [Link Route] Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ---------------------------------------------------------
   💬 5️⃣ Reply with Attachments
--------------------------------------------------------- */
router.post("/reply/:id", upload.single("attachment"), async (req, res) => {
  const messageId = req.params.id;
  const { subject, body } = req.body;
  const file = req.file;

  try {
    const accessToken = await getValidGraphToken(req);
    let uploadedFile = null;

    if (file) {
      const filePath = `inbox/${Date.now()}_${file.originalname}`;
      const { data, error } = await supabase.storage
        .from("attachments")
        .upload(filePath, file.buffer, { contentType: file.mimetype });

      if (error) throw error;
      uploadedFile = { name: file.originalname, path: data.path };
    }

    const { data: original, error: fetchError } = await supabase
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .single();

    if (fetchError) throw fetchError;

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

    await graphService.sendMail(accessToken, mailData);

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

    if (uploadedFile) {
      await supabase.from("documents").insert({
        message_id: messageId,
        file_name: uploadedFile.name,
        file_url: uploadedFile.path,
      });
    }

    console.log(`✅ [Reply] Sent successfully to ${original.from_email}`);
    res.redirect(`/inbox/${messageId}`);
  } catch (err) {
    console.error("❌ [Reply] Failed:", err.message);
    res.status(500).send(`<h2>Reply Failed</h2><pre>${err.message}</pre>`);
  }
});

module.exports = router;

