// Load environment variables FIRST
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const { format } = require("date-fns");

const app = express();

/* =========================================================
   🌏 Global EJS Helpers
========================================================= */
app.locals.formatNZDate = function (date) {
  try {
    return date ? format(date, "dd/MM/yyyy") : "";
  } catch {
    return "";
  }
};

app.locals.formatNZTime = function (time) {
  try {
    if (!time) return "";
    const d = new Date(`1970-01-01T${time}`);
    return format(d, "h:mm a"); // e.g. 3:45 PM
  } catch {
    return "";
  }
};

app.locals.formatNZDateTime = function (date, time) {
  try {
    if (!date) return "";
    const d = new Date(`${format(date, "yyyy-MM-dd")}T${time || "00:00:00"}`);
    return format(d, "dd/MM/yyyy h:mm a");
  } catch {
    return "";
  }
};

/* =========================================================
   ⚙️ Middleware
========================================================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "changeme",
    resave: false,
    saveUninitialized: false,
  })
);

// Static files + EJS
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* =========================================================
   🚏 Routes
========================================================= */
const indexRoutes = require("./routes/index");
const dashboardRoutes = require("./routes/dashboard");
const testRoutes = require("./routes/test");
const functionsRoutes = require("./routes/functions");
const authRoutes = require("./routes/auth");

app.use("/", indexRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/test-db", testRoutes);
app.use("/functions", functionsRoutes);
app.use("/auth", authRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).send("Page not found");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
)
