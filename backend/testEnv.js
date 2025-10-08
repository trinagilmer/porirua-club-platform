// backend/testEnv.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

console.log("🔍 Checking Azure environment variables...\n");
console.log("AZURE_CLIENT_ID:", process.env.AZURE_CLIENT_ID || "(missing)");
console.log("AZURE_TENANT_ID:", process.env.AZURE_TENANT_ID || "(missing)");
console.log("AZURE_CLIENT_SECRET:", process.env.AZURE_CLIENT_SECRET ? "(set)" : "(missing)");
console.log("\n.env path loaded from:", path.join(__dirname, "..", ".env"));
