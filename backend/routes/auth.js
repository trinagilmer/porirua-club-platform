const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");

const router = express.Router();

// --- LOGIN ---
router.get("/login", (req, res) => {
  res.render("pages/login", { error: null, title: "Login" });
});


router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (!rows.length) {
      return res.render("pages/login", { error: "Invalid email or password" });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.render("pages/login", { error: "Invalid email or password", title: "Login" });

    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    res.redirect("/dashboard");
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
    if (existing.length) {
      return res.render("pages/register", { error: "Email already in use", title: "Register" });

    }

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
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

module.exports = router;
