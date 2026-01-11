const { pool } = require("../db");

const DEFAULT_FUNCTION_ENQUIRY_SETTINGS = {
  enquiry_notification_emails: "operations@poriruaclub.co.nz",
  enquiry_terms_url: "https://portal.poriruaclub.co.nz/terms",
  enquiry_room_ids: [],
  enquiry_allow_custom_event_type: true,
};

async function ensureFunctionSettingsTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS function_settings (
      id SERIAL PRIMARY KEY,
      enquiry_notification_emails TEXT,
      enquiry_terms_url TEXT,
      enquiry_room_ids INTEGER[],
      enquiry_allow_custom_event_type BOOLEAN,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    ALTER TABLE function_settings
      ADD COLUMN IF NOT EXISTS enquiry_room_ids INTEGER[],
      ADD COLUMN IF NOT EXISTS enquiry_allow_custom_event_type BOOLEAN;
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
      enquiry_room_ids: rows[0].enquiry_room_ids || [],
      enquiry_allow_custom_event_type:
        rows[0].enquiry_allow_custom_event_type ?? DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_allow_custom_event_type,
    };
  }
  const { rows: inserted } = await db.query(
    `
    INSERT INTO function_settings
      (enquiry_notification_emails, enquiry_terms_url, enquiry_room_ids, enquiry_allow_custom_event_type, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *;
    `,
    [
      DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_notification_emails,
      DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_terms_url,
      DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_room_ids,
      DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_allow_custom_event_type,
    ]
  );
  return {
    ...DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
    ...inserted[0],
    enquiry_room_ids: inserted[0]?.enquiry_room_ids || [],
    enquiry_allow_custom_event_type:
      inserted[0]?.enquiry_allow_custom_event_type ??
      DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_allow_custom_event_type,
  };
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function normalizeRoomIds(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .map((entry) => Number(entry))
    .filter((num) => Number.isFinite(num));
}

async function updateFunctionSettings(values = {}, db = pool) {
  await ensureFunctionSettingsTable(db);
  const current = await getFunctionSettings(db);
  const notificationEmails =
    String(values.enquiry_notification_emails || current.enquiry_notification_emails || "").trim();
  const termsUrl = String(values.enquiry_terms_url || current.enquiry_terms_url || "").trim();
  const roomIds = normalizeRoomIds(values.enquiry_room_ids);
  const allowCustom =
    values.enquiry_allow_custom_event_type !== undefined
      ? parseBoolean(values.enquiry_allow_custom_event_type, true)
      : current.enquiry_allow_custom_event_type;
  const storedRoomIds = roomIds.length ? roomIds : null;

  if (current?.id) {
    const { rows } = await db.query(
      `
      UPDATE function_settings
         SET enquiry_notification_emails = $1,
             enquiry_terms_url = $2,
             enquiry_room_ids = $3,
             enquiry_allow_custom_event_type = $4,
             updated_at = NOW()
       WHERE id = $5
       RETURNING *;
      `,
      [notificationEmails, termsUrl, storedRoomIds, allowCustom, current.id]
    );
    return {
      ...DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
      ...rows[0],
      enquiry_room_ids: rows[0]?.enquiry_room_ids || [],
      enquiry_allow_custom_event_type:
        rows[0]?.enquiry_allow_custom_event_type ??
        DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_allow_custom_event_type,
    };
  }

  const { rows } = await db.query(
    `
    INSERT INTO function_settings
      (enquiry_notification_emails, enquiry_terms_url, enquiry_room_ids, enquiry_allow_custom_event_type, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *;
    `,
    [notificationEmails, termsUrl, storedRoomIds, allowCustom]
  );
  return {
    ...DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
    ...rows[0],
    enquiry_room_ids: rows[0]?.enquiry_room_ids || [],
    enquiry_allow_custom_event_type:
      rows[0]?.enquiry_allow_custom_event_type ??
      DEFAULT_FUNCTION_ENQUIRY_SETTINGS.enquiry_allow_custom_event_type,
  };
}

module.exports = {
  DEFAULT_FUNCTION_ENQUIRY_SETTINGS,
  ensureFunctionSettingsTable,
  getFunctionSettings,
  updateFunctionSettings,
};
