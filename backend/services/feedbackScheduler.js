const { pool } = require("../db");
const { cca } = require("../auth/msal");
const { sendMail } = require("./graphService");
const { getFeedbackSettings, renderTemplate } = require("./feedbackService");

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const JOB_INTERVAL = Number(process.env.FEEDBACK_JOB_INTERVAL_MS) || 1000 * 60 * 30;

function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-NZ", { weekday: "long", month: "long", day: "numeric" });
}

function formatISODate(value) {
  const date = value instanceof Date ? value : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

async function acquireGraphToken() {
  if (!cca) return null;
  try {
    const response = await cca.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    return response?.accessToken || null;
  } catch (err) {
    console.error("[FeedbackScheduler] Failed to acquire Graph token:", err.message);
    return null;
  }
}

async function findFunctionCandidates(targetDate) {
  const { rows } = await pool.query(
    `
    SELECT f.id_uuid,
           f.event_name,
           f.event_date,
           c.id AS contact_id,
           c.name AS contact_name,
           c.email AS contact_email
      FROM functions f
      JOIN LATERAL (
        SELECT c.id, c.name, c.email, c.feedback_opt_out
          FROM function_contacts fc
          JOIN contacts c ON c.id = fc.contact_id
         WHERE fc.function_id = f.id_uuid
         ORDER BY COALESCE(fc.is_primary, FALSE) DESC, fc.created_at ASC
         LIMIT 1
      ) AS c ON TRUE
     WHERE f.auto_feedback = TRUE
       AND f.event_date = $1
       AND COALESCE(c.feedback_opt_out, FALSE) = FALSE
       AND COALESCE(c.email, '') <> ''
       AND NOT EXISTS (
         SELECT 1 FROM feedback_responses
          WHERE entity_type = 'function'
            AND entity_id = f.id_uuid::text
       );
    `,
    [targetDate]
  );
  return rows;
}

async function findRestaurantCandidates(targetDate) {
  const { rows } = await pool.query(
    `
    SELECT b.id,
           b.party_name,
           b.booking_date,
           COALESCE(c.id, NULL) AS contact_id,
           COALESCE(c.name, b.party_name) AS contact_name,
           COALESCE(c.email, b.contact_email) AS contact_email
      FROM restaurant_bookings b
      LEFT JOIN contacts c ON LOWER(c.email) = LOWER(b.contact_email)
     WHERE b.auto_feedback = TRUE
       AND b.booking_date = $1
       AND COALESCE(b.contact_email, '') <> ''
       AND COALESCE(c.feedback_opt_out, FALSE) = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM feedback_responses
          WHERE entity_type = 'restaurant'
            AND entity_id = b.id::text
       );
    `,
    [targetDate]
  );
  return rows;
}

async function createResponse(entityType, entityId, contact) {
  const entityKey = String(entityId);
  const existing = await pool.query(
    `SELECT id FROM feedback_responses WHERE entity_type = $1 AND entity_id = $2 LIMIT 1;`,
    [entityType, entityKey]
  );
  if (existing.rows[0]) return null;
  const insert = await pool.query(
    `
    INSERT INTO feedback_responses
      (entity_type, entity_id, contact_id, contact_email, contact_name, status, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,'pending',NOW(),NOW())
    RETURNING *;
    `,
    [
      entityType,
      entityKey,
      contact.contact_id || null,
      contact.contact_email,
      contact.contact_name || contact.contact_email,
    ]
  );
  return insert.rows[0];
}

async function markSent(responseId) {
  await pool.query(
    `UPDATE feedback_responses SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1;`,
    [responseId]
  );
}

async function markReminderSent(responseId) {
  await pool.query(
    `
    UPDATE feedback_responses
       SET reminder_sent = TRUE,
           sent_at = COALESCE(sent_at, NOW()),
           updated_at = NOW()
     WHERE id = $1;
    `,
    [responseId]
  );
}

async function sendEmail(accessToken, settings, responseRow, context) {
  const subject = renderTemplate(settings.email_subject, context);
  const body = renderTemplate(settings.email_body_html, context);
  await sendMail(accessToken, {
    to: responseRow.contact_email,
    subject,
    body,
  });
}

async function processCandidates(list, entityType, settings, accessToken) {
  for (const entry of list) {
    const contactEmail = (entry.contact_email || "").trim();
    if (!contactEmail) continue;
    const response = await createResponse(entityType, entityType === "function" ? entry.id_uuid : entry.id, {
      contact_id: entry.contact_id,
      contact_email: contactEmail,
      contact_name: entry.contact_name || entry.party_name || entry.event_name,
    });
    if (!response) continue;
    const context = {
      NAME: entry.contact_name || entry.party_name || "there",
      EVENT_NAME: entityType === "function" ? entry.event_name : entry.party_name,
      EVENT_DATE: formatDate(entityType === "function" ? entry.event_date : entry.booking_date),
      SURVEY_LINK: `${APP_URL}/feedback/${response.token}`,
    };
    try {
      await sendEmail(accessToken, settings, response, context);
      await markSent(response.id);
      console.log(`[FeedbackScheduler] Sent survey for ${entityType} ${response.entity_id}`);
    } catch (err) {
      console.error("[FeedbackScheduler] Failed to send email:", err.message);
    }
  }
}

async function sendReminders(settings, accessToken) {
  if (!settings.reminder_days) return;
  const { rows } = await pool.query(
    `
    SELECT r.*,
           f.event_name AS function_name,
           f.event_date AS function_date,
           rb.party_name AS booking_name,
           rb.booking_date AS booking_date
      FROM feedback_responses r
      LEFT JOIN functions f ON r.entity_type = 'function' AND f.id_uuid::text = r.entity_id
      LEFT JOIN restaurant_bookings rb ON r.entity_type = 'restaurant' AND rb.id::text = r.entity_id
     WHERE r.status = 'sent'
       AND r.reminder_sent = FALSE
       AND r.completed_at IS NULL
       AND r.sent_at <= NOW() - ($1::int || ' days')::interval;
    `,
    [settings.reminder_days]
  );
  for (const response of rows) {
    if (!response.contact_email) continue;
    const context = {
      NAME: response.contact_name || response.contact_email,
      EVENT_NAME:
        response.entity_type === "function"
          ? response.function_name || "your function"
          : response.booking_name || "your booking",
      EVENT_DATE:
        response.entity_type === "function"
          ? formatDate(response.function_date)
          : formatDate(response.booking_date),
      SURVEY_LINK: `${APP_URL}/feedback/${response.token}`,
    };
    try {
      await sendEmail(accessToken, settings, response, context);
      await markReminderSent(response.id);
      console.log(`[FeedbackScheduler] Sent reminder for ${response.entity_type} ${response.entity_id}`);
    } catch (err) {
      console.error("[FeedbackScheduler] Failed to send reminder:", err.message);
    }
  }
}

let schedulerToken = null;
let running = false;

async function runFeedbackJob() {
  if (running) return;
  running = true;
  try {
    const settings = await getFeedbackSettings();
    if (!settings.auto_functions && !settings.auto_restaurant) return;
    const target = new Date();
    target.setDate(target.getDate() - settings.send_delay_days);
    const targetDate = formatISODate(target);
    const candidates = [];
    if (settings.auto_functions) {
      const functions = await findFunctionCandidates(targetDate);
      candidates.push({ type: "function", rows: functions });
    }
    if (settings.auto_restaurant) {
      const restaurant = await findRestaurantCandidates(targetDate);
      candidates.push({ type: "restaurant", rows: restaurant });
    }
    const needsSend = candidates.some((item) => item.rows.length);
    if (!needsSend && !settings.reminder_days) return;
    const token = await acquireGraphToken();
    if (!token) return;
    for (const group of candidates) {
      if (group.rows.length) {
        await processCandidates(group.rows, group.type, settings, token);
      }
    }
    if (settings.reminder_days) {
      await sendReminders(settings, token);
    }
  } catch (err) {
    console.error("[FeedbackScheduler] Job failed:", err);
  } finally {
    running = false;
  }
}

function startFeedbackScheduler() {
  if (process.env.DISABLE_FEEDBACK_SCHEDULER === "true") {
    console.log("[FeedbackScheduler] Disabled via environment variable.");
    return;
  }
  runFeedbackJob();
  schedulerToken = setInterval(runFeedbackJob, JOB_INTERVAL);
  console.log("[FeedbackScheduler] Started (interval:", JOB_INTERVAL / 1000, "seconds)");
}

module.exports = {
  startFeedbackScheduler,
};
