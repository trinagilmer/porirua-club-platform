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
} = require("../services/feedbackService");

const CALENDAR_SLOT_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const DEFAULT_CALENDAR_SLOT = 30;
const DEFAULT_SERVICE_SLOT = 30;
const DEFAULT_SERVICE_TURN = 90;
const FEEDBACK_DELAY_MIN = 0;
const FEEDBACK_DELAY_MAX = 30;

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

function combineDateAndTime(dateValue, timeValue) {
  if (!dateValue) return null;
  const datePart = String(dateValue).trim();
  if (!timeValue) return new Date(`${datePart}T00:00:00Z`).toISOString();
  return new Date(`${datePart}T${timeValue}:00Z`).toISOString();
}

const entertainmentUploadsDir = path.join(__dirname, "..", "public", "uploads", "entertainment");
if (!fs.existsSync(entertainmentUploadsDir)) {
  fs.mkdirSync(entertainmentUploadsDir, { recursive: true });
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

/* =========================================================
   🧩 SETTINGS OVERVIEW
========================================================= */
router.get("/overview", async (req, res) => {
  try {
    const [eventTypesRes, roomsRes, templatesRes] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM club_event_types;"),
      pool.query("SELECT COUNT(*)::int AS count FROM rooms;"),
      pool.query("SELECT COUNT(*)::int AS count FROM note_templates;"),
      pool.query("SELECT COUNT(*)::int AS count FROM menus;")
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
    res.render("settings/feedback", {
      layout: "layouts/settings",
      title: "Settings — Feedback Templates",
      pageType: "settings",
      activeTab: "feedback",
      feedbackSettings,
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

router.get("/feedback/activity", ensurePrivileged, async (req, res) => {
  try {
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
    const { rows: responses } = await pool.query(
      `
      SELECT r.*,
             CASE WHEN r.entity_type = 'function' THEN f.event_name ELSE rb.party_name END AS event_name,
             CASE WHEN r.entity_type = 'function' THEN f.event_date ELSE rb.booking_date END AS event_date
        FROM feedback_responses r
        LEFT JOIN functions f ON r.entity_type = 'function' AND f.id_uuid::text = r.entity_id
        LEFT JOIN restaurant_bookings rb ON r.entity_type = 'restaurant' AND rb.id::text = r.entity_id
       ORDER BY r.updated_at DESC
       LIMIT 25;
      `
    );
    res.render("settings/feedback-activity", {
      layout: "layouts/settings",
      title: "Settings — Feedback Activity",
      pageType: "settings",
      activeTab: "feedback",
      contactStats: { optOutCount: optOutRows[0]?.count || 0 },
      statusCounts,
      responses,
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
  const emailSubject = (req.body.email_subject || DEFAULT_TEMPLATE_SUBJECT).trim();
  const emailBody = req.body.email_body_html || DEFAULT_TEMPLATE_BODY;
  const surveyHeader = req.body.survey_header_html || DEFAULT_SURVEY_HEADER;
  const eventsHeader = req.body.events_header_html || DEFAULT_EVENT_HEADER;
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
             email_subject = $5,
             email_body_html = $6,
             survey_header_html = $7,
             events_header_html = $8,
             function_question_config = $9,
             restaurant_question_config = $10,
             updated_at = NOW()
       WHERE id = $11;
      `,
      [
        autoFunctions,
        autoRestaurant,
        sendDelay,
        reminderDays,
        emailSubject,
        emailBody,
        surveyHeader,
        eventsHeader,
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
    const { rows: users } = await pool.query(
      `SELECT id, name, email, role, created_at
         FROM users
        ORDER BY name ASC;`
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
    if (!name?.trim() || !email?.trim()) {
      req.flash("flashMessage", "?? Name and email are required.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/users");
    }
    await pool.query(
      `INSERT INTO users (name, email, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role;`,
      [name.trim(), email.trim().toLowerCase(), (role || "staff").toLowerCase()]
    );
    req.flash("flashMessage", "? User stored.");
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
        (name, day_of_week, start_time, end_time, slot_minutes, turn_minutes, max_covers_per_slot, max_online_covers, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `,
      [name.trim(), day, start_time, end_time, slot, turn, maxCovers, maxOnline, parseBooleanField(active)]
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
             updated_at = NOW()
       WHERE id = $10;
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
               max_covers_per_slot, max_online_covers, active, created_at, updated_at
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
    const eventsRes = await pool.query(
      `
      SELECT e.*,
             uc.name AS created_by_name,
             uu.name AS updated_by_name,
             COALESCE(
               json_agg(
                 json_build_object('id', a.id, 'name', a.name)
                 ORDER BY a.name
               ) FILTER (WHERE a.id IS NOT NULL),
               '[]'
             ) AS acts
        FROM entertainment_events e
        LEFT JOIN users uc ON uc.id = e.created_by
        LEFT JOIN users uu ON uu.id = e.updated_by
        LEFT JOIN entertainment_event_acts ea ON ea.event_id = e.id
        LEFT JOIN entertainment_acts a ON a.id = ea.act_id
       GROUP BY e.id, uc.name, uu.name
       ORDER BY e.start_at DESC;
      `
    );
    const actsRes = await pool.query(
      `SELECT id, name, external_url FROM entertainment_acts ORDER BY name ASC;`
    );
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
      user: req.session.user || null,
      prefillEntertainment,
    });
  } catch (err) {
    console.error("❌ Error loading entertainment events:", err);
    req.flash("flashMessage", "❌ Failed to load entertainment events.");
    req.flash("flashType", "error");
    res.redirect("/settings");
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
      price,
      description,
      image_url,
      status,
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

    const recurrence = recurrenceService.parseRecurrenceForm(req.body);
    client = await pool.connect();
    await client.query("BEGIN");
    const insert = await client.query(
      `
      INSERT INTO entertainment_events
        (title, slug, adjunct_name, external_url, organiser, price, description,
         image_url, start_at, end_at, status, series_id, series_order,
         created_by, updated_by, created_at, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,$12,$13,NOW(),NOW())
      RETURNING *;
      `,
      [
        title.trim(),
        slug,
        adjunct_name || null,
        external_url || null,
        organiser || null,
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
              (title, slug, adjunct_name, external_url, organiser, price, description,
               image_url, start_at, end_at, status, series_id, series_order,
               created_by, updated_by, created_at, updated_at)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
            RETURNING id;
            `,
            [
              title.trim(),
              cloneSlug,
              adjunct_name || null,
              external_url || null,
              organiser || null,
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
  try {
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
      price,
      description,
      image_url,
      status,
    } = req.body;

    if (!id || !title?.trim()) {
      req.flash("flashMessage", "⚠️ Missing event details.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }

    const startAt = start_date && start_time ? combineDateAndTime(start_date, start_time) : null;
    const endAt = end_date && end_time ? combineDateAndTime(end_date, end_time) : null;
    const statusValue = (status || "draft").toLowerCase();
    const userId = req.session.user?.id || null;
    const acts = parseIdArray(req.body.acts);
    const imagePath = req.file ? `/uploads/entertainment/${req.file.filename}` : image_url || null;

    await pool.query(
      `
      UPDATE entertainment_events
         SET title = $1,
             adjunct_name = $2,
             external_url = $3,
             organiser = $4,
             price = $5,
             description = $6,
             image_url = $7,
             start_at = COALESCE($8, start_at),
             end_at = $9,
             status = $10,
             updated_by = $11,
             updated_at = NOW()
       WHERE id = $12;
      `,
      [
        title.trim(),
        adjunct_name || null,
        external_url || null,
        organiser || null,
        price || null,
        description || null,
        imagePath,
        startAt,
        endAt,
        statusValue,
        userId,
        id,
      ]
    );

    await syncEntertainmentEventActs(id, acts);

    req.flash("flashMessage", "✅ Entertainment event updated.");
    req.flash("flashType", "success");
    res.redirect("/settings/entertainment");
  } catch (err) {
    console.error("❌ Error updating entertainment event:", err);
    req.flash("flashMessage", "❌ Failed to update entertainment event.");
    req.flash("flashType", "error");
    res.redirect("/settings/entertainment");
  }
  }
);

router.post("/entertainment/delete", ensurePrivileged, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      req.flash("flashMessage", "⚠️ Missing event ID.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }
    await pool.query(`DELETE FROM entertainment_events WHERE id = $1;`, [id]);
    req.flash("flashMessage", "🗑️ Entertainment event deleted.");
    req.flash("flashType", "success");
    res.redirect("/settings/entertainment");
  } catch (err) {
    console.error("❌ Error deleting entertainment event:", err);
    req.flash("flashMessage", "❌ Failed to delete entertainment event.");
    req.flash("flashType", "error");
    res.redirect("/settings/entertainment");
  }
});

router.post("/entertainment/acts/add", ensurePrivileged, async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const externalUrl = req.body.external_url || null;
    if (!name) {
      req.flash("flashMessage", "⚠️ Act name is required.");
      req.flash("flashType", "warning");
      return res.redirect("/settings/entertainment");
    }
    await pool.query(
      `
      INSERT INTO entertainment_acts (name, external_url, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (name) DO UPDATE SET external_url = EXCLUDED.external_url, updated_at = NOW();
      `,
      [name, externalUrl]
    );
    req.flash("flashMessage", "✅ Act saved.");
    req.flash("flashType", "success");
    res.redirect("/settings/entertainment");
  } catch (err) {
    console.error("❌ Error saving act:", err);
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
