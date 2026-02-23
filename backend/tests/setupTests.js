const { pool } = require("../db");

jest.setTimeout(30000);

afterAll(async () => {
  if (pool && typeof pool.end === "function") {
    await pool.end();
  }
});
