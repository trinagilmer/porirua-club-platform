const fs = require("fs");
const path = require("path");
const rootEnv = path.join(__dirname, "..", "..", "..", ".env.test");
const fallbackEnv = path.join(__dirname, "..", "..", ".env.test");
const envPath = fs.existsSync(rootEnv) ? rootEnv : fallbackEnv;
require("dotenv").config({ path: envPath });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
process.env.NODE_ENV = "test";

const { createPool, resetPublicSchema, seedCoreData } = require("../../tests/helpers/testDb");

async function run() {
  const pool = createPool();
  try {
    await resetPublicSchema(pool);
    await seedCoreData(pool);
    console.log("Test database reset + seeded.");
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Failed to reset test DB:", err.message);
  process.exit(1);
});
