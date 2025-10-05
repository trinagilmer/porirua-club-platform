const express = require("express");
const router = express.Router();

router.get("/", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  res.render("pages/inbox", {
    title: "Inbox",
    user: req.session.user,
    messages: [], // will be filled from Microsoft Graph later
  });
});

module.exports = router;
