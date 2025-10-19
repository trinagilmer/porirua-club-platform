// backend/db.js
const { Pool } = require("pg");

// Supabase Postgres always requires SSL, even in development
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    require: true,
    rejectUnauthorized: false, // Supabase uses managed/self-signed certs
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("connect", () => console.log("✅ PostgreSQL (SSL) connection established."));
pool.on("error", (err) => console.error("💥 Unexpected PostgreSQL error:", err.message));

module.exports = { pool };





