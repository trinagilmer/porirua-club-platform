// Load environment variables FIRST
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();

// Middleware
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

// Routes
const indexRoutes = require("./routes/index");
const dashboardRoutes = require("./routes/dashboard");
const testRoutes = require("./routes/test");

app.use("/", indexRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/test-db", testRoutes);

// Fallback
app.use((req, res) => {
  res.status(404).send("Page not found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

