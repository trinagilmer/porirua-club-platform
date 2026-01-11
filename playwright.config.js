const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env.test") });

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";

if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is required for Playwright.");
}

module.exports = {
  testDir: "tests/e2e",
  testMatch: "**/*.spec.js",
  timeout: 60000,
  use: {
    baseURL,
    headless: true,
  },
  webServer: {
    command: "node backend/app.js",
    url: baseURL,
    reuseExistingServer: true,
    env: {
      NODE_ENV: "test",
      PORT: "3100",
      DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
      EMAIL_MODE: "disabled",
      SESSION_SECRET: process.env.SESSION_SECRET || "test-secret",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
  },
};
