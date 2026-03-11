/**
 * =========================================================
 *  🚀 Porirua Club Platform — Application Server
 *  Clean & modular Express configuration
 * =========================================================
 */

const path = require("path");
const fs = require("fs");
const isTestEnv = process.env.NODE_ENV === "test";

if (!isTestEnv) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  // ?? Startup validation
  const { runStartupValidation } = require("./utils/startupValidator");
  runStartupValidation();
}

// 🔧 Core dependencies
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const { createPool } = require("./db");
const PgSession = require("connect-pg-simple")(session);
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
app.locals.formatNZDateRange = (startDate, endDate, pattern = "dd/MM/yyyy") => {
  try {
    if (!startDate) return "";
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    if (Number.isNaN(start.getTime())) return "";
    if (!endDate) return format(start, pattern);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    if (Number.isNaN(end.getTime())) return format(start, pattern);
    const startKey = format(start, "yyyy-MM-dd");
    const endKey = format(end, "yyyy-MM-dd");
    if (startKey === endKey) return format(start, pattern);
    return `${format(start, pattern)} - ${format(end, pattern)}`;
  } catch {
    return "";
  }
};
app.locals.formatCurrency = (value) => {
  const num = Number(value) || 0;
  return num.toLocaleString("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
  });
};

/* =========================================================
   ⚙️ CORE MIDDLEWARE
========================================================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const sessionStore = isTestEnv
  ? new session.MemoryStore()
  : new PgSession({
      // Keep session I/O isolated from request query load to reduce timeout risk.
      pool: createPool({
        max: Number.parseInt(process.env.PG_SESSION_POOL_MAX || "2", 10),
        idleTimeoutMillis: Number.parseInt(process.env.PG_SESSION_IDLE_TIMEOUT_MS || "10000", 10),
        connectionTimeoutMillis: Number.parseInt(
          process.env.PG_SESSION_CONNECT_TIMEOUT_MS || "10000",
          10
        ),
      }),
      tableName: "session",
      createTableIfMissing: false,
    });

app.use(
  session({
    secret: process.env.SESSION_SECRET || "changeme",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
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
   Serves JS, CSS, images, and compiled assets from /backend/public
========================================================= */
const publicPath = path.join(__dirname, "public");
console.log("📂 Serving static files from:", publicPath);
app.use(express.static(publicPath));

/* =========================================================
   🧭 GLOBAL DEFAULT TEMPLATE VARIABLES
========================================================= */
app.use((req, res, next) => {
  res.locals.pageType = "";                   // prevents undefined in layout
  res.locals.title = "Porirua Club Platform"; // fallback title
  res.locals.active = "";                     // fallback for nav
  res.locals.pageJs = [];
  res.locals.pageCss = [];
  next();
});

/* =========================================================
   🧭 AUTO-DETECT HELPERS (Layout & Active Tabs)
========================================================= */
const setPageType = require("./middleware/setPageType");
const setActiveTab = require("./middleware/setActiveTab");
app.use(setPageType);
app.use(setActiveTab);

/* =========================================================
   💬 FLASH MESSAGES
========================================================= */
const flash = require("connect-flash");
app.use(flash());

// Make flash messages available to all templates
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
  "/entertainment",
  "/feedback",
  "/calendar/restaurant/book",
  "/terms",
  "/functions/enquiry",
  "/functions/proposal/client", // public proposal links
  "/widgets",
  "/api/widgets",
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
//---------------------------------------------------
// ✅ ROUTE IMPORTS
//---------------------------------------------------
const indexRoutes = require("./routes/index");
const dashboardRoutes = require("./routes/dashboard");
const testRoutes = require("./routes/test");
const authRoutes = require("./routes/auth");
const inboxRoutes = require("./routes/inbox");
const healthRouter = require("./routes/health");
const settingsRouter = require("./routes/settings");
const contactsRouter = require("./routes/contacts");
const notesRouter = require("./routes/notes");
const menusRouter = require("./routes/menus");
const paymentsRouter = require("./routes/payments");
const proposalsRouter = require("./routes/proposals");
const quoteRouter = require("./routes/quote");       // ✅ must come BEFORE functions
const functionsRoutes = require("./routes/functions"); // generic, should come later
const calendarRouter = require("./routes/calendar");
const entertainmentRouter = require("./routes/entertainment");
const feedbackPublicRouter = require("./routes/feedback");
const { startFeedbackScheduler } = require("./services/feedbackScheduler");
const reportsRouter = require("./routes/reports");
const widgetRouter = require("./routes/widgets");
const profileRouter = require("./routes/profile");
const termsRouter = require("./routes/terms");

//---------------------------------------------------
// ✅ ROUTE REGISTRATION ORDER (most specific → least)
//---------------------------------------------------

// ✅ ROUTE REGISTRATION ORDER
app.use("/health", healthRouter);
app.use("/auth", authRoutes);
app.use("/functions", quoteRouter);
app.use("/payments", paymentsRouter);
app.use("/proposals", proposalsRouter);
app.use("/menus", menusRouter);
app.use("/contacts", contactsRouter);
app.use("/calendar", calendarRouter);
app.use("/entertainment", entertainmentRouter);
app.use("/feedback", feedbackPublicRouter);
app.use("/reports", reportsRouter);
app.use("/", widgetRouter);
app.use("/profile", profileRouter);
app.use("/terms", termsRouter);

// 🧭 Settings (specific first, then general)
app.use('/settings', settingsRouter);
app.use('/settings/menus/categories', require('./routes/settings/menu-categories'));
app.use('/settings/menus/bulk', require('./routes/settings/menu-bulk'));


app.use("/inbox", inboxRoutes);
app.use("/", notesRouter);
app.use("/functions", functionsRoutes);


// 🔹 Utility and testing
app.use("/dashboard", dashboardRoutes);
app.use("/test-db", testRoutes);

// 🔹 Base routes (should always come last)
app.use("/", indexRoutes);


// 🧩 API routes
app.use("/api/contacts", require("./routes/contacts"));
// --- DEV: static tree explorer (lists backend/public contents) ---
if (process.env.NODE_ENV !== 'production') {
  const ROOT = path.join(__dirname, 'public');

  function tree(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    let out = '';
    for (const e of entries) {
      const isLast = entries[entries.length - 1] === e;
      const branch = isLast ? '└── ' : '├── ';
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      out += `${prefix}${branch}${e.name}\n`;
      if (e.isDirectory()) {
        out += tree(path.join(dir, e.name), nextPrefix);
      }
    }
    return out;
  }

  app.get('/__dev/static-tree', (req, res) => {
    try {
      const out = [
        `Static root: ${ROOT}`,
        '',
        tree(ROOT),
        '',
        'Tip: URLs are /<below after "public">, e.g. /js/settings/menuDrawer.js'
      ].join('\n');
      res.type('text/plain').send(out);
    } catch (err) {
      res.status(500).type('text/plain').send(`Error reading static tree: ${err.message}`);
    }
  });
}

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
   ?? START SERVER
========================================================= */
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log("===========================================");
    console.log(`? Porirua Club Platform running at:`);
    console.log(`??  http://localhost:${PORT}`);
    console.log("===========================================");
  });

  if (process.env.NODE_ENV !== "test") {
    startFeedbackScheduler();
  }
}

module.exports = app;
