const { pool } = require("../db");

async function ensureTeamupSettingsTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS teamup_settings (
      id SERIAL PRIMARY KEY,
      calendar_key TEXT NOT NULL DEFAULT '',
      api_token TEXT NOT NULL DEFAULT '',
      auth_token TEXT NOT NULL DEFAULT '',
      subcalendar_ids TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE teamup_settings ADD COLUMN IF NOT EXISTS auth_token TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE public.teamup_settings ENABLE ROW LEVEL SECURITY;`);
}

async function getTeamupSettings(db = pool) {
  await ensureTeamupSettingsTable(db);
  const { rows } = await db.query(
    "SELECT * FROM teamup_settings ORDER BY id DESC LIMIT 1;"
  );
  if (rows[0]) return rows[0];
  const { rows: inserted } = await db.query(
    `INSERT INTO teamup_settings (calendar_key, api_token, auth_token, subcalendar_ids)
     VALUES ('', '', '', '') RETURNING *;`
  );
  return inserted[0];
}

async function saveTeamupSettings({ calendarKey, apiToken, authToken, subcalendarIds }, db = pool) {
  await ensureTeamupSettingsTable(db);
  const { rows } = await db.query(
    "SELECT id FROM teamup_settings ORDER BY id DESC LIMIT 1;"
  );
  const key = String(calendarKey || "").trim();
  const token = String(apiToken || "").trim();
  const auth = String(authToken || "").trim();
  const ids = String(subcalendarIds || "").trim();

  if (rows[0]) {
    // Never overwrite stored secrets with empty values.
    const assignments = [
      `calendar_key = $1`,
      `subcalendar_ids = $2`,
    ];
    const params = [key, ids];
    if (token) {
      assignments.push(`api_token = $${params.length + 1}`);
      params.push(token);
    }
    if (auth) {
      assignments.push(`auth_token = $${params.length + 1}`);
      params.push(auth);
    }
    params.push(rows[0].id);
    await db.query(
      `UPDATE teamup_settings
          SET ${assignments.join(",\n              ")},
              updated_at = NOW()
        WHERE id = $${params.length};`,
      params
    );
  } else {
    await db.query(
      `INSERT INTO teamup_settings (calendar_key, api_token, auth_token, subcalendar_ids)
       VALUES ($1, $2, $3, $4);`,
      [key, token, auth, ids]
    );
  }
  return getTeamupSettings(db);
}

module.exports = { ensureTeamupSettingsTable, getTeamupSettings, saveTeamupSettings };
