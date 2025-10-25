/**
 * =========================================================
 *  🚀 Porirua Club Platform — Application Server
 *  Clean & modular Express configuration
 * =========================================================
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// 🧠 Startup validation
const { runStartupValidation } = require("./utils/startupValidator");
runStartupValidation();

// 🔧 Core dependencies
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const { format } = require("date-fns");

const app = express();

/* =========================================================
   🌐 GLOBAL EJS HELPERS (Date/Time Formatting)
========================================================= */
app.locals.formatNZDate = (date) => {
  try {
    return date ? format(date, "dd/MM/yyyy") : "";
  } catch {
    return "";
  }
};

app.locals.formatNZTime = (time) => {
  try {
    if (!time) return "";
    const d = new Date(`1970-01-01T${time}`);
    return format(d, "h:mm a");
  } catch {
    return "";
  }
};

app.locals.formatNZDateTime = (date, time) => {
  try {
    if (!date) return "";
    const d = new Date(`${format(date, "yyyy-MM-dd")}T${time || "00:00:00"}`);
    return format(d, "dd/MM/yyyy h:mm a");
  } catch {
    return "";
  }
};

/* =========================================================
   ⚙️ CORE MIDDLEWARE
========================================================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "changeme",
    resave: false,
    saveUninitialized: false,
    // store: ... (add a store in production)
    // cookie: { secure: true, sameSite: "lax" } // tune for prod
  })
);

/* =========================================================
   👤 USER CONTEXT (available in all templates)
========================================================= */
app.use((req, res, next) => {
  res.locals.user = req.session?.user || null;
  next();
});

/* =========================================================
   🧩 STATIC FILES — BEFORE AUTH GUARD
========================================================= */
const publicPath = path.resolve(__dirname, "public"); // ✅ now points to backend/public
console.log("📂 Serving static files from:", publicPath);
app.use(express.static(publicPath));



/* =========================================================
   🧭 Global Default Template Variables
========================================================= */
app.use((req, res, next) => {
  res.locals.pageType = "";                 // prevents undefined in layout
  res.locals.title = "Porirua Club Platform"; // fallback title
  res.locals.active = "";                   // fallback for nav
  next();
});

// 💬 Flash messages (must come after session)
const flash = require("connect-flash");
app.use(flash());

// 🔄 Make flash messages available to all templates
app.use((req, res, next) => {
  res.locals.flashMessage = req.flash("flashMessage")[0];
  res.locals.flashType = req.flash("flashType")[0];
  next();
});

/* =========================================================
   🧪 TEMPLATE ENGINE
========================================================= */
app.use(expressLayouts);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("layout", "layouts/main");
app.set("view cache", false);

/* =========================================================
   🧠 DEV: Static Asset Health Check (updated)
========================================================= */
if (process.env.NODE_ENV !== "production") {
  const assetsToCheck = [
    // ✅ core scripts
    "public/js/core/init.js",
    // ✅ function scripts (new structure)
    "public/js/functions/detail.js",
    "public/js/functions/communications.js",
    "public/js/functions/notes.js",
    "public/js/functions/tasks.js",
    // ✅ compiled CSS & images
    "public/css/main.css",
    "public/img/pc-logo.png",
  ];

  assetsToCheck.forEach((file) => {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ Missing static asset: ${file}`);
    }
  });
}


/* =========================================================
   🔐 GLOBAL AUTH GUARD (whitelist + JSON-friendly 401s)
   - Mounted AFTER static/session, BEFORE routes
========================================================= */
const OPEN_PATHS = [
  "/",                  // landing (remove if you want it protected)
  "/auth",              // /auth/* (login, callback, logout)
  "/public",            // static (also already served above)
  "/health",            // health probe
  "/favicon.ico",
  "/robots.txt",
];

function isOpenPath(reqPath) {
  // allow exact matches or subpaths (e.g., /auth/..., /public/...)
  return OPEN_PATHS.some((p) => reqPath === p || reqPath.startsWith(p + "/"));
}

app.use((req, res, next) => {
  if (isOpenPath(req.path)) return next();

  if (req.session?.user) return next();

  const wantsJSON =
    req.xhr ||
    req.headers["x-requested-with"] === "XMLHttpRequest" ||
    (req.headers.accept || "").includes("application/json");

  const nextUrl = encodeURIComponent(req.originalUrl || "/");

  if (wantsJSON) {
    return res
      .status(401)
      .json({ error: "unauthenticated", redirect: `/auth/login?next=${nextUrl}` });
  }

  return res.redirect(`/auth/login?next=${nextUrl}`);
});

/* =========================================================
   🚏 ROUTES — Modular Mounting (now protected by guard)
========================================================= */
const indexRoutes = require("./routes/index");
const dashboardRoutes = require("./routes/dashboard");
const testRoutes = require("./routes/test");
const functionsRoutes = require("./routes/functions");
const authRoutes = require("./routes/auth");
const inboxRoutes = require("./routes/inbox");
const healthRouter = require("./routes/health");
const settingsRouter = require("./routes/settings");

app.use("/", indexRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/test-db", testRoutes);
app.use("/functions", functionsRoutes);
app.use("/inbox", inboxRoutes);
app.use("/auth", authRoutes);     // whitelisted by OPEN_PATHS
app.use("/health", healthRouter); // whitelisted by OPEN_PATHS
app.use("/settings", settingsRouter);

/* =========================================================
   🚨 404 Fallback
========================================================= */
app.use((req, res) => {
  res.status(404).render("pages/404", {
    layout: "layouts/main",
    title: "Page Not Found",
    pageType: "error",
    message: "The page you requested could not be found.",
  });
});

/* =========================================================
   🚀 START SERVER
========================================================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("===========================================");
  console.log(`✅ Porirua Club Platform running at:`);
  console.log(`➡️  http://localhost:${PORT}`);
  console.log("===========================================");
});
