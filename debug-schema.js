require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'proposal_totals' ORDER BY ordinal_position;").then(r=>{ 
  console.log('Columns:', r.rows.map(x=>x.column_name).join(', ')); 
  return pool.end(); 
}).catch(async e=>{ 
  console.error(e); 
  try { await pool.end(); } catch {} 
  process.exit(1); 
});
