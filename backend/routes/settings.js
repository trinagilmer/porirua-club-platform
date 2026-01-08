/**
 * =========================================================
 * ⚙️ Settings Routes
 * Organized per-section (Overview, Event Types, Spaces)
 * =========================================================
 */

const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { fromZonedTime, formatInTimeZone } = require("date-fns-tz");
const recurrenceService = require("../services/recurrenceService");
const {
  getFeedbackSettings,
  getQuestionConfig,
  DEFAULT_TEMPLATE_SUBJECT,
  DEFAULT_TEMPLATE_BODY,
  DEFAULT_SURVEY_HEADER,
  DEFAULT_EVENT_HEADER,
  DEFAULT_FUNCTION_QUESTIONS,
  DEFAULT_RESTAURANT_QUESTIONS,
  renderTemplate,
} = require("../services/feedbackService");
const { runFeedbackJobOnce } = require("../services/feedbackScheduler");
const { sendMail } = require("../services/graphService");
const { getAppToken } = require("../utils/graphAuth");

const CALENDAR_SLOT_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const DEFAULT_CALENDAR_SLOT = 30;
const DEFAULT_SERVICE_SLOT = 30;
const DEFAULT_SERVICE_TURN = 90;
const FEEDBACK_DELAY_MIN = 0;
const FEEDBACK_DELAY_MAX = 30;

const FEEDBACK_TEMPLATE_CONFIG = {
  email: {
    key: "email",
    title: "Email invitation template",
    description:
      "Customize the survey invitation email that is sent after functions and restaurant bookings.",
    subjectField: "email_subject",
    subjectLabel: "Email subject",
    subjectDefault: DEFAULT_TEMPLATE_SUBJECT,
    editorField: "email_body_html",
    editorLabel: "Email body",
    editorDefault: DEFAULT_TEMPLATE_BODY,
    helperText: "Supported placeholders: {{NAME}}, {{EVENT_NAME}}, {{EVENT_DATE}}, {{SURVEY_LINK}}",
    activeTab: "feedback-template-email",
  },
  survey: {
    key: "survey",
    title: "Survey intro template",
    description: "Shown at the top of the public feedback form before the questions.",
    editorField: "survey_header_html",
    editorLabel: "Survey intro / header",
    editorDefault: DEFAULT_SURVEY_HEADER,
    helperText: "",
    activeTab: "feedback-template-survey",
  },
  entertainment: {
    key: "entertainment",
    title: "Entertainment header template",
    description: "Controls the hero text on the public entertainment page.",
    editorField: "events_header_html",
    editorLabel: "Entertainment header",
    editorDefault: DEFAULT_EVENT_HEADER,
    helperText: "",
    activeTab: "feedback-template-entertainment",
  },
};

const FEEDBACK_TEMPLATE_LINKS = [
  { key: "email", label: "Email invite", path: "/settings/feedback/templates/email" },
  { key: "survey", label: "Survey intro", path: "/settings/feedback/templates/survey" },
  { key: "entertainment", label: "Entertainment header", path: "/settings/feedback/templates/entertainment" },
];

async function logPromotionAttempt({ userId, requestedRole, ipAddress, succeeded, message }) {
  try {
    await pool.query(
      `INSERT INTO admin_promotions (user_id, requested_role, ip_address, succeeded, message)
       VALUES ($1, $2, $3, $4, $5);`,
      [userId, (requestedRole || "admin").toLowerCase(), ipAddress || null, Boolean(succeeded), message || null]
    );
  } catch (err) {
    console.error("Failed to log admin promotion:", err);
  }
}

function isPrivileged(req) {
  const role = (req.session?.user?.role || "").toLowerCase();
  const master = process.env.ADMIN_SECRET || process.env.BUILD_ADMIN_SECRET;
  const headerSecret = req.headers["x-admin-secret"];
  const bodySecret =
    req.body?.admin_secret ||
    req.body?.adminSecret ||
    req.query?.admin_secret ||
    req.query?.adminSecret;
  if (role && ["admin", "owner"].includes(role)) return true;
  if (master && (headerSecret === master || bodySecret === master)) return true;
  return false;
}

function ensurePrivileged(req, res, next) {
  if (isPrivileged(req)) return next();
  req.flash("flashMessage", "?? Admin access required.");
  req.flash("flashType", "warning");
  res.redirect("/settings");
}

function parseBooleanField(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (!value) return false;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";
  const weekday = date.toLocaleDateString("en-NZ", { weekday: "long" });
  const month = date.toLocaleDateString("en-NZ", { month: "long" });
  const year = date.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
}

async function acquireGraphToken() {
  return await getAppToken();
}

async function sendSurveyNow(entityType, entityId, settings) {
  const token = await acquireGraphToken();
  if (!token) throw new Error("Graph token unavailable");
  const type = entityType === "restaurant" ? "restaurant" : "function";
  let entry = null;
  if (type === "function") {
    const { rows } = await pool.query(
      `
      SELECT f.id_uuid,
             f.event_name,
             f.event_date,
             c.id AS contact_id,
             c.name AS contact_name,
             c.email AS contact_email
        FROM functions f
        LEFT JOIN LATERAL (
          SELECT c.id, c.name, c.email, c.feedback_opt_out
            FROM function_contacts fc
            JOIN contacts c ON c.id = fc.contact_id
           WHERE fc.function_id = f.id_uuid
           ORDER BY COALESCE(fc.is_primary, FALSE) DESC, fc.created_at ASC
           LIMIT 1
        ) c ON TRUE
       WHERE f.id_uuid = $1
       LIMIT 1;
      `,
      [entityId]
    );
    entry = rows[0] || null;
  } else {
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
       WHERE b.id = $1
       LIMIT 1;
      `,
      [entityId]
    );
    entry = rows[0] || null;
  }
  if (!entry) throw new Error("Record not found");
  const contactEmail = (entry.contact_email || "").trim();
  if (!contactEmail) throw new Error("No contact email available");

  // ensure feedback_response exists
  const entityKey = String(type === "function" ? entry.id_uuid : entry.id);
  let responseRow = null;
  const existing = await pool.query(
    `SELECT * FROM feedback_responses WHERE entity_type = $1 AND entity_id = $2 LIMIT 1;`,
    [type, entityKey]
  );
  if (existing.rows[0]) {
    responseRow = existing.rows[0];
  } else {
    const insert = await pool.query(
      `
      INSERT INTO feedback_responses
        (entity_type, entity_id, contact_id, contact_email, contact_name, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,'pending',NOW(),NOW())
      RETURNING *;
      `,
      [
        type,
        entityKey,
        entry.contact_id || null,
        contactEmail,
        entry.contact_name || entry.party_name || entry.event_name || contactEmail,
      ]
    );
    responseRow = insert.rows[0];
  }

  const context = {
    NAME: entry.contact_name || entry.party_name || "there",
    EVENT_NAME: type === "function" ? entry.event_name : entry.party_name,
    EVENT_DATE: formatDate(entry.event_date || entry.booking_date || ""),
    SURVEY_LINK: `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/feedback/${responseRow.token}`,
  };
  const subject = renderTemplate(settings.email_subject, context);
  let body = renderTemplate(settings.email_body_html, context);
  if (!/feedback/i.test(body) || !/http(s)?:\/\/\S+\/feedback\//i.test(body)) {
    body += `<p><a href="${context.SURVEY_LINK}">Share your feedback</a></p>`;
  }

  await sendMail(token, {
    to: contactEmail,
    subject,
    body,
    fromMailbox:
      type === "function"
        ? process.env.FUNCTION_FEEDBACK_MAILBOX ||
          process.env.FEEDBACK_MAILBOX ||
          process.env.SHARED_MAILBOX ||
          "events@poriruaclub.co.nz"
        : process.env.RESTAURANT_FEEDBACK_MAILBOX ||
          process.env.RESTAURANT_MAILBOX ||
          process.env.FEEDBACK_MAILBOX ||
          process.env.SHARED_MAILBOX ||
          "bookings@poriruaclub.co.nz",
  });

  await pool.query(
    `UPDATE feedback_responses SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1;`,
    [responseRow.id]
  );

  // log to messages
  try {
    await pool.query(
      `
      INSERT INTO messages
        (related_function, from_email, to_email, subject, body, body_html, created_at, message_type)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'feedback');
      `,
      [
        type === "function" ? entityKey : null,
        process.env.FEEDBACK_MAILBOX || process.env.SHARED_MAILBOX || "bookings@poriruaclub.co.nz",
        contactEmail,
        subject,
        body.replace(/<[^>]+>/g, ""),
        body,
      ]
    );
  } catch (err) {
    console.warn("[Settings] Feedback message log skipped:", err.message);
  }
}

function parseIdArray(value) {
  if (!value && value !== 0) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .map((entry) => parseInt(entry, 10))
    .filter((num) => Number.isInteger(num));
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
}

function normalizeHexColor(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) return cleaned;
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `#${cleaned}`;
  return null;
}

async function ensureEntertainmentColorColumn() {
  await pool.query(
    "ALTER TABLE entertainment_events ADD COLUMN IF NOT EXISTS event_color TEXT;"
  );
}

async function ensureUserInvitesTable() {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS user_invites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_by INTEGER NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP NULL
    );
    `
  );
}

async function createUserInvite(userId, createdBy) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `
    INSERT INTO user_invites (user_id, token, created_by, expires_at)
    VALUES ($1, $2, $3, $4)
    RETURNING token;
    `,
    [userId, token, createdBy || null, expiresAt]
  );
  return rows[0]?.token || token;
}

function getAppBaseUrl(req) {
  const envBase = (process.env.APP_URL || "").trim();
  if (envBase) {
    return envBase.replace(/\/$/, "");
  }
  if (req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.get("host");
    if (host) {
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

async function sendUserInviteEmail({ toEmail, toName, inviteToken, baseUrl }) {
  const accessToken = await acquireGraphToken();
  if (!accessToken) throw new Error("Graph token unavailable");
  const inviteLink = `${(baseUrl || getAppBaseUrl()).replace(/\/$/, "")}/auth/accept-invite/${inviteToken}`;
  const subject = "Set up your Porirua Club account";
  const body = `
    <p>Hello ${toName || "there"},</p>
    <p>You have been invited to access the Porirua Club platform.</p>
    <p><a href="${inviteLink}">Click here to set your password</a></p>
    <p>This link expires in 7 days.</p>
  `;
  await sendMail(accessToken, {
    to: toEmail,
    subject,
    body,
    fromMailbox:
      process.env.SHARED_MAILBOX ||
      process.env.FEEDBACK_MAILBOX ||
      process.env.FUNCTION_FEEDBACK_MAILBOX ||
      "events@poriruaclub.co.nz",
  });
}

function combineDateAndTime(dateValue, timeValue) {
  if (!dateValue) return null;
  const datePart = String(dateValue).trim();
  const timePart = String(timeValue || "00:00").trim() || "00:00";
  const asLocalNz = `${datePart}T${timePart}:00`;
  const utcDate = fromZonedTime(asLocalNz, "Pacific/Auckland"); // interpret input as NZT, store as UTC
  return utcDate.toISOString();
}

function formatDateOnlyNz(value) {
  if (!value) return null;
  try {
    return formatInTimeZone(value, "Pacific/Auckland", "yyyy-MM-dd");
  } catch (_) {
    return null;
  }
}

function addDaysIso(dateIso, days) {
  if (!dateIso || typeof days !== "number") return dateIso;
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const entertainmentUploadsDir = path.join(__dirname, "..", "public", "uploads", "entertainment");
if (!fs.existsSync(entertainmentUploadsDir)) {
  fs.mkdirSync(entertainmentUploadsDir, { recursive: true });
}

async function loadEntertainmentMediaItems() {
  const mediaUsageRes = await pool.query(
    `
    SELECT image_url, COUNT(*)::int AS usage_count
      FROM entertainment_events
     WHERE image_url LIKE '/uploads/entertainment/%'
     GROUP BY image_url
    `
  );
  const mediaUsage = mediaUsageRes.rows.reduce((acc, row) => {
    acc[row.image_url] = row.usage_count;
    return acc;
  }, {});
  let mediaItems = [];
  try {
    const files = await fs.promises.readdir(entertainmentUploadsDir);
    const allowed = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
    mediaItems = await Promise.all(
      files
        .filter((file) => allowed.has(path.extname(file).toLowerCase()))
        .map(async (file) => {
          const fullPath = path.join(entertainmentUploadsDir, file);
          const stats = await fs.promises.stat(fullPath);
          if (!stats.isFile()) return null;
          const url = `/uploads/entertainment/${file}`;
          return {
            file,
            url,
            sizeKb: Math.round(stats.size / 1024),
            usageCount: mediaUsage[url] || 0,
          };
        })
    );
    mediaItems = mediaItems.filter(Boolean).sort((a, b) => b.usageCount - a.usageCount);
  } catch (err) {
    console.warn("[Settings] Failed to read entertainment uploads:", err.message);
  }
  return mediaItems;
}

const entertainmentImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, entertainmentUploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = slugify(path.basename(file.originalname, ext)) || "entertainment";
    cb(null, `${safeName}-${Date.now()}${ext}`);
  },
});

const entertainmentImageUpload = multer({
  storage: entertainmentImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

async function syncEntertainmentEventActs(eventId, actIds, db = pool) {
  await db.query(`DELETE FROM entertainment_event_acts WHERE event_id = $1;`, [eventId]);
  if (!actIds?.length) return;
  const values = actIds.map((_, idx) => `($1, $${idx + 2})`).join(",");
  await db.query(`INSERT INTO entertainment_event_acts (event_id, act_id) VALUES ${values};`, [
    eventId,
    ...actIds,
  ]);
}

// Use the settings layout for everything in this router
router.use((req, res, next) => {
  res.locals.layout = 'layouts/settings';
  next();
});

// ✅ Make sure form posts are parsed (HTML forms use urlencoded)
router.use(express.urlencoded({ extended: true, limit: "5mb" }));
router.use(express.json({ limit: "5mb" })); // if any JSON posts too
/* =========================================================
   🧭 BASE REDIRECT — /settings → /settings/overview
========================================================= */
router.get("/", (req, res) => res.redirect("/settings/overview"));

// ------------------------------------------------------
// Manuals
// ------------------------------------------------------
router.get("/manuals/functions", (req, res) => {
  res.render("settings/manuals/functions-white-paper", {
    layout: "layouts/settings",
    title: "Functions Manual",
    pageType: "settings",
    activeTab: "manuals-functions",
  });
});

/* =========================================================
   🧩 SETTINGS OVERVIEW
========================================================= */
router.get("/overview", async (req, res) => {
  try {
    const [eventTypesRes, roomsRes, templatesRes, menusRes, entertainmentRes] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM club_event_types;"),
      pool.query("SELECT COUNT(*)::int AS count FROM rooms;"),
      pool.query("SELECT COUNT(*)::int AS count FROM note_templates;"),
      pool.query("SELECT COUNT(*)::int AS count FROM menus;"),
      pool.query("SELECT COUNT(*)::int AS count FROM entertainment_events;"),
    ]);

    res.render("settings/index", {
      layout: "layouts/settings",
      title: "Settings Overview",
      pageType: "settings",
      activeTab: "overview",
      counts: {
        eventTypes: eventTypesRes.rows[0]?.count ?? 0,
        rooms: roomsRes.rows[0]?.count ?? 0,
        noteTemplates: templatesRes.rows[0]?.count ?? 0,
        menus: menusRes.rows[0]?.count ?? 0,
        entertainment: entertainmentRes.rows[0]?.count ?? 0,
      },
      user: req.session.user || null,
      flashMessage: req.flash?.("flashMessage"),
      flashType: req.flash?.("flashType"),
    });
  } catch (err) {
    console.error("❌ Settings overview error:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load settings overview.",
      error: err.message,
      stack: err.stack,
    });
  }
});

router.get("/feedback", ensurePrivileged, async (req, res) => {
  try {
    const feedbackSettings = await getFeedbackSettings();
    const { rows: statsRows } = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM feedback_responses GROUP BY status;`
    );
    const { rows: recentFunctions } = await pool.query(
      `
      SELECT f.id_uuid, f.event_name, f.event_date, c.email AS contact_email
        FROM functions f
        LEFT JOIN LATERAL (
          SELECT c.email
            FROM function_contacts fc
            JOIN contacts c ON c.id = fc.contact_id
           WHERE fc.function_id = f.id_uuid
           ORDER BY COALESCE(fc.is_primary, FALSE) DESC, fc.created_at ASC
           LIMIT 1
        ) c ON TRUE
       WHERE f.event_date IS NOT NULL
       ORDER BY f.event_date DESC NULLS LAST, f.updated_at DESC
       LIMIT 30;
      `
    );
    const { rows: recentBookings } = await pool.query(
      `
      SELECT b.id, b.party_name, b.booking_date, b.contact_email
        FROM restaurant_bookings b
       WHERE b.booking_date IS NOT NULL
       ORDER BY b.booking_date DESC, b.updated_at DESC
       LIMIT 30;
      `
    );
    res.render("settings/feedback", {
      layout: "layouts/settings",
      title: "Settings - Feedback Automation",
      pageType: "settings",
      activeTab: "feedback-automation",
      feedbackSettings,
      stats: statsRows,
      recentFunctions,
      recentBookings,
      templateLinks: FEEDBACK_TEMPLATE_LINKS,
      user: req.session.user || null,
      flashMessage: req.flash?.("flashMessage"),
      flashType: req.flash?.("flashType"),
    });
  } catch (err) {
    console.error("❌ Error loading feedback settings:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load feedback settings.",
      error: err.message,
      stack: err.stack,
    });
  }
});

router.post("/feedback/send-now", ensurePrivileged, async (req, res) => {
  try {
    const { type, function_id, booking_id } = req.body || {};
    const targetType = (type || (function_id ? "function" : "restaurant")).toLowerCase();
    const id = targetType === "function" ? function_id : booking_id;
    if (!id) throw new Error("Select a function or booking to send a survey.");
    const settings = await getFeedbackSettings();
    await sendSurveyNow(targetType, id, settings);
    req.flash("flashMessage", "✅ Survey sent.");
    req.flash("flashType", "success");
  } catch (err) {
    console.error("❌ Feedback send-now failed:", err);
    req.flash("flashMessage", err.message || "Unable to trigger surveys.");
    req.flash("flashType", "error");
  }
  res.redirect("/settings/feedback");
});

router.get("/feedback/activity", ensurePrivileged, async (req, res) => {
  try {
    const {
      type = "",
      status = "",
      min_rating = "",
      max_rating = "",
      from = "",
      to = "",
    } = req.query || {};
    const { rows: optOutRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM contacts WHERE feedback_opt_out = TRUE;`
    );
    const { rows: statusRows } = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM feedback_responses GROUP BY status;`
    );
    const statusCounts = statusRows.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
    const conditions = [];
    const params = [];
    if (type) {
      params.push(type);
      conditions.push(`r.entity_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }
    if (min_rating) {
      params.push(Number(min_rating));
      conditions.push(`r.rating_overall >= $${params.length}`);
    }
    if (max_rating) {
      params.push(Number(max_rating));
      conditions.push(`r.rating_overall <= $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`COALESCE(r.completed_at, r.sent_at, r.created_at) >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`COALESCE(r.completed_at, r.sent_at, r.created_at) <= $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows: responses } = await pool.query(
      `
      SELECT r.*,
             CASE WHEN r.entity_type = 'function' THEN f.event_name ELSE rb.party_name END AS event_name,
             CASE WHEN r.entity_type = 'function' THEN f.event_date ELSE rb.booking_date END AS event_date,
             stats.contact_avg_overall,
             stats.contact_avg_nps,
             stats.contact_count
        FROM feedback_responses r
        LEFT JOIN functions f ON r.entity_type = 'function' AND f.id_uuid::text = r.entity_id
        LEFT JOIN restaurant_bookings rb ON r.entity_type = 'restaurant' AND rb.id::text = r.entity_id
        LEFT JOIN LATERAL (
          SELECT AVG(r2.rating_overall)::numeric(10,2) AS contact_avg_overall,
                 AVG(r2.nps_score)::numeric(10,2) AS contact_avg_nps,
                 COUNT(*)::int AS contact_count
            FROM feedback_responses r2
           WHERE r2.status = 'completed'
             AND (
                  (r.contact_id IS NOT NULL AND r2.contact_id = r.contact_id)
               OR (COALESCE(r.contact_email, '') <> '' AND LOWER(r2.contact_email) = LOWER(r.contact_email))
             )
        ) stats ON TRUE
       ${whereClause}
       ORDER BY r.updated_at DESC
       LIMIT 50;
      `,
      params
    );
    function computeSummary(list) {
      const completed = list.filter((r) => r.status === "completed");
      const summary = {
        count: completed.length,
        avgOverall:
          completed.length > 0
            ? Number(
                (
                  completed.reduce((sum, r) => sum + (Number(r.rating_overall) || 0), 0) /
                  completed.length
                ).toFixed(2)
              )
            : null,
        avgService:
          completed.filter((r) => r.rating_service !== null && r.rating_service !== undefined).length >
          0
            ? Number(
                (
                  completed.reduce((sum, r) => sum + (Number(r.rating_service) || 0), 0) /
                  completed.filter(
                    (r) => r.rating_service !== null && r.rating_service !== undefined
                  ).length
                ).toFixed(2)
              )
            : null,
        recommendRate:
          completed.length > 0
            ? Math.round(
                (completed.filter((r) => r.recommend === true).length / completed.length) * 100
              )
            : null,
        nps: null,
      };
      const npsScores = completed
        .map((r) =>
          typeof r.nps_score === "number" && !Number.isNaN(r.nps_score)
            ? r.nps_score
            : r.rating_overall
            ? Math.max(0, Math.min(10, Math.round((Number(r.rating_overall) / 5) * 10)))
            : null
        )
        .filter((v) => v !== null);
      if (npsScores.length) {
        const promoters = npsScores.filter((v) => v >= 9).length;
        const detractors = npsScores.filter((v) => v <= 6).length;
        summary.nps = Math.round(((promoters - detractors) / npsScores.length) * 100);
      }
      return summary;
    }

    const summaryOverall = computeSummary(responses);
    const summaryFunctions = computeSummary(responses.filter((r) => r.entity_type === "function"));
    const summaryRestaurant = computeSummary(
      responses.filter((r) => r.entity_type === "restaurant")
    );

    // Lightweight keyword / tag aggregation
    const completed = responses.filter((r) => r.status === "completed");
    const issueCounts = {};
    completed.forEach((r) => {
      const tags = Array.isArray(r.issue_tags) ? r.issue_tags : [];
      tags.forEach((t) => {
        const key = String(t).trim();
        if (!key) return;
        issueCounts[key] = (issueCounts[key] || 0) + 1;
      });
      if (r.comments) {
        const text = String(r.comments).toLowerCase();
        ["service", "food", "speed", "value", "clean", "communication", "staff"].forEach((kw) => {
          if (text.includes(kw)) {
            issueCounts[kw] = (issueCounts[kw] || 0) + 1;
          }
        });
      }
    });
    const topIssues = Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));

    // Trend / segmentation datasets for charts
    const trendMap = new Map();
    responses
      .filter((r) => r.completed_at || r.sent_at)
      .forEach((r) => {
        const dateKey = new Date(r.completed_at || r.sent_at || r.updated_at || r.created_at)
          .toISOString()
          .slice(0, 10);
        const entry = trendMap.get(dateKey) || { total: 0, count: 0, lows: 0 };
        const rating = Number(r.rating_overall) || 0;
        entry.total += rating;
        entry.count += 1;
        if (rating && rating <= 2) entry.lows += 1;
        trendMap.set(dateKey, entry);
      });
    const trendLabels = Array.from(trendMap.keys()).sort();
    const trendAvg = trendLabels.map((d) => {
      const item = trendMap.get(d);
      return item && item.count ? Number((item.total / item.count).toFixed(2)) : null;
    });
    const trendLows = trendLabels.map((d) => {
      const item = trendMap.get(d);
      return item?.lows || 0;
    });

    const typeCounts = responses.reduce(
      (acc, r) => {
        const key = r.entity_type || "unknown";
        if (!acc[key]) acc[key] = { total: 0, completed: 0, low: 0 };
        acc[key].total += 1;
        if (r.status === "completed") acc[key].completed += 1;
        const rating = Number(r.rating_overall) || 0;
        if (rating && rating <= 2) acc[key].low += 1;
        return acc;
      },
      {}
    );

    const chartData = {
      trendLabels,
      trendAvg,
      trendLows,
      issueLabels: topIssues.map((i) => i.label),
      issueCounts: topIssues.map((i) => i.count),
      typeLabels: Object.keys(typeCounts),
      typeCompleted: Object.keys(typeCounts).map((k) => typeCounts[k].completed),
      typeLow: Object.keys(typeCounts).map((k) => typeCounts[k].low),
    };

    const completedCount = responses.filter((r) => r.status === "completed").length;
    const positive = responses.filter((r) => Number(r.rating_overall) >= 4).length;
    const negative = responses.filter((r) => Number(r.rating_overall) > 0 && Number(r.rating_overall) <= 2).length;
    const completionRate = responses.length ? Math.round((completedCount / responses.length) * 100) : null;

    res.render("settings/feedback-activity", {
      layout: "layouts/settings",
      title: "Settings - Feedback Activity",
      pageType: "settings",
      activeTab: "feedback-activity",
      contactStats: { optOutCount: optOutRows[0]?.count || 0 },
      statusCounts,
      responses,
      summaryOverall,
      summaryFunctions,
      summaryRestaurant,
      topIssues,
      chartData,
      completionRate,
      positiveCount: positive,
      negativeCount: negative,
      filters: { type, status, min_rating, max_rating, from, to },
      user: req.session.user || null,
      flashMessage: req.flash?.("flashMessage"),
      flashType: req.flash?.("flashType"),
    });
  } catch (err) {
    console.error("❌ Error loading feedback activity:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load feedback activity.",
      error: err.message,
      stack: err.stack,
    });
  }
});

router.get("/feedback/export", ensurePrivileged, async (req, res) => {
  try {
    const {
      type = "",
      status = "",
      min_rating = "",
      max_rating = "",
      from = "",
      to = "",
    } = req.query || {};
    const conditions = [];
    const params = [];
    if (type) {
      params.push(type);
      conditions.push(`r.entity_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }
    if (min_rating) {
      params.push(Number(min_rating));
      conditions.push(`r.rating_overall >= $${params.length}`);
    }
    if (max_rating) {
      params.push(Number(max_rating));
      conditions.push(`r.rating_overall <= $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`COALESCE(r.completed_at, r.sent_at, r.created_at) >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`COALESCE(r.completed_at, r.sent_at, r.created_at) <= $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `
      SELECT r.entity_type,
             r.entity_id,
             r.contact_name,
             r.contact_email,
             r.status,
             r.rating_overall,
             r.rating_service,
             r.nps_score,
             r.recommend,
             r.comments,
             r.issue_tags,
             r.sent_at,
             r.completed_at,
             CASE WHEN r.entity_type = 'function' THEN f.event_name ELSE rb.party_name END AS event_name,
             CASE WHEN r.entity_type = 'function' THEN f.event_date ELSE rb.booking_date END AS event_date
        FROM feedback_responses r
        LEFT JOIN functions f ON r.entity_type = 'function' AND f.id_uuid::text = r.entity_id
        LEFT JOIN restaurant_bookings rb ON r.entity_type = 'restaurant' AND rb.id::text = r.entity_id
       ${whereClause}
       ORDER BY r.updated_at DESC;
      `,
      params
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=\"feedback-export.csv\"");
    const header = [
      "Type",
      "Entity ID",
      "Name",
      "Email",
      "Status",
      "Rating",
      "Service",
      "NPS",
      "Recommend",
      "Comments",
      "Issues",
      "Sent",
      "Completed",
      "Event Name",
      "Event Date",
    ];
    const lines = [header.join(",")];
    rows.forEach((r) => {
      const line = [
        r.entity_type,
        `"${r.entity_id}"`,
        `"${(r.contact_name || "").replace(/"/g, '""')}"`,
        `"${(r.contact_email || "").replace(/"/g, '""')}"`,
        r.status,
        r.rating_overall || "",
        r.rating_service || "",
        r.nps_score || "",
        r.recommend === null ? "" : r.recommend ? "Yes" : "No",
        `"${(r.comments || "").replace(/"/g, '""')}"`,
        `"${Array.isArray(r.issue_tags) ? r.issue_tags.join("; ").replace(/"/g, '""') : ""}"`,
        r.sent_at || "",
        r.completed_at || "",
        `"${(r.event_name || "").replace(/"/g, '""')}"`,
        r.event_date || "",
      ];
      lines.push(line.join(","));
    });
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("❌ Feedback export failed:", err);
    req.flash("flashMessage", "Failed to export feedback.");
    req.flash("flashType", "error");
    res.redirect("/settings/feedback/activity");
  }
});

router.post("/feedback/clear", ensurePrivileged, async (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== "yes") {
      req.flash("flashMessage", "Confirmation required to delete feedback data.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/feedback/activity");
    }
    await pool.query("DELETE FROM feedback_responses;");
    req.flash("flashMessage", "All feedback requests and responses deleted.");
    req.flash("flashType", "success");
  } catch (err) {
    console.error("❌ Error clearing feedback responses:", err);
    req.flash("flashMessage", "Failed to delete feedback data.");
    req.flash("flashType", "error");
  }
  res.redirect("/settings/feedback/activity");
});

router.post("/feedback", ensurePrivileged, async (req, res) => {
  const autoFunctions = parseBooleanField(req.body.auto_functions);
  const autoRestaurant = parseBooleanField(req.body.auto_restaurant);
  const sendDelay = Math.max(
    FEEDBACK_DELAY_MIN,
    Math.min(FEEDBACK_DELAY_MAX, parseInt(req.body.send_delay_days, 10) || 0)
  );
  const reminderDays = Math.max(
    FEEDBACK_DELAY_MIN,
    Math.min(FEEDBACK_DELAY_MAX, parseInt(req.body.reminder_days, 10) || 0)
  );
  function extractQuestionConfig(prefix, defaults) {
    const overallLabel = req.body[`${prefix}_overall_label`] || defaults.overallLabel;
    const showService =
      Object.prototype.hasOwnProperty.call(req.body, `${prefix}_show_service_present`) ?
        parseBooleanField(req.body[`${prefix}_show_service`]) :
        defaults.showService;
    const serviceLabel = req.body[`${prefix}_service_label`] || defaults.serviceLabel;
    const showRecommend =
      Object.prototype.hasOwnProperty.call(req.body, `${prefix}_show_recommend_present`) ?
        parseBooleanField(req.body[`${prefix}_show_recommend`]) :
        defaults.showRecommend;
    const recommendLabel = req.body[`${prefix}_recommend_label`] || defaults.recommendLabel;
    const showComments =
      Object.prototype.hasOwnProperty.call(req.body, `${prefix}_show_comments_present`) ?
        parseBooleanField(req.body[`${prefix}_show_comments`]) :
        defaults.showComments;
    const commentsLabel = req.body[`${prefix}_comments_label`] || defaults.commentsLabel;

    return {
      overallLabel,
      showService,
      serviceLabel,
      showRecommend,
      recommendLabel,
      showComments,
      commentsLabel,
    };
  }

  const functionQuestionConfig = extractQuestionConfig("function", DEFAULT_FUNCTION_QUESTIONS);
  const restaurantQuestionConfig = extractQuestionConfig("restaurant", DEFAULT_RESTAURANT_QUESTIONS);

  try {
    const settings = await getFeedbackSettings();
    await pool.query(
      `
      UPDATE feedback_settings
         SET auto_functions = $1,
             auto_restaurant = $2,
             send_delay_days = $3,
             reminder_days = $4,
             function_question_config = $5,
             restaurant_question_config = $6,
             updated_at = NOW()
       WHERE id = $7;
      `,
      [
        autoFunctions,
        autoRestaurant,
        sendDelay,
        reminderDays,
        JSON.stringify(functionQuestionConfig),
        JSON.stringify(restaurantQuestionConfig),
        settings.id,
      ]
    );
    req.flash("flashMessage", "✅ Feedback settings updated.");
    req.flash("flashType", "success");
  } catch (err) {
    console.error("❌ Error saving feedback settings:", err);
    req.flash("flashMessage", "❌ Unable to save feedback settings.");
    req.flash("flashType", "error");
  }
  res.redirect("/settings/feedback");
});

router.get("/feedback/templates/:type", ensurePrivileged, async (req, res) => {
  const templateType = req.params.type;
  const templateConfig = FEEDBACK_TEMPLATE_CONFIG[templateType];
  if (!templateConfig) {
    return res.status(404).render("error", {
      layout: "layouts/main",
      title: "Not found",
      message: "Template not found.",
    });
  }

  try {
    const feedbackSettings = await getFeedbackSettings();
    res.render("settings/feedback-template", {
      layout: "layouts/settings",
      title: `Settings — ${templateConfig.title}`,
      pageType: "settings",
      activeTab: templateConfig.activeTab,
      templateConfig,
      templateLinks: FEEDBACK_TEMPLATE_LINKS,
      templateValues: {
        subject: templateConfig.subjectField ? feedbackSettings[templateConfig.subjectField] : "",
        editor: templateConfig.editorField ? feedbackSettings[templateConfig.editorField] : "",
      },
      user: req.session.user || null,
      flashMessage: req.flash?.("flashMessage"),
      flashType: req.flash?.("flashType"),
    });
  } catch (err) {
    console.error("❌ Error loading template settings:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load template.",
      error: err.message,
      stack: err.stack,
    });
  }
});

router.post("/feedback/templates/:type", ensurePrivileged, async (req, res) => {
  const templateType = req.params.type;
  const templateConfig = FEEDBACK_TEMPLATE_CONFIG[templateType];
  if (!templateConfig) {
    req.flash("flashMessage", "Unknown template.");
    req.flash("flashType", "error");
    return res.redirect("/settings/feedback");
  }

  try {
    const settings = await getFeedbackSettings();
    const updates = [];
    const values = [];

    if (templateConfig.subjectField) {
      const subjectValue =
        (req.body[templateConfig.subjectField] || templateConfig.subjectDefault || "").trim();
      updates.push(`${templateConfig.subjectField} = $${updates.length + 1}`);
      values.push(subjectValue);
    }

    if (templateConfig.editorField) {
      const editorValue =
        req.body[templateConfig.editorField] || templateConfig.editorDefault || "";
      updates.push(`${templateConfig.editorField} = $${updates.length + 1}`);
      values.push(editorValue);
    }

    if (!updates.length) throw new Error("No fields to update.");

    await pool.query(
      `
        UPDATE feedback_settings
           SET ${updates.join(", ")},
               updated_at = NOW()
         WHERE id = $${updates.length + 1};
      `,
      [...values, settings.id]
    );

    req.flash("flashMessage", "✅ Template saved.");
    req.flash("flashType", "success");
  } catch (err) {
    console.error("❌ Error saving template:", err);
    req.flash("flashMessage", "Unable to save template.");
    req.flash("flashType", "error");
  }

  res.redirect(`/settings/feedback/templates/${templateType}`);
});

router.get("/feedback/preview", ensurePrivileged, async (req, res) => {
  try {
    const type = req.query.type === "restaurant" ? "restaurant" : "function";
    const settings = await getFeedbackSettings();
    const questionConfig = getQuestionConfig(settings, type);
    const now = new Date();
    const entry =
      type === "restaurant"
        ? {
            entity_type: "restaurant",
            contact_name: "Alex Preview",
            contact_email: "preview@example.com",
            booking_name: "Sample Restaurant Booking",
            booking_date: now,
            status: "pending",
          }
        : {
            entity_type: "function",
            contact_name: "Alex Preview",
            contact_email: "preview@example.com",
            function_name: "Sample Function",
            function_date: now,
            status: "pending",
          };
    res.render("pages/feedback/form", {
      layout: "layouts/main",
      hideChrome: true,
      title: "Feedback Preview",
      pageType: "feedback",
      entry,
      surveyHeaderHtml: settings.survey_header_html,
      errorMessage: null,
      success: false,
      questionConfig,
      preview: true,
      formatDisplayDate: (value) => {
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime())
          ? ""
          : date.toLocaleDateString("en-NZ", {
              weekday: "long",
              month: "long",
              day: "numeric",
            });
      },
    });
  } catch (err) {
    console.error("[Feedback Preview] Failed:", err);
    res.status(500).send("Unable to load preview");
  }
});

/* =========================================================
   ?? SETTINGS: USERS
 ========================================================= */
router.get("/users", async (req, res) => {
  try {
    await ensureUserInvitesTable();
    const { rows: users } = await pool.query(
      `
      SELECT u.id,
             u.name,
             u.email,
             u.role,
             u.created_at,
             MAX(i.created_at) AS last_invite_at,
             MAX(i.used_at) AS last_invite_used_at
        FROM users u
        LEFT JOIN user_invites i ON i.user_id = u.id
       GROUP BY u.id, u.name, u.email, u.role, u.created_at
       ORDER BY u.name ASC;
      `
    );

    const secretConfigured = Boolean(process.env.ADMIN_SECRET || process.env.BUILD_ADMIN_SECRET);
    res.render("settings/users", {
      layout: "layouts/settings",
      title: "Settings - User Management",
      pageType: "settings",
      activeTab: "users",
      users,
      user: req.session.user || null,
      canManage: isPrivileged(req),
      canSelfPromote:
        !isPrivileged(req) && secretConfigured,
      secretConfigured,
    });
  } catch (err) {
    console.error("? Error loading users:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load users.",
      error: err.message,
      stack: err.stack,
    });
  }
});

router.post("/users/add", ensurePrivileged, async (req, res) => {
  try {
    const { name, email, role = "staff" } = req.body;
    const sendInvite = parseBooleanField(req.body.send_invite);
    if (!name?.trim() || !email?.trim()) {
      req.flash("flashMessage", "?? Name and email are required.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/users");
    }
    const { rows: columnRows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND table_schema = 'public';`
    );
    const columns = columnRows.map((r) => r.column_name);
    const hasPassword = columns.includes("password_hash");
    const tempPassword = hasPassword ? crypto.randomBytes(6).toString("base64") : null;
    const passwordHash = hasPassword ? await bcrypt.hash(tempPassword, 10) : null;

    if (hasPassword) {
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, role, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name,
               role = EXCLUDED.role,
               password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash)
         RETURNING id, name, email;`,
        [name.trim(), email.trim().toLowerCase(), (role || "staff").toLowerCase(), passwordHash]
      );
      const storedUser = rows[0];
      if (sendInvite && storedUser) {
        await ensureUserInvitesTable();
        const token = await createUserInvite(storedUser.id, req.session.user?.id);
        await sendUserInviteEmail({
          toEmail: storedUser.email,
          toName: storedUser.name,
          inviteToken: token,
          baseUrl: getAppBaseUrl(req),
        });
        req.flash("flashMessage", "Invite sent. The user can set their own password.");
      } else {
        req.flash(
          "flashMessage",
          `? User stored. Temp password: ${tempPassword} (ask them to log in and change it).`
        );
      }
    } else {
      await pool.query(
        `INSERT INTO users (name, email, role)
           VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name,
               role = EXCLUDED.role;`,
        [name.trim(), email.trim().toLowerCase(), (role || "staff").toLowerCase()]
      );
      req.flash(
        "flashMessage",
        "? User stored. (Password-less schema detected; uses external auth only.)"
      );
    }
    req.flash("flashType", "success");
    res.redirect("/settings/users");
  } catch (err) {
    console.error("? Error creating user:", err);
    req.flash("flashMessage", "? Failed to create user.");
    req.flash("flashType", "error");
    res.redirect("/settings/users");
  }
});

router.post("/users/edit", ensurePrivileged, async (req, res) => {
  try {
    const { id, name, email, role } = req.body;
    if (!id) return res.redirect("/settings/users");
    await pool.query(
      `UPDATE users
          SET name = $1,
              email = $2,
              role = $3,
              updated_at = NOW()
        WHERE id = $4;`,
      [(name || "").trim(), (email || "").trim().toLowerCase(), (role || "staff").toLowerCase(), id]
    );
    req.flash("flashMessage", "? User updated.");
    req.flash("flashType", "success");
    res.redirect("/settings/users");
  } catch (err) {
    console.error("? Error updating user:", err);
    req.flash("flashMessage", "? Failed to update user.");
    req.flash("flashType", "error");
    res.redirect("/settings/users");
  }
});

router.post("/users/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      req.flash("flashMessage", "?? Missing user id.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/users");
    }
    await pool.query(`UPDATE functions SET owner_id = NULL WHERE owner_id = $1;`, [id]);
    await pool.query(`UPDATE tasks SET assigned_user_id = NULL WHERE assigned_user_id = $1;`, [id]);
    await pool.query(`DELETE FROM admin_promotions WHERE user_id = $1;`, [id]);
    await pool.query("DELETE FROM users WHERE id = $1;", [id]);
    req.flash("flashMessage", "?? User removed.");
    req.flash("flashType", "success");
    res.redirect("/settings/users");
  } catch (err) {
    console.error("? Error deleting user:", err);
    req.flash("flashMessage", "? Failed to delete user.");
    req.flash("flashType", "error");
    res.redirect("/settings/users");
  }
});

router.post("/users/promote", async (req, res) => {
  if (!req.session?.user) {
    req.flash("flashMessage", "?? You must be logged in.");
    req.flash("flashType", "warning");
    return res.redirect("/settings");
  }
  const { secret, role = "admin" } = req.body;
  const master = process.env.ADMIN_SECRET || process.env.BUILD_ADMIN_SECRET;
  if (!master || secret !== master) {
    req.flash("flashMessage", "?? Invalid promotion code.");
    req.flash("flashType", "danger");
    logPromotionAttempt({
      userId: req.session.user.id,
      requestedRole: role,
      ipAddress: req.ip || req.headers["x-forwarded-for"]?.split?.(",")?.[0]?.trim(),
      succeeded: false,
      message: "Invalid admin code"
    });
    return res.redirect("/settings/users");
  }
  try {
    await pool.query(
      `UPDATE users
          SET role = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [role.toLowerCase(), req.session.user.id]
    );
    req.session.user.role = role.toLowerCase();
    logPromotionAttempt({
      userId: req.session.user.id,
      requestedRole: role,
      ipAddress: req.ip || req.headers["x-forwarded-for"]?.split?.(",")?.[0]?.trim(),
      succeeded: true,
      message: "Promotion granted"
    });
    req.flash("flashMessage", "? You are now an admin.");
    req.flash("flashType", "success");
    res.redirect("/settings/users");
  } catch (err) {
    logPromotionAttempt({
      userId: req.session.user.id,
      requestedRole: role,
      ipAddress: req.ip || req.headers["x-forwarded-for"]?.split?.(",")?.[0]?.trim(),
      succeeded: false,
      message: err.message
    });
    console.error("? Error promoting user:", err);
    req.flash("flashMessage", "? Failed to change role.");
    req.flash("flashType", "error");
    res.redirect("/settings/users");
  }
});


/* =========================================================
   ⚙️ SETTINGS: EVENT TYPES
========================================================= */
router.get("/event-types", async (req, res) => {
  try {
    const { rows: eventTypes } = await pool.query(
      "SELECT * FROM club_event_types ORDER BY name ASC;"
    );

    res.render("settings/event-types", {
      layout: "layouts/settings",
      title: "Settings — Event Types",
      pageType: "settings",
      activeTab: "event-types",
      eventTypes,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ Error loading event types:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load event types.",
      error: err.message,
      stack: err.stack,
    });
  }
});

/* =========================================================
   ⚙️ SETTINGS: ROOMS / SPACES
========================================================= */
router.get("/spaces", async (req, res) => {
  try {
    const { rows: rooms } = await pool.query("SELECT * FROM rooms ORDER BY name ASC;");

    res.render("settings/spaces", {
      layout: "layouts/settings",
      title: "Settings — Rooms / Spaces",
      pageType: "settings",
      activeTab: "spaces",
      rooms,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ Error loading rooms:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load rooms.",
      error: err.message,
      stack: err.stack,
    });
  }
});

/* =========================================================
   ➕ ADD NEW EVENT TYPE (Flash + Redirect)
========================================================= */
router.post("/event-types/add", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Please enter a valid event type name.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/event-types");
    }

    const result = await pool.query(
      "INSERT INTO club_event_types (name) VALUES ($1) RETURNING id, name;",
      [name.trim()]
    );

    req.flash("flashMessage", `✅ "${result.rows[0].name}" added successfully!`);
    req.flash("flashType", "success");
    res.redirect("/settings/event-types");
  } catch (err) {
    console.error("❌ Error adding event type:", err);
    req.flash("flashMessage", "❌ Failed to add event type.");
    req.flash("flashType", "error");
    res.redirect("/settings/event-types");
  }
});

/* =========================================================
   ✏️ EDIT EVENT TYPE (Flash + Redirect)
========================================================= */
router.post("/event-types/edit", async (req, res) => {
  try {
    const { id, name } = req.body;

    if (!id || !name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Invalid event type data.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/event-types");
    }

    await pool.query("UPDATE club_event_types SET name = $1 WHERE id = $2;", [name.trim(), id]);

    req.flash("flashMessage", `✅ Event type updated successfully.`);
    req.flash("flashType", "success");
    res.redirect("/settings/event-types");
  } catch (err) {
    console.error("❌ Error editing event type:", err);
    req.flash("flashMessage", "❌ Failed to update event type.");
    req.flash("flashType", "error");
    res.redirect("/settings/event-types");
  }
});

/* =========================================================
   🗑️ DELETE EVENT TYPE (Flash + Redirect)
========================================================= */
router.post("/event-types/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      req.flash("flashMessage", "⚠️ Missing event type ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/event-types");
    }

    await pool.query("DELETE FROM club_event_types WHERE id = $1;", [id]);

    req.flash("flashMessage", "🗑️ Event type deleted successfully.");
    req.flash("flashType", "success");
    res.redirect("/settings/event-types");
  } catch (err) {
    console.error("❌ Error deleting event type:", err);
    req.flash("flashMessage", "❌ Failed to delete event type.");
    req.flash("flashType", "error");
    res.redirect("/settings/event-types");
  }
});

/* =========================================================
   🏠 SPACES CRUD (Flash + Redirect)
========================================================= */

// ➕ Add
router.post("/spaces/add", async (req, res) => {
  try {
    const { name, capacity } = req.body;

    if (!name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Please enter a valid room name.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/spaces");
    }

    const result = await pool.query(
      "INSERT INTO rooms (name, capacity) VALUES ($1, $2) RETURNING id, name;",
      [name.trim(), capacity || null]
    );

    req.flash("flashMessage", `✅ "${result.rows[0].name}" added successfully!`);
    req.flash("flashType", "success");
    res.redirect("/settings/spaces");
  } catch (err) {
    console.error("❌ Error adding room:", err);
    req.flash("flashMessage", "❌ Failed to add room.");
    req.flash("flashType", "error");
    res.redirect("/settings/spaces");
  }
});

// ✏️ Edit
router.post("/spaces/edit", async (req, res) => {
  try {
    const { id, name, capacity } = req.body;

    if (!id || !name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Invalid room data.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/spaces");
    }

    await pool.query("UPDATE rooms SET name=$1, capacity=$2 WHERE id=$3", [
      name.trim(),
      capacity || null,
      id,
    ]);

    req.flash("flashMessage", "✅ Room updated successfully.");
    req.flash("flashType", "success");
    res.redirect("/settings/spaces");
  } catch (err) {
    console.error("❌ Error editing room:", err);
    req.flash("flashMessage", "❌ Failed to update room.");
    req.flash("flashType", "error");
    res.redirect("/settings/spaces");
  }
});

// 🗑️ Delete
router.post("/spaces/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      req.flash("flashMessage", "⚠️ Missing room ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/spaces");
    }

    await pool.query("DELETE FROM rooms WHERE id = $1;", [id]);

    req.flash("flashMessage", "🗑️ Room deleted successfully.");
    req.flash("flashType", "success");
    res.redirect("/settings/spaces");
  } catch (err) {
    if (err.code === "23503") {
      req.flash("flashMessage", "⚠️ This room is linked to one or more functions and cannot be deleted.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/spaces");
    }

    console.error("❌ Error deleting room:", err);
    req.flash("flashMessage", "❌ Failed to delete room.");
    req.flash("flashType", "error");
    res.redirect("/settings/spaces");
  }
});
/* =========================================================
   🧩 SETTINGS: NOTE TEMPLATES (Templates for Notes/Proposals)
   - List/create/edit/delete templates stored in public.note_templates
   - Uses HTML content (content) as the primary field for now
========================================================= */

// LIST
router.get("/note-templates", async (req, res) => {
  try {
    const { rows: templates } = await pool.query(
      `SELECT id, name, category, description, content
         FROM note_templates
        ORDER BY name ASC;`
    );

    const { rows: mergeFields } = await pool.query(
      `SELECT key, label, description, entity, formatter
         FROM merge_fields
        ORDER BY entity, label;`
    );

    res.render("settings/note-templates", {
      layout: "layouts/settings",
      title: "Settings — Note Templates",
      pageType: "settings",
      activeTab: "note-templates",
      templates,
      mergeFields,
      user: req.session.user || null,
      flashMessage: req.flash("flashMessage"),
      flashType: req.flash("flashType"),
    });
  } catch (err) {
    console.error("❌ Error loading note templates:", err);
    res.status(500).render("error", {
      layout: "layouts/main",
      title: "Error",
      message: "Failed to load note templates.",
      error: err.message,
      stack: err.stack,
    });
  }
});

// ADD
router.post("/note-templates/add", async (req, res) => {
  try {
    const { name, category, description, content } = req.body;

    if (!name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Please provide a template name.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/note-templates");
    }

    await pool.query(
      `INSERT INTO note_templates (name, category, description, content, created_by)
       VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4, $5);`,
      [name.trim(), category || null, description || null, content || "", req.session.user?.id || null]
    );

    req.flash("flashMessage", "✅ Template created.");
    req.flash("flashType", "success");
    res.redirect("/settings/note-templates");
  } catch (err) {
    console.error("❌ Error adding template:", err);
    req.flash("flashMessage", "❌ Failed to create template.");
    req.flash("flashType", "error");
    res.redirect("/settings/note-templates");
  }
});

// EDIT
router.post("/note-templates/edit", async (req, res) => {
  try {
    const { id, name, category, description, content } = req.body;

    if (!id || !name || !name.trim()) {
      req.flash("flashMessage", "⚠️ Invalid template data.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/note-templates");
    }

    await pool.query(
      `UPDATE note_templates
          SET name = $1,
              category = NULLIF($2,''),
              description = NULLIF($3,''),
              content = $4,
              updated_at = NOW()
        WHERE id = $5;`,
      [name.trim(), category || null, description || null, content || "", id]
    );

    req.flash("flashMessage", "✅ Template updated.");
    req.flash("flashType", "success");
    res.redirect("/settings/note-templates");
  } catch (err) {
    console.error("❌ Error editing template:", err);
    req.flash("flashMessage", "❌ Failed to update template.");
    req.flash("flashType", "error");
    res.redirect("/settings/note-templates");
  }
});

// DELETE
router.post("/note-templates/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      req.flash("flashMessage", "⚠️ Missing template ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/note-templates");
    }

    await pool.query("DELETE FROM note_templates WHERE id = $1;", [id]);

    req.flash("flashMessage", "🗑️ Template deleted.");
    req.flash("flashType", "success");
    res.redirect("/settings/note-templates");
  } catch (err) {
    console.error("❌ Error deleting template:", err);
    req.flash("flashMessage", "❌ Failed to delete template.");
    req.flash("flashType", "error");
    res.redirect("/settings/note-templates");
  }
});

router.get("/note-templates/api/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid template id." });
  }
  try {
    const {
      rows,
    } = await pool.query(
      `SELECT id, name, category, description, content
         FROM note_templates
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Template not found." });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("Error loading note template:", err);
    res.status(500).json({ success: false, error: "Failed to load template." });
  }
});
// 🔹 Menus (✅ this is the fix)
router.use("/proposal-terms", require("./settings/proposal-terms"));
router.use("/menus", require("./settings/menus"));

// 🔹 Menus Builder (optional extended UI)
//router.use("/menus-builder", require("./settings/menus-builder"));

// Redirect any /settings/menus-builder[...] to /settings/menus
router.use('/menus-builder', (req, res) => {
  return res.redirect(301, '/settings/menus');
});



module.exports = router;

router.get("/calendar", ensurePrivileged, async (req, res) => {
  try {
    const {
      rows,
    } = await pool.query(`SELECT day_slot_minutes FROM calendar_settings LIMIT 1`);
    const daySlotMinutes = rows[0]?.day_slot_minutes || DEFAULT_CALENDAR_SLOT;
    res.render("settings/calendar", {
      layout: "layouts/settings",
      title: "Settings - Calendar Options",
      pageType: "settings",
      activeTab: "calendar-settings",
      daySlotMinutes,
      slotOptions: CALENDAR_SLOT_OPTIONS,
    });
  } catch (err) {
    console.error("[Settings] Calendar options failed:", err);
    req.flash("flashMessage", "Failed to load calendar settings.");
    req.flash("flashType", "error");
    res.redirect("/settings/overview");
  }
});

/* =========================================================
   🍽️ RESTAURANT SETTINGS CRUD
========================================================= */
router.post("/restaurant/services/add", ensurePrivileged, async (req, res) => {
  try {
    const {
      name,
      day_of_week,
      start_time,
      end_time,
      slot_minutes,
      turn_minutes,
      max_covers_per_slot,
      max_online_covers,
      active,
    } = req.body;

    if (!name?.trim() || !start_time || !end_time) {
      req.flash("flashMessage", "⚠️ Service name, start, and end time are required.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }

    const day = parseInt(day_of_week, 10);
    if (Number.isNaN(day) || day < 0 || day > 6) {
      req.flash("flashMessage", "⚠️ Invalid day of week.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }

    const slot = parseOptionalInteger(slot_minutes) || DEFAULT_SERVICE_SLOT;
    const turn = parseOptionalInteger(turn_minutes) || DEFAULT_SERVICE_TURN;
    const maxCovers = parseOptionalInteger(max_covers_per_slot);
    const maxOnline = parseOptionalInteger(max_online_covers);

    await pool.query(
      `
      INSERT INTO restaurant_services
        (name, day_of_week, start_time, end_time, slot_minutes, turn_minutes, max_covers_per_slot, max_online_covers, active,
         special_menu_label, special_menu_price, special_menu_start, special_menu_end, special_menu_only)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
      `,
      [
        name.trim(),
        day,
        start_time,
        end_time,
        slot,
        turn,
        maxCovers,
        maxOnline,
        parseBooleanField(active),
        req.body.special_menu_label?.trim() || null,
        req.body.special_menu_price ? parseFloat(req.body.special_menu_price) : null,
        req.body.special_menu_start || null,
        req.body.special_menu_end || null,
        parseBooleanField(req.body.special_menu_only),
      ]
    );

    req.flash("flashMessage", "✅ Service added.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error adding restaurant service:", err);
    req.flash("flashMessage", "❌ Failed to add service.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/services/edit", ensurePrivileged, async (req, res) => {
  try {
    const {
      id,
      name,
      day_of_week,
      start_time,
      end_time,
      slot_minutes,
      turn_minutes,
      max_covers_per_slot,
      max_online_covers,
      active,
    } = req.body;

    if (!id || !name?.trim() || !start_time || !end_time) {
      req.flash("flashMessage", "⚠️ Missing service details.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }

    const day = parseInt(day_of_week, 10);
    if (Number.isNaN(day) || day < 0 || day > 6) {
      req.flash("flashMessage", "⚠️ Invalid day of week.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }

    const slot = parseOptionalInteger(slot_minutes) || DEFAULT_SERVICE_SLOT;
    const turn = parseOptionalInteger(turn_minutes) || DEFAULT_SERVICE_TURN;

    await pool.query(
      `
      UPDATE restaurant_services
         SET name = $1,
             day_of_week = $2,
             start_time = $3,
             end_time = $4,
             slot_minutes = $5,
             turn_minutes = $6,
             max_covers_per_slot = $7,
             max_online_covers = $8,
             active = $9,
             special_menu_label = $10,
             special_menu_price = $11,
             special_menu_start = $12,
             special_menu_end = $13,
             special_menu_only = $14,
             updated_at = NOW()
       WHERE id = $15;
      `,
      [
        name.trim(),
        day,
        start_time,
        end_time,
        slot,
        turn,
        parseOptionalInteger(max_covers_per_slot),
        parseOptionalInteger(max_online_covers),
        parseBooleanField(active),
        req.body.special_menu_label?.trim() || null,
        req.body.special_menu_price ? parseFloat(req.body.special_menu_price) : null,
        req.body.special_menu_start || null,
        req.body.special_menu_end || null,
        parseBooleanField(req.body.special_menu_only),
        id,
      ]
    );

    req.flash("flashMessage", "✅ Service updated.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error updating restaurant service:", err);
    req.flash("flashMessage", "❌ Failed to update service.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/services/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      req.flash("flashMessage", "⚠️ Missing service ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query("DELETE FROM restaurant_services WHERE id = $1;", [id]);
    req.flash("flashMessage", "🗑️ Service deleted.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error deleting restaurant service:", err);
    req.flash("flashMessage", "❌ Failed to delete service.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/zones/add", ensurePrivileged, async (req, res) => {
  try {
    const { name, max_covers_per_slot, notes } = req.body;
    if (!name?.trim()) {
      req.flash("flashMessage", "⚠️ Zone name is required.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query(
      `
      INSERT INTO restaurant_zones (name, max_covers_per_slot, notes)
      VALUES ($1, $2, $3);
      `,
      [name.trim(), parseOptionalInteger(max_covers_per_slot), notes?.trim() || null]
    );
    req.flash("flashMessage", "✅ Zone added.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error adding zone:", err);
    req.flash("flashMessage", "❌ Failed to add zone.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/zones/edit", ensurePrivileged, async (req, res) => {
  try {
    const { id, name, max_covers_per_slot, notes } = req.body;
    if (!id || !name?.trim()) {
      req.flash("flashMessage", "⚠️ Missing zone details.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query(
      `
      UPDATE restaurant_zones
         SET name = $1,
             max_covers_per_slot = $2,
             notes = $3
       WHERE id = $4;
      `,
      [name.trim(), parseOptionalInteger(max_covers_per_slot), notes?.trim() || null, id]
    );
    req.flash("flashMessage", "✅ Zone updated.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error updating zone:", err);
    req.flash("flashMessage", "❌ Failed to update zone.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/zones/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      req.flash("flashMessage", "⚠️ Missing zone ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query("DELETE FROM restaurant_zones WHERE id = $1;", [id]);
    req.flash("flashMessage", "🗑️ Zone deleted.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error deleting zone:", err);
    req.flash("flashMessage", "❌ Failed to delete zone.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/tables/add", ensurePrivileged, async (req, res) => {
  try {
    const { label, zone_id, seats, can_join, active } = req.body;
    if (!label?.trim() || !seats) {
      req.flash("flashMessage", "⚠️ Table label and seats are required.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    const seatsInt = parseInt(seats, 10);
    if (Number.isNaN(seatsInt) || seatsInt <= 0) {
      req.flash("flashMessage", "⚠️ Seats must be a positive number.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query(
      `
      INSERT INTO restaurant_tables (zone_id, label, seats, can_join, active)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [parseOptionalInteger(zone_id), label.trim(), seatsInt, parseBooleanField(can_join), parseBooleanField(active)]
    );
    req.flash("flashMessage", "✅ Table added.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error adding table:", err);
    req.flash("flashMessage", "❌ Failed to add table.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/tables/edit", ensurePrivileged, async (req, res) => {
  try {
    const { id, label, zone_id, seats, can_join, active } = req.body;
    if (!id || !label?.trim() || !seats) {
      req.flash("flashMessage", "⚠️ Missing table details.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    const seatsInt = parseInt(seats, 10);
    if (Number.isNaN(seatsInt) || seatsInt <= 0) {
      req.flash("flashMessage", "⚠️ Seats must be a positive number.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query(
      `
      UPDATE restaurant_tables
         SET zone_id = $1,
             label = $2,
             seats = $3,
             can_join = $4,
             active = $5
       WHERE id = $6;
      `,
      [parseOptionalInteger(zone_id), label.trim(), seatsInt, parseBooleanField(can_join), parseBooleanField(active), id]
    );
    req.flash("flashMessage", "✅ Table updated.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error updating table:", err);
    req.flash("flashMessage", "❌ Failed to update table.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/tables/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      req.flash("flashMessage", "⚠️ Missing table ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query("DELETE FROM restaurant_tables WHERE id = $1;", [id]);
    req.flash("flashMessage", "🗑️ Table removed.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error deleting table:", err);
    req.flash("flashMessage", "❌ Failed to delete table.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/overrides/add", ensurePrivileged, async (req, res) => {
  try {
    const { service_id, override_date, max_covers_per_slot, slot_minutes, notes } = req.body;
    const serviceId = parseInt(service_id, 10);
    if (!serviceId || !override_date) {
      req.flash("flashMessage", "⚠️ Override needs a service and date.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query(
      `
      INSERT INTO restaurant_capacity_overrides
        (service_id, override_date, max_covers_per_slot, slot_minutes, notes)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [serviceId, override_date, parseOptionalInteger(max_covers_per_slot), parseOptionalInteger(slot_minutes), notes?.trim() || null]
    );
    req.flash("flashMessage", "✅ Override added.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error adding override:", err);
    req.flash("flashMessage", "❌ Failed to add override.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/overrides/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      req.flash("flashMessage", "⚠️ Missing override ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query("DELETE FROM restaurant_capacity_overrides WHERE id = $1;", [id]);
    req.flash("flashMessage", "🗑️ Override removed.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error deleting override:", err);
    req.flash("flashMessage", "❌ Failed to delete override.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/blackouts/add", ensurePrivileged, async (req, res) => {
  try {
    const { start_at, end_at, reason, applies_to } = req.body;
    if (!start_at || !end_at) {
      req.flash("flashMessage", "⚠️ Blackout requires start and end times.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query(
      `
      INSERT INTO restaurant_blackouts (start_at, end_at, reason, applies_to)
      VALUES ($1, $2, $3, $4);
      `,
      [start_at, end_at, reason?.trim() || null, applies_to?.trim() || "all"]
    );
    req.flash("flashMessage", "✅ Blackout created.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error adding blackout:", err);
    req.flash("flashMessage", "❌ Failed to add blackout.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

router.post("/restaurant/blackouts/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      req.flash("flashMessage", "⚠️ Missing blackout ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/restaurant");
    }
    await pool.query("DELETE FROM restaurant_blackouts WHERE id = $1;", [id]);
    req.flash("flashMessage", "🗑️ Blackout removed.");
    req.flash("flashType", "success");
    res.redirect("/settings/restaurant");
  } catch (err) {
    console.error("❌ Error deleting blackout:", err);
    req.flash("flashMessage", "❌ Failed to delete blackout.");
    req.flash("flashType", "error");
    res.redirect("/settings/restaurant");
  }
});

/* =========================================================
   🍽️ RESTAURANT BOOKING SETTINGS
========================================================= */
router.get("/restaurant", ensurePrivileged, async (req, res) => {
  try {
    const [servicesRes, zonesRes, tablesRes, overridesRes, blackoutsRes] = await Promise.all([
      pool.query(`
        SELECT id, name, day_of_week, start_time, end_time, slot_minutes, turn_minutes,
               max_covers_per_slot, max_online_covers, active, created_at, updated_at,
               special_menu_label, special_menu_price, special_menu_start, special_menu_end, special_menu_only
          FROM restaurant_services
         ORDER BY day_of_week, start_time;
      `),
      pool.query(`
        SELECT id, name, max_covers_per_slot, notes, created_at
          FROM restaurant_zones
         ORDER BY name ASC;
      `),
      pool.query(`
        SELECT t.id,
               t.zone_id,
               z.name AS zone_name,
               t.label,
               t.seats,
               t.can_join,
               t.active,
               t.created_at
          FROM restaurant_tables t
          LEFT JOIN restaurant_zones z ON z.id = t.zone_id
         ORDER BY z.name NULLS LAST, t.label ASC;
      `),
      pool.query(`
        SELECT o.id,
               o.service_id,
               s.name AS service_name,
               o.override_date,
               o.max_covers_per_slot,
               o.slot_minutes,
               o.notes,
               o.created_at
          FROM restaurant_capacity_overrides o
          LEFT JOIN restaurant_services s ON s.id = o.service_id
         ORDER BY o.override_date DESC;
      `),
      pool.query(`
        SELECT id, start_at, end_at, reason, applies_to, created_at
          FROM restaurant_blackouts
         ORDER BY start_at DESC;
      `),
    ]);

    res.render("settings/restaurant", {
      layout: "layouts/settings",
      title: "Settings — Restaurant Booking",
      pageType: "settings",
      activeTab: "restaurant",
      user: req.session.user || null,
      services: servicesRes.rows,
      zones: zonesRes.rows,
      tables: tablesRes.rows,
      overrides: overridesRes.rows,
      blackouts: blackoutsRes.rows,
    });
  } catch (err) {
    console.error("❌ Error loading restaurant settings:", err);
    req.flash("flashMessage", "❌ Failed to load restaurant settings.");
    req.flash("flashType", "error");
    res.redirect("/settings");
  }
});

router.post("/calendar", ensurePrivileged, async (req, res) => {
  try {
    const input = Number(req.body?.day_slot_minutes);
    const minutes = CALENDAR_SLOT_OPTIONS.includes(input) ? input : null;
    if (!minutes) {
      req.flash("flashMessage", "Please choose a valid slot interval.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/calendar");
    }
    await pool.query(
      `INSERT INTO calendar_settings (id, day_slot_minutes, created_at, updated_at)
       VALUES (1, $1, NOW(), NOW())
       ON CONFLICT (id)
       DO UPDATE SET day_slot_minutes = EXCLUDED.day_slot_minutes, updated_at = NOW();`,
      [minutes]
    );
    req.flash("flashMessage", "Calendar settings updated.");
    req.flash("flashType", "success");
    res.redirect("/settings/calendar");
  } catch (err) {
    console.error("[Settings] Calendar update failed:", err);
    req.flash("flashMessage", "Failed to update calendar settings.");
    req.flash("flashType", "error");
    res.redirect("/settings/calendar");
  }
});

/* =========================================================
   🎤 ENTERTAINMENT EVENTS SETTINGS
========================================================= */
router.get("/entertainment", ensurePrivileged, async (req, res) => {
  try {
    await ensureEntertainmentColorColumn();
    const eventsRes = await pool.query(
      `
      WITH series_colors AS (
        SELECT DISTINCT ON (series_id) series_id, event_color AS series_color
          FROM entertainment_events
         WHERE series_id IS NOT NULL
           AND event_color IS NOT NULL
         ORDER BY series_id, series_order ASC NULLS LAST, start_at ASC
      )
      SELECT e.*,
             COALESCE(e.event_color, sc.series_color) AS effective_event_color,
             uc.name AS created_by_name,
             uu.name AS updated_by_name,
             r.name AS room_name,
             COALESCE(
               json_agg(
                 json_build_object('id', a.id, 'name', a.name)
                 ORDER BY a.name
               ) FILTER (WHERE a.id IS NOT NULL),
               '[]'
             ) AS acts
        FROM entertainment_events e
        LEFT JOIN series_colors sc ON sc.series_id = e.series_id
        LEFT JOIN users uc ON uc.id = e.created_by
        LEFT JOIN users uu ON uu.id = e.updated_by
        LEFT JOIN entertainment_event_acts ea ON ea.event_id = e.id
        LEFT JOIN entertainment_acts a ON a.id = ea.act_id
        LEFT JOIN rooms r ON r.id = e.room_id
       WHERE e.start_at IS NULL
          OR (e.start_at AT TIME ZONE 'Pacific/Auckland')::date >= (NOW() AT TIME ZONE 'Pacific/Auckland')::date
       GROUP BY e.id, sc.series_color, uc.name, uu.name, r.name
       ORDER BY e.start_at ASC NULLS LAST;
      `
    );
    const mediaTargetRaw = (req.query.media_target || "").toLowerCase();
    const mediaTarget = ["add", "edit"].includes(mediaTargetRaw) ? mediaTargetRaw : "";
    const mediaEventId = parseOptionalInteger(req.query.media_event_id);
    const mediaImageUrl = typeof req.query.media_image_url === "string" ? req.query.media_image_url : "";
    const actsRes = await pool.query(
      `SELECT id, name, external_url FROM entertainment_acts ORDER BY name ASC;`
    );
    const roomsRes = await pool.query(
      `SELECT id, name FROM rooms ORDER BY name ASC;`
    );
    const feedbackSettings = await getFeedbackSettings();
    const prefillEntertainment = {
      title: req.query.title || "",
      start_date: req.query.prefill_date || req.query.start_date || "",
      start_time: req.query.prefill_time || req.query.start_time || "",
    };
    res.render("settings/entertainment", {
      layout: "layouts/settings",
      title: "Settings — Entertainment",
      pageType: "settings",
      activeTab: "entertainment",
      events: eventsRes.rows,
      acts: actsRes.rows,
      rooms: roomsRes.rows,
      mediaSelection: {
        target: mediaTarget,
        eventId: mediaEventId,
        imageUrl: mediaImageUrl,
      },
      user: req.session.user || null,
      prefillEntertainment,
      showEntertainmentHeader: feedbackSettings.show_entertainment_header,
      flashMessage: req.flash?.("flashMessage"),
      flashType: req.flash?.("flashType"),
    });
  } catch (err) {
    console.error("❌ Error loading entertainment events:", err);
    req.flash("flashMessage", "❌ Failed to load entertainment events.");
    req.flash("flashType", "error");
    res.redirect("/settings");
  }
});

router.post("/users/invite", ensurePrivileged, async (req, res) => {
  try {
    const userId = parseOptionalInteger(req.body.user_id);
    if (!userId) {
      req.flash("flashMessage", "Missing user ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/users");
    }
    const { rows } = await pool.query(`SELECT id, name, email FROM users WHERE id = $1 LIMIT 1;`, [
      userId,
    ]);
    const user = rows[0];
    if (!user) {
      req.flash("flashMessage", "User not found.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/users");
    }
    await ensureUserInvitesTable();
    const token = await createUserInvite(user.id, req.session.user?.id);
    await sendUserInviteEmail({
      toEmail: user.email,
      toName: user.name,
      inviteToken: token,
      baseUrl: getAppBaseUrl(req),
    });
    req.flash("flashMessage", "Invite sent.");
    req.flash("flashType", "success");
  } catch (err) {
    console.error("? Error sending invite:", err);
    req.flash("flashMessage", "Failed to send invite.");
    req.flash("flashType", "error");
  }
  res.redirect("/settings/users");
});

router.post("/entertainment/header", ensurePrivileged, async (req, res) => {
  try {
    const settings = await getFeedbackSettings();
    const showHeader = parseBooleanField(req.body.show_entertainment_header);
    await pool.query(
      `
      UPDATE feedback_settings
         SET show_entertainment_header = $1,
             updated_at = NOW()
       WHERE id = $2;
      `,
      [showHeader, settings.id]
    );
    req.flash("flashMessage", "Entertainment header updated.");
    req.flash("flashType", "success");
  } catch (err) {
    console.error("? Error updating entertainment header toggle:", err);
    req.flash("flashMessage", "Failed to update entertainment header.");
    req.flash("flashType", "error");
  }
  res.redirect("/settings/entertainment");
});

async function loadRecurrence(seriesId) {
  if (!seriesId) return null;
  const { rows } = await pool.query(
    `
    SELECT id, frequency, interval, weekdays, monthly_day, monthly_week, start_date, end_date
      FROM calendar_series
     WHERE id = $1
     LIMIT 1;
    `,
    [seriesId]
  );
  const series = rows[0];
  if (!series) return null;
  const { rows: skipRows } = await pool.query(
    `SELECT exception_date FROM calendar_series_exceptions WHERE series_id = $1;`,
    [seriesId]
  );
  return {
    frequency: series.frequency,
    interval: series.interval,
    endDate: series.end_date,
    weekdays: series.weekdays || [],
    monthlyDay: series.monthly_day,
    monthlyWeek: series.monthly_week,
    skipDates: skipRows.map((r) => r.exception_date),
  };
}

router.get("/entertainment/:id/json", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `
      WITH series_colors AS (
        SELECT DISTINCT ON (series_id) series_id, event_color AS series_color
          FROM entertainment_events
         WHERE series_id IS NOT NULL
           AND event_color IS NOT NULL
         ORDER BY series_id, series_order ASC NULLS LAST, start_at ASC
      )
      SELECT e.*,
             COALESCE(e.event_color, sc.series_color) AS effective_event_color,
             COALESCE(
               json_agg(
                 json_build_object('id', a.id, 'name', a.name)
                 ORDER BY a.name
               ) FILTER (WHERE a.id IS NOT NULL),
               '[]'
             ) AS acts
        FROM entertainment_events e
        LEFT JOIN series_colors sc ON sc.series_id = e.series_id
        LEFT JOIN entertainment_event_acts ea ON ea.event_id = e.id
        LEFT JOIN entertainment_acts a ON a.id = ea.act_id
       WHERE e.id = $1
       GROUP BY e.id, sc.series_color
       LIMIT 1;
      `,
      [id]
    );
    const event = rows[0];
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    const recurrence = event.series_id ? await loadRecurrence(event.series_id) : null;
    return res.json({ success: true, event, recurrence });
  } catch (err) {
    console.error("? Error loading entertainment event JSON:", err);
    res.status(500).json({ success: false, message: "Failed to load event" });
  }
});

router.get("/entertainment/media", ensurePrivileged, async (req, res) => {
  try {
    const mediaItems = await loadEntertainmentMediaItems();
    const mediaTargetRaw = (req.query.target || "").toLowerCase();
    const mediaTarget = ["add", "edit"].includes(mediaTargetRaw) ? mediaTargetRaw : "";
    const mediaEventId = parseOptionalInteger(req.query.event_id);
    res.render("settings/entertainment-media", {
      layout: "layouts/settings",
      title: "Settings - Entertainment Media",
      pageType: "settings",
      activeTab: "entertainment-media",
      mediaItems,
      mediaTarget,
      mediaEventId,
      user: req.session.user || null,
      flashMessage: req.flash?.("flashMessage"),
      flashType: req.flash?.("flashType"),
    });
  } catch (err) {
    console.error("[Settings] Failed to load entertainment media:", err);
    req.flash("flashMessage", "Failed to load media library.");
    req.flash("flashType", "error");
    res.redirect("/settings/entertainment");
  }
});

router.get("/entertainment/embeds", ensurePrivileged, async (req, res) => {
  try {
    res.render("settings/entertainment-embeds", {
      layout: "layouts/settings",
      title: "Settings - Entertainment Embeds",
      pageType: "settings",
      activeTab: "entertainment-embeds",
      user: req.session.user || null,
      flashMessage: req.flash?.("flashMessage"),
      flashType: req.flash?.("flashType"),
    });
  } catch (err) {
    console.error("[Settings] Failed to load entertainment embeds:", err);
    req.flash("flashMessage", "Failed to load embed links.");
    req.flash("flashType", "error");
    res.redirect("/settings/entertainment");
  }
});

router.post(
  "/entertainment/add",
  ensurePrivileged,
  entertainmentImageUpload.single("image_file"),
  async (req, res) => {
  let client;
  try {
    const {
      title,
      start_date,
      start_time,
      end_date,
      end_time,
      adjunct_name,
      external_url,
      organiser,
      room_id,
      price,
      description,
      image_url,
      status,
      display_type,
      event_color,
    } = req.body;

    if (!title?.trim() || !start_date || !start_time) {
      req.flash("flashMessage", "⚠️ Title, date, and time are required.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }

    const startAt = combineDateAndTime(start_date, start_time);
    const endAt = end_date && end_time ? combineDateAndTime(end_date, end_time) : null;
    const slug = `${slugify(title) || "event"}-${Date.now()}`;
    const statusValue = (status || "draft").toLowerCase();
    const userId = req.session.user?.id || null;
    const acts = parseIdArray(req.body.acts);
    const imagePath = req.file ? `/uploads/entertainment/${req.file.filename}` : req.body.image_url || null;
    const displayTypeValue = display_type === "regularevents" ? "regularevents" : "entertainment";
    const eventColorValue = normalizeHexColor(event_color);
    const roomId = parseOptionalInteger(room_id);

    const recurrence = recurrenceService.parseRecurrenceForm(req.body);
    client = await pool.connect();
    await ensureEntertainmentColorColumn();
    await client.query("BEGIN");
    const insert = await client.query(
      `
      INSERT INTO entertainment_events
        (title, slug, adjunct_name, external_url, organiser, room_id, display_type, event_color, price, description,
         image_url, start_at, end_at, status, series_id, series_order,
         created_by, updated_by, created_at, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,NULL,$15,$16,NOW(),NOW())
      RETURNING *;
      `,
      [
        title.trim(),
        slug,
        adjunct_name || null,
        external_url || null,
        organiser || null,
        roomId,
        displayTypeValue,
        eventColorValue,
        price || null,
        description || null,
        imagePath,
        startAt,
        endAt,
        statusValue,
        userId,
        userId,
      ]
    );

    const insertedEvent = insert.rows[0];
    if (insertedEvent?.id) {
      await syncEntertainmentEventActs(insertedEvent.id, acts, client);
    }

    if (recurrence && start_date) {
      const series = await recurrenceService.createSeriesRecord(client, {
        entityType: "entertainment",
        template: {
          title: title.trim(),
          start_time,
          end_time,
        },
        startDate: start_date,
        recurrence,
        createdBy: userId,
      });
      if (series?.seriesId && insertedEvent?.id) {
        await client.query(
          `UPDATE entertainment_events SET series_id = $1, series_order = 1 WHERE id = $2;`,
          [series.seriesId, insertedEvent.id]
        );
        let order = 2;
        for (const date of series.occurrenceDates.slice(1)) {
          const cloneSlug = `${slugify(title) || "event"}-${Date.now()}-${order}`;
          const cloneStart = combineDateAndTime(date, start_time);
          const cloneEnd = end_time ? combineDateAndTime(date, end_time) : null;
          const cloneInsert = await client.query(
            `
            INSERT INTO entertainment_events
              (title, slug, adjunct_name, external_url, organiser, room_id, display_type, event_color, price, description,
               image_url, start_at, end_at, status, series_id, series_order,
               created_by, updated_by, created_at, updated_at)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
            RETURNING id;
            `,
            [
              title.trim(),
              cloneSlug,
              adjunct_name || null,
              external_url || null,
              organiser || null,
              roomId,
              displayTypeValue,
              eventColorValue,
              price || null,
              description || null,
              imagePath,
              cloneStart,
              cloneEnd,
              statusValue,
              series.seriesId,
              order,
              userId,
              userId,
            ]
          );
          const cloneId = cloneInsert.rows[0]?.id;
          if (cloneId) {
            await syncEntertainmentEventActs(cloneId, acts, client);
          }
          order += 1;
        }
      }
    }

    await client.query("COMMIT");
    req.flash("flashMessage", "✅ Entertainment event added.");
    req.flash("flashType", "success");
    res.redirect("/settings/entertainment");
  } catch (err) {
    console.error("❌ Error adding entertainment event:", err);
    try {
      if (client) await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("❌ Failed rolling back entertainment insert:", rollbackErr);
    }
    req.flash("flashMessage", "❌ Failed to add entertainment event.");
    req.flash("flashType", "error");
    res.redirect("/settings/entertainment");
  } finally {
    if (client) client.release();
  }
  }
);

router.post(
  "/entertainment/edit",
  ensurePrivileged,
  entertainmentImageUpload.single("image_file"),
  async (req, res) => {
    let client;
    try {
      await ensureEntertainmentColorColumn();
      const {
        id,
        title,
        start_date,
        start_time,
        end_date,
        end_time,
        adjunct_name,
        external_url,
        organiser,
        room_id,
      price,
      description,
      image_url,
      status,
      display_type,
      event_color,
      recurrence_frequency,
      recurrence_interval,
      recurrence_end_date,
      recurrence_weekdays,
      recurrence_monthly_day,
      recurrence_monthly_week,
      recurrence_skip_dates,
      series_scope,
    } = req.body;

      if (!id || !title?.trim()) {
        req.flash("flashMessage", "⚠️ Missing event details.");
        req.flash("flashType", "warning");
        return res.redirect("/settings/entertainment");
      }

      const startTimeClean = typeof start_time === "string" ? start_time.trim() : "";
      const endTimeClean = typeof end_time === "string" ? end_time.trim() : "";
    const statusValue = (status || "draft").toLowerCase();
    const userId = req.session.user?.id || null;
    const acts = parseIdArray(req.body.acts);
    const imagePath = req.file ? `/uploads/entertainment/${req.file.filename}` : image_url || null;
    const roomId = parseOptionalInteger(room_id);
    const displayTypeValue = display_type === "regularevents" ? "regularevents" : "entertainment";
    const eventColorValue = normalizeHexColor(event_color);
    const scopeRaw = (series_scope || "").toLowerCase();
    const recurrence = recurrenceService.parseRecurrenceForm({
      recurrence_frequency,
      recurrence_interval,
      recurrence_end_date,
      recurrence_weekdays,
      recurrence_monthly_day,
      recurrence_monthly_week,
      recurrence_skip_dates,
    });

      const startAtSingle = start_date && startTimeClean ? combineDateAndTime(start_date, startTimeClean) : null;
      const endAtSingle = end_date && endTimeClean ? combineDateAndTime(end_date, endTimeClean) : null;

      const updateOne = async (db, eventId, startAtValue, endAtValue) => {
        await db.query(
          `
          UPDATE entertainment_events
             SET title = $1,
                 adjunct_name = $2,
                 external_url = $3,
                 organiser = $4,
                 room_id = $5,
                 event_color = COALESCE($6, event_color),
                 price = $7,
                 description = $8,
                 display_type = $9,
                 image_url = $10,
                 start_at = COALESCE($11, start_at),
                 end_at = $12,
                 status = $13,
                 updated_by = $14,
                 updated_at = NOW()
           WHERE id = $15;
          `,
          [
            title.trim(),
            adjunct_name || null,
            external_url || null,
            organiser || null,
            roomId,
            eventColorValue,
            price || null,
            description || null,
            displayTypeValue,
            imagePath,
            startAtValue,
            endAtValue,
            statusValue,
            userId,
            eventId,
          ]
        );
        await syncEntertainmentEventActs(eventId, acts, db);
      };

      client = await pool.connect();
      await client.query("BEGIN");

      const { rows: currentRows } = await client.query(
        `SELECT id, series_id, series_order, start_at, end_at FROM entertainment_events WHERE id = $1 LIMIT 1;`,
        [id]
      );
      const current = currentRows[0];
      if (!current) throw new Error("Event not found");

      const hasSeries = current.series_id !== null && current.series_id !== undefined;

      if (recurrence && !hasSeries) {
        const baseDate = start_date ? String(start_date).trim() : formatDateOnlyNz(startAtSingle || current.start_at);
        if (!baseDate) throw new Error("Start date required for recurrence.");
        const baseStart = startTimeClean ? combineDateAndTime(baseDate, startTimeClean) : current.start_at;
        let baseEnd = endAtSingle;
        if (endTimeClean === "" || endAtSingle === null) {
          baseEnd = null;
        } else if (!baseEnd && current.end_at) {
          baseEnd = current.end_at;
        }

        const series = await recurrenceService.createSeriesRecord(client, {
          entityType: "entertainment",
          template: { title: title.trim(), start_time: startTimeClean, end_time: endTimeClean || null },
          startDate: baseDate,
          recurrence,
          createdBy: userId,
          updatedBy: userId,
        });
        if (!series?.seriesId) throw new Error("Failed to create series.");

        await client.query(
          `
          UPDATE entertainment_events
             SET title = $1,
                 adjunct_name = $2,
                 external_url = $3,
                 organiser = $4,
                 room_id = $5,
                 event_color = COALESCE($6, event_color),
                 price = $7,
                 description = $8,
                 display_type = $9,
                 image_url = $10,
                 start_at = COALESCE($11, start_at),
                 end_at = $12,
                 status = $13,
                 updated_by = $14,
                 updated_at = NOW(),
                 series_id = $15,
                 series_order = 1
           WHERE id = $16;
          `,
          [
            title.trim(),
            adjunct_name || null,
            external_url || null,
            organiser || null,
            roomId,
            eventColorValue,
            price || null,
            description || null,
            displayTypeValue,
            imagePath,
            baseStart,
            baseEnd,
            statusValue,
            userId,
            series.seriesId,
            id,
          ]
        );
        await syncEntertainmentEventActs(id, acts, client);

        let order = 2;
        for (const date of series.occurrenceDates.slice(1)) {
          const cloneSlug = `${slugify(title) || "event"}-${Date.now()}-${order}`;
          const cloneStart = startTimeClean ? combineDateAndTime(date, startTimeClean) : null;
          const cloneEnd = endTimeClean ? combineDateAndTime(date, endTimeClean) : null;
          const {
            rows: cloneRows,
          } = await client.query(
            `
            INSERT INTO entertainment_events
              (title, slug, adjunct_name, external_url, organiser, room_id, display_type, event_color, price, description,
               image_url, start_at, end_at, status, series_id, series_order,
               created_by, updated_by, created_at, updated_at)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
            RETURNING id;
            `,
            [
              title.trim(),
              cloneSlug,
              adjunct_name || null,
              external_url || null,
              organiser || null,
              roomId,
              displayTypeValue,
              eventColorValue,
              price || null,
              description || null,
              imagePath,
              cloneStart,
              cloneEnd,
              statusValue,
              series.seriesId,
              order,
              userId,
              userId,
            ]
          );
          const cloneId = cloneRows[0]?.id;
          if (cloneId) {
            await syncEntertainmentEventActs(cloneId, acts, client);
          }
          order += 1;
        }
      } else {
        const effectiveScope = hasSeries && ["single", "all", "future"].includes(scopeRaw) ? scopeRaw : "single";
        if (effectiveScope === "single") {
          await updateOne(client, id, startAtSingle, endAtSingle);
        } else {
        const params = effectiveScope === "future" ? [current.series_id, current.series_order] : [current.series_id];
        const whereClause = effectiveScope === "future" ? "AND series_order >= $2" : "";
        const { rows: seriesEvents } = await client.query(
          `
          SELECT id, start_at, end_at, series_order
            FROM entertainment_events
           WHERE series_id = $1 ${whereClause}
           ORDER BY series_order ASC;
          `,
          params
        );

        const newDateIsoInput = start_date ? String(start_date).trim() : null;
        let dateShiftDays = 0;
        if (newDateIsoInput) {
          const currentDateIso = formatDateOnlyNz(current.start_at);
          if (currentDateIso) {
            const startD = new Date(`${currentDateIso}T00:00:00Z`);
            const newD = new Date(`${newDateIsoInput}T00:00:00Z`);
            if (!Number.isNaN(startD.getTime()) && !Number.isNaN(newD.getTime())) {
              const diffMs = newD.getTime() - startD.getTime();
              dateShiftDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
            }
          }
        }

        for (const ev of seriesEvents) {
          const existingDateIso = formatDateOnlyNz(ev.start_at);
          const targetDateIso = newDateIsoInput
            ? addDaysIso(existingDateIso || newDateIsoInput, dateShiftDays)
            : existingDateIso;
          const startValue =
            startTimeClean && targetDateIso
              ? combineDateAndTime(targetDateIso, startTimeClean)
              : ev.start_at;
          let endValue = ev.end_at;
          if (endTimeClean === "") {
            endValue = null;
          } else if (endTimeClean && targetDateIso) {
            endValue = combineDateAndTime(targetDateIso, endTimeClean);
          }
          await updateOne(client, ev.id, startValue, endValue);
        }
        }
      }

      await client.query("COMMIT");
      req.flash("flashMessage", "Entertainment event updated.");
      req.flash("flashType", "success");
      res.redirect("/settings/entertainment");
    } catch (err) {
      console.error("❌ Error updating entertainment event:", err);
      try {
        if (client) await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("❌ Failed to rollback entertainment update:", rollbackErr);
      }
      req.flash("flashMessage", "❌ Failed to update entertainment event.");
      req.flash("flashType", "error");
      res.redirect("/settings/entertainment");
    } finally {
      if (client) client.release();
    }
  }
);
router.post("/entertainment/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id, series_scope } = req.body;
    if (!id) {
      req.flash("flashMessage", "⚠️ Missing event ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }

    const scope = (series_scope || "single").toLowerCase();
    const { rows } = await pool.query(
      `SELECT id, series_id, series_order FROM entertainment_events WHERE id = $1 LIMIT 1;`,
      [id]
    );
    const current = rows[0];
    if (!current) {
      req.flash("flashMessage", "⚠️ Event not found.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }

    if (current.series_id && (scope === "all" || scope === "future")) {
      const params = scope === "future" ? [current.series_id, current.series_order] : [current.series_id];
      const whereClause = scope === "future" ? "series_id = $1 AND series_order >= $2" : "series_id = $1";
      await pool.query(`DELETE FROM entertainment_events WHERE ${whereClause};`, params);
      req.flash("flashMessage", "🗑️ Series events deleted.");
      req.flash("flashType", "success");
    } else {
      await pool.query(`DELETE FROM entertainment_events WHERE id = $1;`, [id]);
      req.flash("flashMessage", "🗑️ Entertainment event deleted.");
      req.flash("flashType", "success");
    }

    res.redirect("/settings/entertainment");
  } catch (err) {
    console.error("❌ Error deleting entertainment event:", err);
    req.flash("flashMessage", "❌ Failed to delete entertainment event.");
    req.flash("flashType", "error");
    res.redirect("/settings/entertainment");
  }
});

router.post("/entertainment/media/delete", ensurePrivileged, async (req, res) => {
  try {
    const rawFile = (req.body.file || "").trim();
    if (!rawFile) {
      req.flash("flashMessage", "Missing media file.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }
    const filename = path.basename(rawFile);
    const targetPath = path.join(entertainmentUploadsDir, filename);
    if (!targetPath.startsWith(entertainmentUploadsDir)) {
      req.flash("flashMessage", "Invalid media file.");
      req.flash("flashType", "error");
      return res.redirect("/settings/entertainment");
    }
    if (!fs.existsSync(targetPath)) {
      req.flash("flashMessage", "Media file not found.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }
    const imageUrl = `/uploads/entertainment/${filename}`;
    await pool.query(`UPDATE entertainment_events SET image_url = NULL WHERE image_url = $1;`, [
      imageUrl,
    ]);
    await fs.promises.unlink(targetPath);
    req.flash("flashMessage", "Media file deleted.");
    req.flash("flashType", "success");
  } catch (err) {
    console.error("[Settings] Failed to delete media file:", err);
    req.flash("flashMessage", "Failed to delete media file.");
    req.flash("flashType", "error");
  }
  res.redirect("/settings/entertainment");
});

router.post("/entertainment/acts/add", ensurePrivileged, async (req, res) => {
  const wantsJson =
    req.xhr ||
    (req.headers.accept || "").includes("application/json") ||
    (req.headers["content-type"] || "").includes("application/json");
  try {
    const name = (req.body.name || "").trim();
    const externalUrl = req.body.external_url || null;
    if (!name) {
      if (wantsJson) return res.status(400).json({ success: false, message: "Act name is required." });
      req.flash("flashMessage", "⚠️ Act name is required.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }
    const { rows } = await pool.query(
      `
      INSERT INTO entertainment_acts (name, external_url, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (name) DO UPDATE
        SET external_url = EXCLUDED.external_url,
            updated_at = NOW()
      RETURNING id, name, external_url;
      `,
      [name, externalUrl]
    );
    if (wantsJson) {
      return res.json({ success: true, act: rows[0] });
    }
    req.flash("flashMessage", "✅ Act saved.");
    req.flash("flashType", "success");
    res.redirect("/settings/entertainment");
  } catch (err) {
    console.error("❌ Error saving act:", err);
    if (wantsJson) return res.status(500).json({ success: false, message: "Failed to save act." });
    req.flash("flashMessage", "❌ Failed to save act.");
    req.flash("flashType", "error");
    res.redirect("/settings/entertainment");
  }
});
router.post("/entertainment/acts/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      req.flash("flashMessage", "⚠️ Missing act ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }
    await pool.query(`DELETE FROM entertainment_acts WHERE id = $1;`, [id]);
    req.flash("flashMessage", "🗑️ Act deleted.");
    req.flash("flashType", "success");
    res.redirect("/settings/entertainment");
  } catch (err) {
    console.error("❌ Error deleting act:", err);
    req.flash("flashMessage", "❌ Failed to delete act.");
    req.flash("flashType", "error");
    res.redirect("/settings/entertainment");
  }
});

