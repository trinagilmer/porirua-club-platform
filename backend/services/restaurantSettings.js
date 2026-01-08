const { pool } = require("../db");

const DEFAULT_RESTAURANT_EMAIL_TEMPLATES = {
  request_subject: "Restaurant booking request received",
  request_body_html:
    "<p>Thank you for your reservation request. We will confirm availability as soon as possible.</p>" +
    "<p><strong>Name:</strong> {{booking.party_name}}<br>" +
    "<strong>Date:</strong> {{booking.booking_date|date}}<br>" +
    "<strong>Time:</strong> {{booking.booking_time}}<br>" +
    "<strong>Guests:</strong> {{booking.size}}<br>" +
    "<strong>Service:</strong> {{service.name}}{{menu_line}}</p>" +
    "<p>If you need to make changes, please contact us.</p>",
  confirm_subject: "Restaurant booking confirmation",
  confirm_body_html:
    "<p>Your restaurant booking has been confirmed. We look forward to seeing you.</p>" +
    "<p><strong>Name:</strong> {{booking.party_name}}<br>" +
    "<strong>Date:</strong> {{booking.booking_date|date}}<br>" +
    "<strong>Time:</strong> {{booking.booking_time}}<br>" +
    "<strong>Guests:</strong> {{booking.size}}<br>" +
    "<strong>Service:</strong> {{service.name}}{{menu_line}}</p>" +
    "<p>If you need to make changes, please contact us.</p>",
};

async function ensureRestaurantSettingsTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS restaurant_settings (
      id SERIAL PRIMARY KEY,
      request_subject TEXT,
      request_body_html TEXT,
      confirm_subject TEXT,
      confirm_body_html TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function getRestaurantSettings(db = pool) {
  await ensureRestaurantSettingsTable(db);
  const { rows } = await db.query(
    "SELECT * FROM restaurant_settings ORDER BY id DESC LIMIT 1;"
  );
  if (rows[0]) {
    return {
      ...DEFAULT_RESTAURANT_EMAIL_TEMPLATES,
      ...rows[0],
    };
  }

  const { rows: inserted } = await db.query(
    `
    INSERT INTO restaurant_settings
      (request_subject, request_body_html, confirm_subject, confirm_body_html, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *;
    `,
    [
      DEFAULT_RESTAURANT_EMAIL_TEMPLATES.request_subject,
      DEFAULT_RESTAURANT_EMAIL_TEMPLATES.request_body_html,
      DEFAULT_RESTAURANT_EMAIL_TEMPLATES.confirm_subject,
      DEFAULT_RESTAURANT_EMAIL_TEMPLATES.confirm_body_html,
    ]
  );
  return {
    ...DEFAULT_RESTAURANT_EMAIL_TEMPLATES,
    ...inserted[0],
  };
}

module.exports = {
  DEFAULT_RESTAURANT_EMAIL_TEMPLATES,
  ensureRestaurantSettingsTable,
  getRestaurantSettings,
};
