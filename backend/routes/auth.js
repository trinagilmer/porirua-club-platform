// backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { pool } = require("../db");
const { getAppToken } = require("../utils/graphAuth");
const { sendMail } = require("../services/graphService");
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

async function ensurePasswordResetsTable() {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP NULL
    );
    `
  );
}

function getAppBaseUrl(req) {
  const envBase = (process.env.APP_URL || "").trim();
  if (envBase) return envBase.replace(/\/$/, "");
  if (req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.get("host");
    if (host) return `${proto}://${host}`.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

async function sendPasswordResetEmail({ toEmail, toName, resetToken, baseUrl }) {
  const accessToken = await getAppToken();
  if (!accessToken) throw new Error("Graph token unavailable");
  const resetLink = `${(baseUrl || "").replace(/\/$/, "")}/auth/reset-password/${resetToken}`;
  const subject = "Reset your Porirua Club password";
  const body = `
    <p>Hello ${toName || "there"},</p>
    <p>Click the link below to reset your password:</p>
    <p><a href="${resetLink}">Reset password</a></p>
    <p>This link expires in 2 hours.</p>
  `;
  await sendMail(accessToken, {
    to: toEmail,
    subject,
    body,
    fromMailbox:
      process.env.SHARED_MAILBOX ||
      process.env.FEEDBACK_MAILBOX ||
      process.env.FUNCTION_FEEDBACK_MAILBOX ||
      "events@poriruaclub.co.nz",
  });
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
        next: nextValue || "",
      });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.render("pages/login", {
        error: "Invalid email or password",
        title: "Login",
        hideChrome: true,
        next: nextValue || "",
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

// --- FORGOT PASSWORD ---
router.get("/forgot-password", (req, res) => {
  res.render("pages/forgot-password", {
    title: "Reset password",
    hideChrome: true,
    message: null,
    error: null,
  });
});

router.post("/forgot-password", async (req, res) => {
  try {
    await ensurePasswordResetsTable();
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email) {
      return res.render("pages/forgot-password", {
        title: "Reset password",
        hideChrome: true,
        message: null,
        error: "Email is required.",
      });
    }
    const { rows } = await pool.query(`SELECT id, name, email FROM users WHERE email = $1 LIMIT 1;`, [
      email,
    ]);
    const user = rows[0];
    if (user) {
      const token = crypto.randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3);`,
        [user.id, token, expiresAt]
      );
      await sendPasswordResetEmail({
        toEmail: user.email,
        toName: user.name,
        resetToken: token,
        baseUrl: getAppBaseUrl(req),
      });
    }
    res.render("pages/forgot-password", {
      title: "Reset password",
      hideChrome: true,
      message: "If that email exists, a reset link has been sent.",
      error: null,
    });
  } catch (err) {
    console.error("[Auth] Forgot password failed:", err);
    res.render("pages/forgot-password", {
      title: "Reset password",
      hideChrome: true,
      message: null,
      error: "Unable to send reset link. Please try again.",
    });
  }
});

router.get("/reset-password/:token", async (req, res) => {
  try {
    await ensurePasswordResetsTable();
    const token = req.params.token;
    const { rows } = await pool.query(
      `
      SELECT r.token, r.expires_at, r.used_at, u.email
        FROM password_resets r
        JOIN users u ON u.id = r.user_id
       WHERE r.token = $1
       LIMIT 1;
      `,
      [token]
    );
    const reset = rows[0];
    const isValid = reset && !reset.used_at && new Date(reset.expires_at) > new Date();
    res.render("pages/reset-password", {
      title: "Reset password",
      hideChrome: true,
      error: isValid ? null : "Reset link is invalid or has expired.",
      token: isValid ? token : null,
    });
  } catch (err) {
    console.error("[Auth] Reset password load failed:", err);
    res.status(500).render("pages/reset-password", {
      title: "Reset password",
      hideChrome: true,
      error: "Unable to load reset page.",
      token: null,
    });
  }
});

router.post("/reset-password/:token", async (req, res) => {
  try {
    await ensurePasswordResetsTable();
    const token = req.params.token;
    const { password, confirm_password } = req.body;
    if (!password || password.length < 8) {
      return res.render("pages/reset-password", {
        title: "Reset password",
        hideChrome: true,
        error: "Password must be at least 8 characters.",
        token,
      });
    }
    if (password !== confirm_password) {
      return res.render("pages/reset-password", {
        title: "Reset password",
        hideChrome: true,
        error: "Passwords do not match.",
        token,
      });
    }
    const { rows } = await pool.query(
      `
      SELECT r.id, r.user_id, r.expires_at, r.used_at
        FROM password_resets r
       WHERE r.token = $1
       LIMIT 1;
      `,
      [token]
    );
    const reset = rows[0];
    if (!reset || reset.used_at || new Date(reset.expires_at) <= new Date()) {
      return res.render("pages/reset-password", {
        title: "Reset password",
        hideChrome: true,
        error: "Reset link is invalid or has expired.",
        token: null,
      });
    }
    const { rows: columnRows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND table_schema = 'public';`
    );
    const columns = columnRows.map((r) => r.column_name);
    if (!columns.includes("password_hash")) {
      return res.render("pages/reset-password", {
        title: "Reset password",
        hideChrome: true,
        error: "Password reset is not available for this account type.",
        token: null,
      });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2;`, [hash, reset.user_id]);
    await pool.query(`UPDATE password_resets SET used_at = NOW() WHERE id = $1;`, [reset.id]);
    res.render("pages/login", {
      error: null,
      title: "Login",
      hideChrome: true,
      success: "Password reset. You can log in now.",
      next: "",
    });
  } catch (err) {
    console.error("[Auth] Reset password failed:", err);
    res.status(500).render("pages/reset-password", {
      title: "Reset password",
      hideChrome: true,
      error: "Unable to reset password.",
      token: null,
    });
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

// --- LOGOUT ---
router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});
/* =========================================================
   EXPORT
========================================================= */
module.exports = router;
