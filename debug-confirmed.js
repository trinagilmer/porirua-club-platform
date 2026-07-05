require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sql = `
SELECT
  f.id_uuid,
  f.event_name,
  f.status,
  f.totals_price,
  p.id as proposal_id,
  pt.total_price as proposal_total
FROM functions f
LEFT JOIN proposals p ON p.function_id = f.id_uuid
LEFT JOIN proposal_totals pt ON pt.proposal_id = p.id
WHERE LOWER(COALESCE(f.status, '')) IN ('confirmed')
ORDER BY f.created_at DESC
LIMIT 10;
`;

pool.query(sql).then(r=>{ 
  console.log('Confirmed functions with proposals:');
  r.rows.forEach(row => {
    console.log(`  ${row.event_name}: totals_price=${row.totals_price}, proposal_total=${row.proposal_total}`);
  });
  return pool.end(); 
}).catch(async e=>{ 
  console.error(e); 
  try { await pool.end(); } catch {} 
  process.exit(1); 
});
