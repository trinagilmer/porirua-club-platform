const express = require("express");
const router = express.Router();
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

/**
 * 📥 Porirua Club Inbox – integrated EJS dashboard view
 * Fetches recent emails via Microsoft Graph and renders using layout.
 */

router.get("/", async (req, res) => {
  if (!req.session.graphToken) {
    console.log("⚠️ No Microsoft token found. Redirecting to Microsoft login...");
    return res.redirect("/auth/graph/login");
  }

  const clubEmail = "manager@poriruaclub.co.nz";
  const keywords = ["Function", "Booking", "Proposal", "Porirua Club"];
  const searchQuery = keywords.map((k) => `"${k}"`).join(" OR ");
  const graphUrl = `https://graph.microsoft.com/v1.0/me/mailFolders('Inbox')/messages?$top=25&$search=${encodeURIComponent(
    searchQuery
  )}`;

  try {
    console.log("🔎 Fetching messages from Graph (search + local filter)...");

    const response = await fetch(graphUrl, {
      headers: {
        Authorization: `Bearer ${req.session.graphToken}`,
        ConsistencyLevel: "eventual",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ Graph API Error:", errText);
      return res
        .status(500)
        .render("pages/inbox", { title: "Inbox", user: req.session.user, messages: [], error: "Error fetching messages from Microsoft Graph" });
    }

    const data = await response.json();

    // Local filter to match Porirua Club messages
    const messages = (data.value || []).filter((m) => {
      const from = m.from?.emailAddress?.address?.toLowerCase() || "";
      const toList = (m.toRecipients || []).map(
        (r) => r.emailAddress?.address?.toLowerCase()
      );
      return (
        from.includes(clubEmail.toLowerCase()) ||
        toList.includes(clubEmail.toLowerCase())
      );
    });

    res.render("pages/inbox", {
      title: "Inbox",
      user: req.session.user,
      active: "inbox",
      messages,
      error: null,
    });
  } catch (err) {
    console.error("💥 Error loading inbox:", err);
    res
      .status(500)
      .render("pages/inbox", { title: "Inbox", user: req.session.user, messages: [], error: "Server error loading inbox" });
  }
});

module.exports = router;


