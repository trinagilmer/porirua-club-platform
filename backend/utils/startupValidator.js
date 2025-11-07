/**
 * 🧭 Startup Validator
 * Checks critical environment variables and core dependencies
 * Run automatically from app.js before the server starts.
 */

// --- 1️⃣ Required environment variables ---
const requiredEnvVars = [
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_SECRET",
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "DATABASE_URL",
];

function checkEnv() {
  console.log("\n🔍 Environment Variable Check:");
  let allGood = true;

  requiredEnvVars.forEach((key) => {
    const val = process.env[key];
    if (!val) {
      console.log(`❌  ${key} is MISSING`);
      allGood = false;
    } else {
      console.log(`✅  ${key} loaded`);
    }
  });

  if (!allGood) {
    console.warn(
      "\n⚠️  One or more environment variables are missing. Check your Render Environment settings before continuing.\n"
    );
  } else {
    console.log("🎯 All required environment variables are set.\n");
  }

  // 🔗 Log MSAL Authority for transparency
  if (process.env.AZURE_TENANT_ID) {
    console.log(
      `🔗  MSAL Authority: https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
    );
  }
}

// --- 2️⃣ Dependency existence check ---
const requiredModules = ["multer", "node-fetch", "@azure/msal-node", "date-fns"];

function checkModules() {
  console.log("📦 Dependency Check:");
  requiredModules.forEach((mod) => {
    try {
      require.resolve(mod);
      console.log(`✅  ${mod}`);
    } catch {
      console.log(`❌  ${mod} not installed`);
    }
  });
  console.log();
}

function runStartupValidation() {
  console.log("==============================================");
  console.log("🚀 Porirua Club Platform – Startup Validator");
  console.log("==============================================");

  checkEnv();
  checkModules();

  console.log("✅  Startup validation completed.\n");
}

module.exports = { runStartupValidation };

