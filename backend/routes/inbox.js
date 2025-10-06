const express = require("express");
const router = express.Router();

// ✅ if Node < 18, uncomment next line
// const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

router.get("/", async (req, res, next) => {
  try {
    if (!req.session.graphToken) {
      console.log("⚠️ No Microsoft token found — redirecting...");
      return res.redirect("/auth/graph/login");
    }

    const sharedMailbox = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
    const keywords = ["Function", "Booking", "Proposal", "Porirua Club"];
    const searchQuery = keywords.map(k => `"${k}"`).join(" OR ");

    const graphUrl = `https://graph.microsoft.com/v1.0/users('${sharedMailbox}')/mailFolders('Inbox')/messages?$top=20&$search=${encodeURIComponent(searchQuery)}`;
    console.log("📨 Fetching from:", graphUrl);

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
    res.send("OK - messages loaded");
  } catch (err) {
    console.error("💥 Full error trace:", err);
    next(err); // Pass to Express for consistent error reporting
  }
});

module.exports = router;


