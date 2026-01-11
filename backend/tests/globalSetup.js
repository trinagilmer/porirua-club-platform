const path = require("path");
const dotenv = require("dotenv");
const { createPool, resetPublicSchema, seedCoreData } = require("./helpers/testDb");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env.test") });
process.env.NODE_ENV = "test";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

module.exports = async () => {
  const pool = createPool();
  try {
    await resetPublicSchema(pool);
    await seedCoreData(pool);
  } finally {
    await pool.end();
  }
};
