const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env.test") });

process.env.NODE_ENV = "test";
process.env.EMAIL_MODE = process.env.EMAIL_MODE || "disabled";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
