// backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcrypt");
const { pool } = require("../db");
const { cca } = require("../auth/msal"); // ✅ import the shared MSAL client

const router = express.Router();

async function ensureUserInvitesTable() {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS user_invites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_by INTEGER NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP NULL
    );
    `
  );
}


/* =========================================================
   LOCAL LOGIN / REGISTER / LOGOUT
========================================================= */

// --- LOGIN ---
router.get("/login", (req, res) => {
  res.render("pages/login", {
    error: null,
    title: "Login",
    hideChrome: true,
    next: req.query.next || "",
  });
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password, next: nextValue } = req.body;
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

    if (!rows.length)
      return res.render("pages/login", {
        error: "Invalid email or password",
        title: "Login",
        hideChrome: true,
      });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.render("pages/login", {
        error: "Invalid email or password",
        title: "Login",
        hideChrome: true,
      });

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const allowedLandingPages = new Set([
      "/dashboard",
      "/functions",
      "/calendar",
      "/inbox",
      "/contacts",
      "/reports",
      "/settings",
      "/tasks",
      "/dashboard/restaurant",
      "/dashboard/events",
    ]);
    const safePath = (value) => {
      if (!value) return null;
      const cleaned = String(value).trim();
      if (!cleaned.startsWith("/")) return null;
      if (cleaned.startsWith("//")) return null;
      return allowedLandingPages.has(cleaned) ? cleaned : null;
    };
    const nextUrl = safePath(nextValue);
    const preferredLanding = safePath(user.default_landing);

    res.redirect(nextUrl || preferredLanding || "/dashboard");
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

// --- ACCEPT INVITE ---
router.get("/accept-invite/:token", async (req, res) => {
  try {
    await ensureUserInvitesTable();
    const token = req.params.token;
    const { rows } = await pool.query(
      `
      SELECT i.token, i.expires_at, i.used_at, u.name, u.email
        FROM user_invites i
        JOIN users u ON u.id = i.user_id
       WHERE i.token = $1
       LIMIT 1;
      `,
      [token]
    );
    const invite = rows[0];
    const isValid = invite && !invite.used_at && new Date(invite.expires_at) > new Date();
    res.render("pages/accept-invite", {
      title: "Set your password",
      hideChrome: true,
      error: isValid ? null : "Invite link is invalid or has expired.",
      token: isValid ? token : null,
      invite,
    });
  } catch (err) {
    console.error("[Auth] Failed to load invite:", err);
    res.status(500).render("pages/accept-invite", {
      title: "Set your password",
      hideChrome: true,
      error: "Unable to load invite.",
      token: null,
      invite: null,
    });
  }
});

router.post("/accept-invite/:token", async (req, res) => {
  try {
    await ensureUserInvitesTable();
    const token = req.params.token;
    const { password, confirm_password } = req.body;
    if (!password || password.length < 8) {
      return res.render("pages/accept-invite", {
        title: "Set your password",
        hideChrome: true,
        error: "Password must be at least 8 characters.",
        token,
        invite: null,
      });
    }
    if (password !== confirm_password) {
      return res.render("pages/accept-invite", {
        title: "Set your password",
        hideChrome: true,
        error: "Passwords do not match.",
        token,
        invite: null,
      });
    }
    const { rows } = await pool.query(
      `
      SELECT i.id, i.user_id, i.expires_at, i.used_at, u.email, u.name
        FROM user_invites i
        JOIN users u ON u.id = i.user_id
       WHERE i.token = $1
       LIMIT 1;
      `,
      [token]
    );
    const invite = rows[0];
    if (!invite || invite.used_at || new Date(invite.expires_at) <= new Date()) {
      return res.render("pages/accept-invite", {
        title: "Set your password",
        hideChrome: true,
        error: "Invite link is invalid or has expired.",
        token: null,
        invite: null,
      });
    }
    const { rows: columnRows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND table_schema = 'public';`
    );
    const columns = columnRows.map((r) => r.column_name);
    if (!columns.includes("password_hash")) {
      return res.render("pages/accept-invite", {
        title: "Set your password",
        hideChrome: true,
        error: "Password setup is not available for this account type.",
        token: null,
        invite: null,
      });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2;`, [hash, invite.user_id]);
    await pool.query(`UPDATE user_invites SET used_at = NOW() WHERE id = $1;`, [invite.id]);
    res.render("pages/login", {
      error: null,
      title: "Login",
      hideChrome: true,
      success: "Password set. You can log in now.",
    });
  } catch (err) {
    console.error("[Auth] Failed to accept invite:", err);
    res.status(500).render("pages/accept-invite", {
      title: "Set your password",
      hideChrome: true,
      error: "Unable to set password.",
      token: null,
      invite: null,
    });
  }
});

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
    const allowedLandingPages = new Set([
      "/dashboard",
      "/functions",
      "/calendar",
      "/inbox",
      "/contacts",
      "/reports",
      "/settings",
      "/tasks",
      "/dashboard/restaurant",
      "/dashboard/events",
    ]);
    const safePath = (value) => {
      if (!value) return null;
      const cleaned = String(value).trim();
      if (!cleaned.startsWith("/")) return null;
      if (cleaned.startsWith("//")) return null;
      return allowedLandingPages.has(cleaned) ? cleaned : null;
    };
    const preferredLanding = safePath(user.default_landing);
    const nextUrl = req.session.next || preferredLanding || "/dashboard";
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
