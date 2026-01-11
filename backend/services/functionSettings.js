const { pool } = require("../db");

const DEFAULT_FUNCTION_ENQUIRY_SETTINGS = {
  enquiry_notification_emails: "operations@poriruaclub.co.nz",
  enquiry_terms_url: "https://portal.poriruaclub.co.nz/terms",
};

async function ensureFunctionSettingsTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS function_settings (
      id SERIAL PRIMARY KEY,
      enquiry_notification_emails TEXT,
      enquiry_terms_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function getFunctionSettings(db = pool) {
  await ensureFunctionSettingsTable(db);
  const { rows } = await db.query(
    "SELECT * FROM function_settings ORDER BY id DESC LIMIT 1;"
  );
  if (rows[0]) {
    return {
      ...DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
      ...rows[0],
    };
  }
  const { rows: inserted } = await db.query(
    `
    INSERT INTO function_settings
      (enquiry_notification_emails, enquiry_terms_url, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING *;
    `,
    [
      DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_notification_emails,
      DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_terms_url,
    ]
  );
  return {
    ...DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
    ...inserted[0],
  };
}

async function updateFunctionSettings(values = {}, db = pool) {
  await ensureFunctionSettingsTable(db);
  const current = await getFunctionSettings(db);
  const notificationEmails =
    String(values.enquiry_notification_emails || current.enquiry_notification_emails || "").trim();
  const termsUrl = String(values.enquiry_terms_url || current.enquiry_terms_url || "").trim();

  if (current?.id) {
    const { rows } = await db.query(
      `
      UPDATE function_settings
         SET enquiry_notification_emails = $1,
             enquiry_terms_url = $2,
             updated_at = NOW()
       WHERE id = $3
       RETURNING *;
      `,
      [notificationEmails, termsUrl, current.id]
    );
    return {
      ...DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
      ...rows[0],
    };
  }

  const { rows } = await db.query(
    `
    INSERT INTO function_settings
      (enquiry_notification_emails, enquiry_terms_url, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING *;
    `,
    [notificationEmails, termsUrl]
  );
  return {
    ...DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
    ...rows[0],
  };
}

module.exports = {
  DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
  ensureFunctionSettingsTable,
  getFunctionSettings,
  updateFunctionSettings,
};
