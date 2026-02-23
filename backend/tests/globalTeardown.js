module.exports = async () => {
  try {
    const { pool } = require("../db");
    if (pool && typeof pool.end === "function") {
      await pool.end();
    }
  } catch (_) {
    // Ignore teardown errors to avoid masking test results.
  }
};
