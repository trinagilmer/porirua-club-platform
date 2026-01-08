// backend/db.js
const { Pool } = require("pg");

// Supabase Postgres always requires SSL, even in development
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    require: true,
    rejectUnauthorized: false, // Supabase uses managed/self-signed certs
  },
  keepAlive: true,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

pool.on("connect", (client) => {
  client.query("SET statement_timeout = 15000").catch(() => {});
  client.query("SET idle_in_transaction_session_timeout = 15000").catch(() => {});
});

pool.on("connect", () => console.log("✅ PostgreSQL (SSL) connection established."));
pool.on("error", (err) => console.error("💥 Unexpected PostgreSQL error:", err.message));

module.exports = { pool };





