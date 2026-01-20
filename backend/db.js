// backend/db.js
const { Pool } = require("pg");

// Supabase Postgres always requires SSL, even in development.
// Some providers append sslmode=verify-full which forces certificate validation.
// Strip sslmode and control TLS verification explicitly via the ssl config.
const rawConnectionString = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
function sanitizeConnectionString(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.searchParams.has("sslmode")) {
      url.searchParams.delete("sslmode");
    }
    return url.toString();
  } catch (_) {
    return value;
  }
}

const connectionString = sanitizeConnectionString(rawConnectionString);
const ssl =
  process.env.PGSSL_DISABLE === "true" || process.env.PGSSLMODE === "disable"
    ? false
    : {
        require: true,
        rejectUnauthorized: false, // Supabase/Render can use managed/self-signed certs.
      };

const pool = new Pool({
  connectionString,
  ssl,
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





