require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = `SELECT COUNT(*) total_balance_due, COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('lead', 'confirmed')) active_balance_due FROM functions f LEFT JOIN LATERAL (SELECT pt.deposit_amount, pt.total_paid, pt.remaining_due FROM proposals p JOIN proposal_totals pt ON pt.proposal_id = p.id WHERE p.function_id = f.id_uuid ORDER BY p.created_at DESC, p.id DESC LIMIT 1) fin ON TRUE WHERE COALESCE(fin.remaining_due, 0) > 0;`;
pool.query(sql).then(r=>{ console.log('Results:', r.rows[0]); return pool.end(); }).catch(async e=>{ console.error(e); try { await pool.end(); } catch {} process.exit(1); });
