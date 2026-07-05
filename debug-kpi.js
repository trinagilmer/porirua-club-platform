require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sql = `
SELECT
  COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('lead'))::int AS lead_count,
  COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('confirmed'))::int AS confirmed_count,
  COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('completed'))::int AS completed_count,
  COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('qualified', 'balance_due'))::int AS legacy_confirmed_count,
  COALESCE(SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('lead') THEN COALESCE(budget, 0) ELSE 0 END), 0) AS lead_value,
  COALESCE(SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('confirmed') THEN COALESCE(totals_price, 0) ELSE 0 END), 0) AS confirmed_value,
  COALESCE(SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('completed') AND COALESCE(end_date, event_date) < CURRENT_DATE THEN COALESCE(totals_price, 0) ELSE 0 END), 0) AS completed_past_value,
  COALESCE(SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('completed') THEN COALESCE(totals_price, 0) ELSE 0 END), 0) AS completed_all_value
FROM functions;
`;

pool.query(sql).then(r=>{ 
  console.log('Results:', r.rows[0]); 
  return pool.end(); 
}).catch(async e=>{ 
  console.error(e); 
  try { await pool.end(); } catch {} 
  process.exit(1); 
});
