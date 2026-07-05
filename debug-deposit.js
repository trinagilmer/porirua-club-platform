require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sql = `
SELECT
  COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('lead', 'confirmed') AND COALESCE(fin.deposit_amount, 0) > COALESCE(fin.total_paid, 0))::int AS active_deposit_due,
  COUNT(*) FILTER (WHERE (CASE WHEN LOWER(COALESCE(status, '')) IN ('qualified', 'balance_due', 'completed') THEN 'confirmed' WHEN LOWER(COALESCE(status, '')) IN ('lead', 'confirmed', 'cancelled') THEN LOWER(COALESCE(status, '')) ELSE 'lead' END) = 'confirmed' AND COALESCE(fin.deposit_amount, 0) > COALESCE(fin.total_paid, 0))::int AS confirmed_deposit_due
FROM functions f
LEFT JOIN LATERAL (
  SELECT pt.deposit_amount, pt.total_paid, pt.remaining_due
  FROM proposals p
  JOIN proposal_totals pt ON pt.proposal_id = p.id
  WHERE p.function_id = f.id_uuid
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) fin ON TRUE;
`;

pool.query(sql).then(r=>{ 
  console.log('Results:', r.rows[0]); 
  return pool.end(); 
}).catch(async e=>{ 
  console.error(e); 
  try { await pool.end(); } catch {} 
  process.exit(1); 
});
