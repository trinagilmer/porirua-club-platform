const express = require("express");
const session = require("express-session");
const path = require("path");
const dashboardRoutes = require("./routes/dashboard");
require("dotenv").config();

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "changeme",
  resave: false,
  saveUninitialized: false
}));

// Static files + EJS
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use("/dashboard", dashboardRoutes);
// Routes
const indexRoutes = require("./routes/index");
const testRoutes = require("./routes/test");
app.use("/", indexRoutes);
app.use("/test-db", testRoutes);
// Fallback
app.use((req, res) => {
  res.status(404).send("Page not found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
