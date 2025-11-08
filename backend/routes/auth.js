// backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcrypt");
const { pool } = require("../db");
const { cca } = require("../auth/msal"); // ✅ import the shared MSAL client

const router = express.Router();

/* =========================================================
   LOCAL LOGIN / REGISTER / LOGOUT
========================================================= */

// --- LOGIN ---
router.get("/login", (req, res) => {
  res.render("pages/login", { error: null, title: "Login" });
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

    if (!rows.length)
      return res.render("pages/login", { error: "Invalid email or password", title: "Login" });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.render("pages/login", { error: "Invalid email or password", title: "Login" });

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    // Automatically start Microsoft Graph login  
    res.redirect(`/auth/graph/login?next=/dashboard`);
  } catch (err) {
    next(err);
  }
});

// --- REGISTER ---
router.get("/register", (req, res) => {
  res.render("pages/register", { error: null, title: "Register" });
});

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const { rows: existing } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existing.length)
      return res.render("pages/register", { error: "Email already in use", title: "Register" });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name, email, hash, "user"]
    );

    req.session.user = rows[0];
    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// --- LOGOUT ---
router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});
/* =========================================================
   MICROSOFT 365 LOGIN (MS GRAPH)
========================================================= */

// --- Step 1: Redirect user to Microsoft login page ---
router.get("/graph/login", async (req, res) => {
  try {
    const nextUrl = req.query.next || "/inbox";

    // 🧠 1️⃣ If an existing valid token is already stored in the session, skip login
    if (req.session.graphToken && req.session.graphTokenExpires * 1000 > Date.now()) {
      console.log("✅ [Graph Login] Existing Graph token still valid");
      return res.redirect(nextUrl);
    }

    // 🧠 2️⃣ Attempt to silently acquire a new token if we have an MSAL account cached
    const { getTokenSilent } = require("../auth/msal");
    if (req.session.account) {
      const silentResult = await getTokenSilent(req.session.account);
      if (silentResult && silentResult.accessToken) {
        req.session.graphToken = silentResult.accessToken;
        req.session.graphAccessToken = silentResult.accessToken;
        req.session.graphTokenType = "delegated";
        req.session.graphTokenExpires = Math.floor(silentResult.expiresOn.getTime() / 1000);
        console.log("✅ [Graph Login] Silent token refreshed");
        return res.redirect(nextUrl);
      }
    }

    // 🔁 3️⃣ Fallback: Start interactive Microsoft login
    console.log("🪄 [Graph Login] Redirecting to Microsoft login");

    const authCodeUrlParameters = {
      scopes: [
        "User.Read",
        "Mail.ReadWrite",
        "Mail.Send",
        "Mail.ReadWrite.Shared",
        "Mail.Send.Shared",
        "offline_access",
      ],
      redirectUri: process.env.AZURE_REDIRECT_URI,
      state: JSON.stringify({ next: nextUrl }),
    };

    const url = await cca.getAuthCodeUrl(authCodeUrlParameters);
    res.redirect(url);
  } catch (err) {
    console.error("❌ [Graph Login] Error:", err);
    res.status(500).send("Error starting Microsoft login.");
  }
}); // ✅ closes /graph/login route properly


// --- Step 2: Handle Microsoft callback ---
router.get("/graph/callback", async (req, res) => {
  const tokenRequest = {
    code: req.query.code,
    scopes: [
      "User.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "Mail.ReadWrite.Shared",
      "Mail.Send.Shared",
      "offline_access",
    ],
    redirectUri: process.env.AZURE_REDIRECT_URI,
  };

  try {
    const response = await cca.acquireTokenByCode(tokenRequest);
    const msUser = response.account;

    // 🔐 Store Microsoft Graph tokens in session
    req.session.graphToken = response.accessToken;
    req.session.graphAccessToken = response.accessToken; // ✅ make it available for both inbox/functions
    req.session.graphTokenType = "delegated";
    req.session.graphTokenExpires = Math.floor(response.expiresOn.getTime() / 1000);
    req.session.account = response.account;

    console.log("✅ Microsoft login success:", msUser.username);
    console.log("🕒 Token expires at:", response.expiresOn.toISOString());

    // --- Sync Microsoft user with local database ---
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [msUser.username]);

    let user;
    if (rows.length) {
      user = rows[0];
    } else {
      const insert = await pool.query(
        "INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING id, name, email, role",
        [msUser.name || msUser.username.split("@")[0], msUser.username, "user"]
      );
      user = insert.rows[0];
    }

    // 🧭 Merge with existing session user if present
    req.session.user = {
      ...(req.session.user || {}),
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    req.session.sharedMailbox = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
    console.log(`📨 Shared mailbox configured: ${req.session.sharedMailbox}`);

    // ✅ Redirect back to original page (or inbox as fallback)
    const nextUrl = req.session.next || "/dashboard";
    delete req.session.next;
    res.redirect(nextUrl);
  } catch (error) {
    console.error("❌ Microsoft login error:", error);
    res.status(500).send("Microsoft authentication failed.");
  }
});


/* =========================================================
   EXPORT
========================================================= */
module.exports = router;
