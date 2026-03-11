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

function envInt(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createPool(overrides = {}) {
  const pool = new Pool({
  connectionString,
  ssl,
  keepAlive: true,
  max: envInt("PG_POOL_MAX", 5),
  idleTimeoutMillis: envInt("PG_IDLE_TIMEOUT_MS", 30000),
  connectionTimeoutMillis: envInt("PG_CONNECT_TIMEOUT_MS", 20000),
    ...overrides,
  });

  pool.on("connect", (client) => {
    client.query(`SET statement_timeout = ${envInt("PG_STATEMENT_TIMEOUT_MS", 15000)}`).catch(() => {});
    client
      .query(
        `SET idle_in_transaction_session_timeout = ${envInt(
          "PG_IDLE_IN_TX_TIMEOUT_MS",
          15000
        )}`
      )
      .catch(() => {});
  });

  pool.on("connect", () => console.log("✅ PostgreSQL (SSL) connection established."));
  pool.on("error", (err) => console.error("💥 Unexpected PostgreSQL error:", err.message));

  return pool;
}

const pool = createPool();

module.exports = { pool, createPool };





