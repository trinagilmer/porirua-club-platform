require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sql = `
SELECT
  f.id_uuid,
  f.event_name,
  f.status,
  f.totals_price,
  pt.subtotal,
  (pt.subtotal + pt.gratuity_amount - pt.discount_amount) as calculated_total
FROM functions f
LEFT JOIN LATERAL (
  SELECT pt.subtotal, pt.gratuity_amount, pt.discount_amount
  FROM proposals p
  JOIN proposal_totals pt ON pt.proposal_id = p.id
  WHERE p.function_id = f.id_uuid
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) pt ON TRUE
WHERE LOWER(COALESCE(f.status, '')) IN ('confirmed')
ORDER BY f.created_at DESC
LIMIT 10;
`;

pool.query(sql).then(r=>{ 
  console.log('Confirmed functions:');
  r.rows.forEach(row => {
    console.log(`  ${row.event_name}: f.totals_price=${row.totals_price}, pt.subtotal=${row.subtotal}, calculated=${row.calculated_total}`);
  });
  return pool.end(); 
}).catch(async e=>{ 
  console.error(e); 
  try { await pool.end(); } catch {} 
  process.exit(1); 
});
