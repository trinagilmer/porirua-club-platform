const express = require("express");
const { randomUUID } = require("crypto");
const { pool } = require("../db");
const router = express.Router();
const { sendMail: graphSendMail } = require("../services/graphService");
const { sendTaskAssignmentEmail } = require("../services/taskMailer");
const recurrenceService = require("../services/recurrenceService");
const { getAppToken } = require("../utils/graphAuth");
const { getFunctionSettings } = require("../services/functionSettings");


// 🧩 Utility: normalizeRecipients
function normalizeRecipients(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// App-only Graph token
async function getGraphAccessToken() {
  return await getAppToken();
}

function isTruthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return false;
}

async function maybeSendTaskAssignmentEmail(req, task, assignedUserId, shouldNotify) {
  if (!shouldNotify || !task || !assignedUserId) return;

  try {
    const { rows } = await pool.query(
      `SELECT id, name, email FROM users WHERE id = $1 LIMIT 1;`,
      [assignedUserId]
    );
    const assignedUser = rows[0];
    if (!assignedUser?.email) {
      console.warn(`[Tasks EMAIL] Assigned user ${assignedUserId} has no email. Skipping notification.`);
      return;
    }

    let token;
    try {
      token = await getGraphAccessToken();
    } catch (tokenErr) {
      console.warn("[Tasks EMAIL] Unable to acquire Graph token for assignment email:", tokenErr.message);
      return;
    }

    const assignedBy = req.session?.user || { name: "Porirua Club" };
    const emailRecord = await sendTaskAssignmentEmail(token, task, assignedUser, assignedBy);
    console.log(`[Tasks EMAIL] Assignment email sent to ${assignedUser.email} for task ${task.id}`);

    await recordTaskAssignmentMessage(task, assignedBy, assignedUser, emailRecord);
  } catch (err) {
    console.error("[Tasks EMAIL] Failed to send assignment email:", err.message);
  }
}

async function recordTaskAssignmentMessage(task, assignedBy, assignedUser, emailRecord) {
  if (!emailRecord) return;
  const functionId = task.function_id || task.functionId || task.related_function;
  if (!functionId) {
    console.warn("[Tasks EMAIL] Task has no function_id; skipping comms log.");
    return;
  }

  const fromEmail = assignedBy?.email || process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";
  const toEmail = assignedUser?.email;
  if (!toEmail) return;

  try {
    await pool.query(
      `INSERT INTO messages
         (related_function, from_email, to_email, subject, body, body_html, created_at, message_type)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'outbound');`,
      [
        functionId,
        fromEmail,
        toEmail,
        emailRecord.subject,
        emailRecord.body_text || "",
        emailRecord.body_html || "",
      ]
    );
  } catch (err) {
    console.error("[Tasks EMAIL] Failed to log assignment email:", err.message);
  }
}

router.use(express.json());

const FUNCTION_STATUSES = [
  "lead",
  "qualified",
  "confirmed",
  "balance_due",
  "completed",
  "cancelled",
];

async function ensureFunctionCancelColumn() {
  await pool.query("ALTER TABLE functions ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;");
}

async function ensureFunctionLeadSourceColumn() {
  await pool.query("ALTER TABLE functions ADD COLUMN IF NOT EXISTS lead_source TEXT;");
}

function getAppBaseUrl(req) {
  const envBase = (process.env.APP_URL || "").trim();
  if (envBase) return envBase.replace(/\/$/, "");
  if (!req) return "http://localhost:3000";
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`.replace(/\/$/, "");
}

async function findOrCreateContact({ name, email, phone }) {
  const emailTrim = String(email || "").trim();
  if (!emailTrim) return null;
  const { rows } = await pool.query(
    `SELECT id FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
    [emailTrim]
  );
  if (rows.length) return rows[0].id;
  const {
    rows: [inserted],
  } = await pool.query(
    `
    INSERT INTO contacts (name, email, phone, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    RETURNING id;
    `,
    [name || emailTrim, emailTrim, phone || null]
  );
  return inserted?.id || null;
}

async function renderEnquiryForm(req, res, options = {}) {
  const embed = req.query.embed === "1";
  const [eventTypesRes, roomsRes, functionSettings] = await Promise.all([
    pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),
    pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
    getFunctionSettings(),
  ]);
  const baseUrl = getAppBaseUrl(req);
  const termsUrl =
    (
      functionSettings?.enquiry_terms_url ||
      process.env.FUNCTION_TERMS_URL ||
      process.env.TERMS_URL ||
      `${baseUrl}/terms`
    ).trim();

  res.status(options.status || 200).render("pages/functions/enquiry", {
    layout: false,
    title: "Function Enquiry",
    embed,
    success: options.success || false,
    errorMessage: options.errorMessage || null,
    formData: options.formData || null,
    eventTypes: eventTypesRes.rows || [],
    rooms: roomsRes.rows || [],
    termsUrl,
  });
}

const META_REGEX = /\[([a-z_]+):([^\]]+)\]/gi;

function extractProposalMetadata(description = "") {
  const meta = {};
  let match;
  while ((match = META_REGEX.exec(description))) {
    meta[match[1].toLowerCase()] = match[2];
  }
  return meta;
}

/* =========================================================
   🌐 PUBLIC: Function Enquiry (embed-friendly)
========================================================= */
router.get("/enquiry", async (req, res) => {
  try {
    await renderEnquiryForm(req, res, {
      success: req.query.success === "1",
      errorMessage: req.query.error || null,
    });
  } catch (err) {
    console.error("[Functions Enquiry] Failed to load form:", err);
    res.status(500).send("Unable to load enquiry form.");
  }
});

router.post("/enquiry", async (req, res) => {
  const embed = req.query.embed === "1";
  const {
    contact_name,
    contact_email,
    contact_phone,
    event_name,
    event_date,
    start_time,
    end_time,
    attendees,
    budget,
    event_type,
    room_id,
    lead_source,
    notes,
  } = req.body || {};

  const trimmedName = String(event_name || "").trim();
  const trimmedContact = String(contact_name || "").trim();
  const trimmedEmail = String(contact_email || "").trim();

  if (!trimmedContact || !trimmedEmail || !trimmedName) {
    return renderEnquiryForm(req, res, {
      status: 400,
      errorMessage: "Contact name, email, and event name are required.",
      formData: req.body || {},
    });
  }

  const newFunctionId = randomUUID();
  const leadSourceValue = String(lead_source || "").trim() || "Website enquiry form";
  const contactPhoneValue = String(contact_phone || "").trim() || null;
  const safeNotes = String(notes || "").trim() || null;

  let client;
  try {
    await ensureFunctionCancelColumn();
    await ensureFunctionLeadSourceColumn();
    client = await pool.connect();
    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO functions (
        id_uuid,
        event_name,
        status,
        cancelled_reason,
        event_date,
        event_time,
        start_time,
        end_time,
        attendees,
        budget,
        totals_price,
        totals_cost,
        room_id,
        event_type,
        owner_id,
        lead_source,
        created_at,
        updated_at,
        updated_by
      )
      VALUES (
        $1,$2,'lead',NULL,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,$10,NULL,$11,NOW(),NOW(),NULL
      );
      `,
      [
        newFunctionId,
        trimmedName,
        event_date || null,
        null,
        start_time || null,
        end_time || null,
        attendees ? Number(attendees) : null,
        budget ? Number(budget) : null,
        room_id ? Number(room_id) : null,
        event_type || null,
        leadSourceValue,
      ]
    );

    const contactId = await findOrCreateContact({
      name: trimmedContact,
      email: trimmedEmail,
      phone: contactPhoneValue,
    });

    if (contactId) {
      await client.query(
        `
        INSERT INTO function_contacts (function_id, contact_id, is_primary, created_at)
        VALUES ($1, $2, TRUE, NOW())
        ON CONFLICT (function_id, contact_id) DO NOTHING;
        `,
        [newFunctionId, contactId]
      );
    }

    if (safeNotes) {
      await client.query(
        `
        INSERT INTO function_notes
          (function_id, content, note_type, created_by, updated_by, created_at, updated_at)
        VALUES ($1, $2, 'general', NULL, NULL, NOW(), NOW());
        `,
        [newFunctionId, safeNotes]
      );
    }

    await client.query("COMMIT");

    let roomName = null;
    if (room_id) {
      const { rows } = await client.query(`SELECT name FROM rooms WHERE id = $1 LIMIT 1;`, [
        Number(room_id),
      ]);
      roomName = rows[0]?.name || null;
    }

    try {
      const token = await getGraphAccessToken();
      const functionSettings = await getFunctionSettings();
      const notifyValue =
        functionSettings?.enquiry_notification_emails ||
        process.env.FUNCTION_ENQUIRY_NOTIFICATIONS ||
        "operations@poriruaclub.co.nz";
      const to = normalizeRecipients(notifyValue);
      if (token && to.length) {
        const baseUrl = getAppBaseUrl(req);
        const detailLink = `${baseUrl}/functions/${newFunctionId}`;
        const subject = `New function enquiry: ${trimmedName}`;
        const body = `
          <p>A new function enquiry has been submitted.</p>
          <p><strong>Event:</strong> ${trimmedName}</p>
          <p><strong>Date:</strong> ${event_date || "TBC"}</p>
          <p><strong>Time:</strong> ${[start_time, end_time].filter(Boolean).join(" - ") || "TBC"}</p>
          <p><strong>Guests:</strong> ${attendees || "TBC"}</p>
          <p><strong>Budget:</strong> ${budget || "TBC"}</p>
          <p><strong>Event type:</strong> ${event_type || "TBC"}</p>
          <p><strong>Room:</strong> ${roomName || "TBC"}</p>
          <p><strong>Lead source:</strong> ${leadSourceValue}</p>
          <p><strong>Contact:</strong> ${trimmedContact} (${trimmedEmail}${contactPhoneValue ? `, ${contactPhoneValue}` : ""})</p>
          ${safeNotes ? `<p><strong>Notes:</strong><br/>${safeNotes}</p>` : ""}
          <p><a href="${detailLink}">View in portal</a></p>
        `;
        await graphSendMail(token, {
          to,
          subject,
          body,
          fromMailbox: process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz",
        });
      }
    } catch (mailErr) {
      console.error("[Functions Enquiry] Email send failed:", mailErr.message);
    }

    const successUrl = embed
      ? "/functions/enquiry?embed=1&success=1"
      : "/functions/enquiry?success=1";
    res.redirect(successUrl);
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("[Functions Enquiry] Rollback failed:", rollbackErr.message);
      }
    }
    console.error("[Functions Enquiry] Failed to submit:", err);
    await renderEnquiryForm(req, res, {
      status: 500,
      errorMessage: "Unable to submit enquiry. Please try again.",
      formData: req.body || {},
    });
  } finally {
    client?.release();
  }
});

function stripProposalMetadata(description = "") {
  return String(description || "").replace(/\s*\[[^\]]+\]/g, "").trim();
}

function cleanLabelFromDescription(description = "") {
  return stripProposalMetadata(description)
    .replace(/\s+x\s+\d+(?:\.\d+)?\s*$/i, "")
    .replace(/^menu:\s*/i, "")
    .replace(/^choice:\s*/i, "")
    .trim();
}

function friendlyUnit(meta = {}) {
  if (!meta) return "";
  if (meta.unit) return meta.unit;
  if (meta.unit_name) return meta.unit_name;
  const type = (meta.unit_type || "").toLowerCase();
  if (!type) return "";
  if (type.includes("per") && type.includes("person")) return "pp";
  if (type.includes("guest")) return "per guest";
  if (type.includes("each") || type === "quantity") return "each";
  return type;
}

function parseIdList(value) {
  if (!value && value !== 0) return [];
  const rawList = Array.isArray(value)
    ? value
    : String(value)
        .split(/[,\s]+/)
        .filter(Boolean);
  return rawList
    .map((entry) => {
      if (typeof entry === "number") return entry;
      const trimmed = String(entry || "").trim();
      if (!trimmed) return null;
      const maybeNumber = Number(trimmed);
      return Number.isNaN(maybeNumber) ? trimmed : maybeNumber;
    })
    .filter((entry) => entry !== null && entry !== undefined);
}

function summarizeProposalMenus(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const meta = extractProposalMetadata(item.description);
    if (!meta.menu_id) return;
    const menuId = String(meta.menu_id);
    const excluded = String(meta.excluded || "").toLowerCase() === "true";
    const entry = map.get(menuId) || {
      id: Number(menuId),
      name: "",
      category: meta.category || "Uncategorised",
      qty: meta.qty ? Number(meta.qty) : null,
      unit: friendlyUnit(meta),
      total_price: 0,
      total_cost: 0,
      audit: null,
    };

    const qty = Number(meta.qty || item.qty || 1);
    const qtySafe = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const priceLine = excluded ? 0 : Number(item.unit_price) || 0;

    const rawCostEach = meta.cost_each !== undefined ? Number(meta.cost_each) : null;
    const rawCostTotal = meta.cost !== undefined ? Number(meta.cost) : null;
    let costLine = 0;
    if (excluded) {
      costLine = 0;
    } else if (Number.isFinite(rawCostEach)) {
      costLine = rawCostEach * qtySafe;
    } else if (Number.isFinite(rawCostTotal)) {
      costLine = rawCostTotal;
    }

    entry.total_price += priceLine;
    if (Number.isFinite(costLine)) {
      entry.total_cost += costLine;
    }
    if (meta.qty && !entry.qty) entry.qty = Number(meta.qty);
    if (!entry.unit) entry.unit = friendlyUnit(meta);
    if (meta.category && !entry.category) entry.category = meta.category;

    const clean = stripProposalMetadata(item.description);
    if (/^menu:/i.test(clean)) {
      entry.name = cleanLabelFromDescription(item.description);
    }

    map.set(menuId, entry);
  });

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      name: entry.name || `Menu #${entry.id}`,
    }))
    .sort((a, b) => {
      const catCompare = (a.category || "").localeCompare(b.category || "");
      if (catCompare !== 0) return catCompare;
      return (a.name || "").localeCompare(b.name || "");
    });
}

function buildMenuItemsByMenu(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const meta = extractProposalMetadata(item.description);
    const menuId = meta.menu_id;
    if (!menuId) return;
    const label = cleanLabelFromDescription(item.description);
    const qty = Number(meta.qty || item.qty || 1);
    const qtySafe = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const unit = friendlyUnit(meta);
    const rawCostEach = meta.cost_each !== undefined ? Number(meta.cost_each) : null;
    const rawCostTotal = meta.cost !== undefined ? Number(meta.cost) : null;
    let costEach = null;
    if (Number.isFinite(rawCostEach) && rawCostEach >= 0) {
      costEach = rawCostEach;
    } else if (Number.isFinite(rawCostTotal) && rawCostTotal >= 0 && qtySafe > 0) {
      costEach = rawCostTotal / qtySafe;
    }
    const costTotal = costEach != null ? costEach * qtySafe : null;
    const priceTotal = Number(item.unit_price) || 0;
    const priceEach = qtySafe > 0 ? priceTotal / qtySafe : priceTotal;
    const entry = {
      label,
      qty: qtySafe,
      unit: unit || "",
      price: priceTotal,
      price_each: priceEach,
      cost: costTotal,
      cost_total: costTotal,
      cost_each: costEach,
      excluded: String(meta.excluded || "").toLowerCase() === "true",
    };
    const key = String(menuId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  });
  return map;
}

function buildFallbackTotals(items = []) {
  const subtotal = items.reduce((sum, item) => sum + (Number(item.unit_price) || 0), 0);
  return {
    subtotal,
    gratuity_percent: 0,
    gratuity_amount: 0,
    discount_amount: 0,
    deposit_amount: 0,
    total_paid: 0,
    remaining_due: subtotal,
  };
}

function safePreview(text = "", limit = 160) {
  const normalized = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function abbreviateName(name = "") {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("");
}

function parseNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function loadFunctionFormLookups() {
  const [roomsRes, eventTypesRes, usersRes] = await Promise.all([
    pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
    pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),
    pool.query(`SELECT id, name FROM users ORDER BY name ASC;`),
  ]);
  return {
    rooms: roomsRes.rows,
    eventTypes: eventTypesRes.rows,
    users: usersRes.rows,
  };
}

/* =========================================================
   🧭 1. FUNCTIONS DASHBOARD (UUID-Ready, Clean Version)
========================================================= */
router.get("/", async (req, res, next) => {
  try {
    const userId = req.session.user?.id || null;
    const statusFilter = req.query.status || "active";
    const myOnly = req.query.mine === "true";

    const statusGroups = {
      active: ["lead", "qualified", "confirmed", "balance_due"],
      lead: ["lead"],
      qualified: ["qualified"],
      confirmed: ["confirmed"],
      balance_due: ["balance_due"],
      completed: ["completed"],
      cancelled: ["cancelled"],
    };

    const statuses = statusGroups[statusFilter] || statusGroups.active;

    // 🧩 Base query
    let baseQuery = `
      SELECT 
        f.*, 
        f.id_uuid AS id, 
        r.name AS room_name, 
        u.name AS owner_name,
        COALESCE(contact_data.contacts, '[]') AS contacts
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON f.owner_id = u.id
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', c.id,
            'name', c.name,
            'email', c.email,
            'phone', c.phone,
            'is_primary', fc.is_primary
          )
        ) AS contacts
        FROM function_contacts fc
        JOIN contacts c ON fc.contact_id = c.id
        WHERE fc.function_id = f.id_uuid
      ) contact_data ON TRUE
      WHERE f.status = ANY($1)
    `;

    const params = [statuses];

    if (myOnly) {
      baseQuery += ` AND f.owner_id = $2`;
      params.push(userId);
    }

    baseQuery += ` ORDER BY f.event_date ASC;`;

    const { rows: functionEvents } = await pool.query(baseQuery, params);

    // 💰 Totals by status
    const { rows: totals } = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status='lead' THEN totals_price ELSE 0 END),0) AS lead_value,
        COALESCE(SUM(CASE WHEN status='qualified' THEN totals_price ELSE 0 END),0) AS qualified_value,
        COALESCE(SUM(CASE WHEN status='confirmed' THEN totals_price ELSE 0 END),0) AS confirmed_value,
        COALESCE(SUM(CASE WHEN status='balance_due' THEN totals_price ELSE 0 END),0) AS balance_due_value,
        COALESCE(SUM(CASE WHEN status='completed' THEN totals_price ELSE 0 END),0) AS completed_value
      FROM functions;
    `);

    // 🖥️ Render dashboard
    res.render("pages/functions/index", {
      title: "Functions Dashboard",
      active: "functions",
      user: req.session.user || null,
      events: functionEvents,
      totals: totals[0],
      statusFilter,
      myOnly,
    });
  } catch (err) {
    console.error("❌ Error loading dashboard:", err);
    next(err);
  }
});


/* =========================================================
   💬 COMMUNICATIONS ROUTES (UUID-Ready, Clean Version)
========================================================= */

// 📨 List all communications for a function
router.get("/:id/communications", async (req, res, next) => {
  const { id: functionId } = req.params; // UUID

  try {
    // 1️⃣ Fetch the parent function
    const { rows: fnRows } = await pool.query(
      `SELECT id_uuid, event_name, event_date, status, attendees, budget, totals_cost, totals_price, room_id, event_type 
       FROM functions 
       WHERE id_uuid = $1;`,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Fetch related messages
    const { rows: messages } = await pool.query(
      `
      SELECT * FROM (
        SELECT 
           id::text AS message_id,
           subject,
           body,
           body_html,
           from_email,
           to_email,
           created_at,
           sent_at,
           received_at,
           COALESCE(sent_at, created_at, received_at) AS entry_date,
           related_function::text AS related_function,
           message_type
         FROM messages
        WHERE related_function::text = $1::text
        UNION ALL
        SELECT
           id::text AS message_id,
           subject,
           body,
           body AS body_html,
           NULL AS from_email,
           NULL AS to_email,
           created_at,
           NULL AS sent_at,
           NULL AS received_at,
           created_at AS entry_date,
           function_id::text AS related_function,
           COALESCE(channel, 'proposal') AS message_type
        FROM communications
        WHERE function_id::text = $1::text
      ) AS combined
      ORDER BY entry_date DESC;
      `,
      [functionId]
    );

    // 3️⃣ Linked contacts
    const linkedContactsRes = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
       FROM contacts c
       JOIN function_contacts fc ON fc.contact_id = c.id
       WHERE fc.function_id = $1
       ORDER BY fc.is_primary DESC, c.name ASC;`,
      [functionId]
    );

    // 4️⃣ Supporting data
    const roomsRes = await pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`);
    const eventTypesRes = await pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`);

    // 🖥️ Render page
    res.render("pages/functions/communications", {
      layout: "layouts/main",
      title: `Communications – ${fn.event_name}`,
      user: req.session.user || null,
      fn,
      messages,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      activeTab: "communications",
    });
  } catch (err) {
    console.error("❌ [Communications] Error:", err);
    next(err);
  }
});

// =========================================================
// ?? FUNCTION CREATE - GET/POST
// =========================================================

router.get("/new", async (req, res, next) => {
  try {
    const lookups = await loadFunctionFormLookups();
    const seedValues = {
      event_name: req.query.event_name || "",
      event_date: req.query.event_date || req.query.date || "",
      event_time: req.query.event_time || "",
      start_time: req.query.start_time || "",
      end_time: req.query.end_time || "",
      attendees: req.query.attendees || "",
      room_id: req.query.room_id || "",
      status: req.query.status || "lead",
    };
    res.render("pages/functions/new", {
      layout: "layouts/main",
      title: "Create Function",
      user: req.session.user || null,
      rooms: lookups.rooms,
      eventTypes: lookups.eventTypes,
      users: lookups.users,
      statuses: FUNCTION_STATUSES,
      formValues: seedValues,
      formError: null,
    });
  } catch (err) {
    console.error("❌ Error loading new function form:", err);
    next(err);
  }
});

router.post("/new", async (req, res) => {
  const {
    event_name,
    event_date,
    event_time,
    start_time,
    end_time,
    attendees,
    budget,
    totals_price,
    totals_cost,
    room_id,
    event_type,
    status,
    owner_id,
    cancelled_reason,
  } = req.body || {};

  const trimmedName = (event_name || "").trim();
  if (!trimmedName) {
    return renderCreateError(res, req, "Event name is required.", req.body || {});
  }

  const newFunctionId = randomUUID();
  const userId = req.session.user?.id || null;
  const statusValue = (status || "lead").trim() || "lead";
  const cancelReasonValue = statusValue === "cancelled" ? (cancelled_reason || "").trim() || null : null;

  const recurrence = recurrenceService.parseRecurrenceForm(req.body);
  const client = await pool.connect();
  try {
    await ensureFunctionCancelColumn();
    await client.query("BEGIN");
    await client.query(
      `
      INSERT INTO functions (
        id_uuid,
        event_name,
        status,
        cancelled_reason,
        event_date,
        event_time,
        start_time,
        end_time,
        attendees,
        budget,
        totals_price,
        totals_cost,
        room_id,
        event_type,
        owner_id,
        created_at,
        updated_at,
        updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW(),$16
      );
      `,
      [
        newFunctionId,
        trimmedName,
        statusValue,
        cancelReasonValue,
        event_date || null,
        event_time || null,
        start_time || null,
        end_time || null,
        parseNullableNumber(attendees),
        parseNullableNumber(budget),
        parseNullableNumber(totals_price),
        parseNullableNumber(totals_cost),
        room_id ? Number(room_id) : null,
        event_type || null,
        owner_id ? Number(owner_id) : null,
        userId || null
      ]
    );
    if (recurrence) {
      if (!event_date) {
        throw new Error("Recurring functions require an event date.");
      }
      const series = await recurrenceService.createSeriesRecord(client, {
        entityType: "function",
        template: {
          event_name: trimmedName,
          room_id: room_id ? Number(room_id) : null,
          start_time: start_time || null,
          end_time: end_time || null,
        },
        startDate: event_date,
        recurrence,
        createdBy: userId,
      });
      if (series?.seriesId) {
        await client.query(
          `UPDATE functions SET series_id = $1, series_order = 1 WHERE id_uuid = $2;`,
          [series.seriesId, newFunctionId]
        );
        let order = 2;
        for (const date of series.occurrenceDates.slice(1)) {
          const cloneId = randomUUID();
          await client.query(
            `
            INSERT INTO functions (
              id_uuid,
              event_name,
              status,
              cancelled_reason,
              event_date,
              event_time,
              start_time,
              end_time,
              attendees,
              budget,
              totals_price,
              totals_cost,
              room_id,
              event_type,
              owner_id,
              series_id,
              series_order,
              created_at,
              updated_at,
              updated_by
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW(),$18
            );
            `,
            [
              cloneId,
              trimmedName,
              statusValue,
              cancelReasonValue,
              date,
              event_time || null,
              start_time || null,
              end_time || null,
              parseNullableNumber(attendees),
              parseNullableNumber(budget),
              parseNullableNumber(totals_price),
              parseNullableNumber(totals_cost),
              room_id ? Number(room_id) : null,
              event_type || null,
              owner_id ? Number(owner_id) : null,
              series.seriesId,
              order,
              userId || null,
            ]
          );
          order += 1;
        }
      }
    }
    await client.query("COMMIT");
    console.log(`✅ Function created (UUID: ${newFunctionId}, Name: ${trimmedName})`);
    return res.redirect(`/functions/${newFunctionId}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating function:", err);
    return renderCreateError(
      res,
      req,
      "Failed to create function. Please try again.",
      req.body || {}
    );
  } finally {
    client.release();
  }
});

async function renderCreateError(res, req, message, formValues) {
  const lookups = await loadFunctionFormLookups();
  return res.status(400).render("pages/functions/new", {
    layout: "layouts/main",
    title: "Create Function",
    user: req.session.user || null,
    rooms: lookups.rooms,
    eventTypes: lookups.eventTypes,
    users: lookups.users,
    statuses: FUNCTION_STATUSES,
    formValues,
    formError: message,
  });
}


// 📄 Single communication message detail
router.get("/:id/communications/:messageId", async (req, res, next) => {
  const { id: functionId, messageId } = req.params;

  try {
    // Fetch parent function
    const { rows: fnRows } = await pool.query(
      `SELECT id_uuid, event_name, event_date, status
       FROM functions 
       WHERE id_uuid = $1;`,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // Fetch message detail
    const { rows: msgRows } = await pool.query(
      `
      SELECT * FROM (
        SELECT 
           id::text AS message_id,
           subject, 
           body, 
           body_html, 
           from_email, 
           to_email, 
           message_type,
           created_at,
           sent_at,
           received_at,
           COALESCE(sent_at, created_at, received_at) AS entry_date
         FROM messages
         WHERE related_function::text = $2::text
        UNION ALL
        SELECT
           id::text AS message_id,
           subject,
           body,
           body AS body_html,
           NULL AS from_email,
           NULL AS to_email,
           COALESCE(channel, 'proposal') AS message_type,
           created_at,
           NULL AS sent_at,
           NULL AS received_at,
           created_at AS entry_date
        FROM communications
        WHERE function_id::text = $2::text
      ) AS combined
      WHERE message_id = $1::text
      LIMIT 1;
      `,
      [messageId, functionId]
    );

    const message = msgRows[0];
    if (!message) return res.status(404).send("Message not found");

    // Fetch related contacts, rooms, event types
    const linkedContactsRes = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.company, fc.is_primary
       FROM contacts c
       JOIN function_contacts fc ON fc.contact_id = c.id
       WHERE fc.function_id = $1
       ORDER BY fc.is_primary DESC, c.name ASC;`,
      [functionId]
    );

    const roomsRes = await pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`);
    const eventTypesRes = await pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`);

// Render message detail page
res.render("pages/functions/communication-detail", {
  layout: "layouts/main",
  title: `Message — ${fn.event_name}`,
  user: req.session.user || null,
  fn,
  message,
  messages: [], // ✅ prevents "messages is not defined" error
  linkedContacts: linkedContactsRes.rows,
  rooms: roomsRes.rows,
  eventTypes: eventTypesRes.rows,
  activeTab: "communications",
  pageType: "function-page" // ✅ prevents main.ejs from using function-shell
});

  } catch (err) {
    console.error("❌ [Communication DETAIL] Error:", err);
    next(err);
  }
});


// ✉️ SEND new message
router.post("/:id/communications/send", async (req, res) => {
  const { id: functionId } = req.params;
  const sender = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";

  const to = normalizeRecipients(req.body.to);
  const cc = normalizeRecipients(req.body.cc);
  const bcc = normalizeRecipients(req.body.bcc);
  const subject = (req.body.subject || "(No subject)").trim();
  const body = req.body.body || "";

  try {
    const accessToken = await getGraphAccessToken();
    if (!accessToken) return;

    await graphSendMail(accessToken, { to, cc, bcc, subject, body });

    const insert = await pool.query(
      `INSERT INTO messages
         (related_function, from_email, to_email, subject, body, created_at, message_type)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'outbound')
       RETURNING id;`,
      [functionId, sender, to.join(", "), subject, body]
    );

    return res.json({ success: true, data: { id: insert.rows[0].id } });
  } catch (err) {
    console.error("❌ [Function SEND via Graph]", err?.message || err);
    res.status(500).json({ success: false, error: "Failed to send via Graph" });
  }
});


// ✉️ REPLY to message
router.post("/:id/communications/:messageId/reply", async (req, res) => {
  const { id: functionId, messageId } = req.params;
  const sender = process.env.SHARED_MAILBOX || "events@poriruaclub.co.nz";

  const to = normalizeRecipients(req.body.to);
  const cc = normalizeRecipients(req.body.cc);
  const bcc = normalizeRecipients(req.body.bcc);
  const subject = (req.body.subject || "Re:").trim();
  const body = req.body.body || "";

  const nextUrl = req.body.next || `/functions/${functionId}/communications`;

  try {
    const { rows: orig } = await pool.query(
      `SELECT id FROM messages WHERE id = $1 AND related_function = $2`,
      [messageId, functionId]
    );

    if (!orig.length) return res.status(404).send("Original message not found");

    const accessToken = await getGraphAccessToken();
    if (!accessToken) return;

    await graphSendMail(accessToken, { to, cc, bcc, subject, body });

    await pool.query(
      `INSERT INTO messages
         (related_function, from_email, to_email, subject, body, created_at, message_type)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'outbound');`,
      [functionId, sender, to.join(", "), subject, body]
    );

    res.redirect(nextUrl);
  } catch (err) {
    console.error("❌ [Function REPLY via Graph]", err?.message || err);
    res.status(500).json({ success: false, error: "Failed to send reply via Graph" });
  }
});

/* =========================================================
   ✏️ FUNCTION EDIT — GET + POST (UUID-Ready, Clean Version)
========================================================= */

// 🧭 GET: Function edit page
router.get("/:id/edit", async (req, res, next) => {
  const { id: functionId } = req.params;

  try {
    // 1️⃣ Load function details
    const { rows: fnRows } = await pool.query(
      `SELECT * FROM functions WHERE id_uuid = $1;`,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) return res.status(404).send("Function not found");

    // 2️⃣ Load related data concurrently
    const [linkedContactsRes, roomsRes, eventTypesRes, usersRes] = await Promise.all([
      pool.query(`
        SELECT c.id, c.name, c.email, c.phone, fc.is_primary
        FROM contacts c
        JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;`,
        [functionId]
      ),
      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),
      pool.query(`SELECT id, name FROM users ORDER BY name ASC;`)
    ]);

    // 3️⃣ Render edit page
    res.render("pages/functions/edit", {
      layout: "layouts/main",
      title: `Edit — ${fn.event_name}`,
      user: req.session.user || null,
      fn,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      users: usersRes.rows,
      activeTab: "edit"
    });

  } catch (err) {
    console.error("❌ Error loading function edit page:", err);
    next(err);
  }
});


// 📝 POST: Save edited function
router.post("/:id/edit", async (req, res) => {
  const { id: functionId } = req.params;
  const {
    event_name,
    event_date,
    event_time,
    start_time,
    end_time,
    attendees,
    budget,
    totals_price,
    totals_cost,
    room_id,
    event_type,
    status,
    owner_id,
    cancelled_reason,
  } = req.body;

  const userId = req.session.user?.id || null;
  const statusValue = (status || "").trim() || "lead";
  const cancelReasonValue = statusValue === "cancelled" ? (cancelled_reason || "").trim() || null : null;

  try {
    await ensureFunctionCancelColumn();
    await pool.query(`
      UPDATE functions
      SET
        event_name   = $1,
        event_date   = $2,
        event_time   = $3,
        start_time   = $4,
        end_time     = $5,
        attendees    = $6,
        budget       = $7,
        totals_price = $8,
        totals_cost  = $9,
        room_id      = $10,
        event_type   = $11,
        status       = $12,
        cancelled_reason = $13,
        owner_id     = $14,
        updated_at   = NOW(),
        updated_by   = COALESCE($15, updated_by)
    WHERE id_uuid = $16;`,
    [
      event_name,
      event_date || null,
      event_time || null,
      start_time || null,
      end_time || null,
      attendees || null,
      budget || null,
      totals_price || 0,
      totals_cost || 0,
      room_id || null,
      event_type || null,
      statusValue,
      cancelReasonValue,
      owner_id || null,
      userId,
      functionId
    ]
    );

    console.log(`✅ Function updated successfully (UUID: ${functionId}, Name: ${event_name})`);
    res.redirect(`/functions/${functionId}`);

  } catch (err) {
    console.error("❌ Error updating function:", err);
    res.status(500).send("Failed to update function");
  }
});



router.get("/:id/run-sheet", async (req, res) => {
  try {
    const functionId = req.params.id.trim();
    const notesParam = req.query.notes;
    const menusParam = req.query.menus;
    const includeCosts = String(req.query.costs || "").toLowerCase() === "true";
    const skipNotes = typeof notesParam === "string" && notesParam.toLowerCase() === "none";
    const skipMenus = typeof menusParam === "string" && menusParam.toLowerCase() === "none";
    const noteFilters = skipNotes
      ? []
      : parseIdList(notesParam)
          .map(Number)
          .filter((n) => Number.isInteger(n));
    const menuFilters = skipMenus
      ? []
      : parseIdList(menusParam)
          .map(Number)
          .filter((n) => Number.isInteger(n));

    const { rows: fnRows } = await pool.query(
      `SELECT f.*, r.name AS room_name
         FROM functions f
    LEFT JOIN rooms r ON r.id = f.room_id
        WHERE f.id_uuid = $1
        LIMIT 1`,
      [functionId]
    );
    const fn = fnRows[0];
    if (!fn) {
      return res.status(404).send("Function not found");
    }

    const [notesRes, proposalLookupRes] = await Promise.all([
      pool.query(
        `SELECT id, note_type, rendered_html, content, created_at, updated_at
           FROM function_notes
          WHERE function_id = $1
          ORDER BY created_at ASC`,
        [functionId]
      ),
      pool.query(
        `SELECT id, status
           FROM proposals
          WHERE function_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [functionId]
      ),
    ]);

    const activeProposal = proposalLookupRes.rows[0] || null;
    let proposalItems = [];

    if (activeProposal) {
      const { rows: itemsRes } = await pool.query(
        `SELECT id, description, unit_price
           FROM proposal_items
          WHERE proposal_id = $1
          ORDER BY id ASC`,
        [activeProposal.id]
      );
      proposalItems = itemsRes;
    }

    const menuItemsMap = buildMenuItemsByMenu(proposalItems);
    const menuSummary = summarizeProposalMenus(proposalItems).map((menu) => ({
      ...menu,
      items: (menuItemsMap.get(String(menu.id)) || []).filter((item) => !item.excluded),
    }));

    const selectedMenus = skipMenus
      ? []
      : menuFilters.length
      ? menuSummary.filter((menu) => menuFilters.includes(Number(menu.id)))
      : menuSummary;
    const selectedNotes = skipNotes
      ? []
      : noteFilters.length
      ? notesRes.rows.filter((note) => noteFilters.includes(Number(note.id)))
      : notesRes.rows;

    res.render("pages/functions/run-sheet", {
      layout: "layouts/main",
      hideChrome: true,
      pageType: "run-sheet",
      title: `Run Sheet - ${fn.event_name}`,
      fn,
      eventDate: fn.event_date,
      startTime: fn.start_time,
      endTime: fn.end_time,
      attendees: fn.attendees,
      roomName: fn.room_name,
      notes: selectedNotes,
      menus: selectedMenus,
      includeCosts,
    });
  } catch (err) {
    console.error("[Run Sheet] Error:", err);
    res.status(500).send("Failed to load run sheet");
  }
});

/* =========================================================
   🧭 FUNCTION DETAIL VIEW — Full (Sidebar + Timeline, UUID Safe, Clean Version)
========================================================= */
router.get("/:id", async (req, res) => {
  try {
    const functionId = req.params.id.trim(); // UUID, trimmed for safety
    const activeTab = req.query.tab || "overview";

    // 1️⃣ Fetch base function info (by UUID)
    const { rows: fnRows } = await pool.query(
      `
      SELECT 
        f.*, 
        r.name AS room_name, 
        u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON f.room_id = r.id
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.id_uuid = $1;
      `,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) {
      console.warn(`⚠️ Function not found for UUID: ${functionId}`);
      return res.status(404).send("Function not found");
    }

    // 2️⃣ Load related data concurrently (UUID-safe)
    const [
      linkedContactsRes,
      notesRes,
      tasksRes,
      messagesRes,
      roomsRes,
      eventTypesRes,
      usersRes,
      menuUpdatesRes,
      proposalLookupRes,
      acceptanceRes,
    ] = await Promise.all([
      // Contacts
      pool.query(
        `
        SELECT 
          c.id, 
          c.name, 
          c.email, 
          c.phone, 
          c.company, 
          fc.is_primary
        FROM function_contacts fc
        JOIN contacts c ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;
        `,
        [functionId]
      ),

      // Notes
      pool.query(
        `
        SELECT 
          n.id,
          n.function_id,
          n.note_type,
          n.content AS body,
          n.created_at AS entry_date,
          n.updated_at,
          n.updated_by,
          uc.name AS author,
          uu.name AS updated_by_name
        FROM function_notes n
        LEFT JOIN users uc ON uc.id = n.created_by
        LEFT JOIN users uu ON uu.id = n.updated_by
        WHERE n.function_id = $1
        ORDER BY n.created_at DESC;
        `,
        [functionId]
      ),

      // Tasks
      pool.query(
        `
        SELECT 
          t.id, 
          t.title, 
          t.status, 
          t.due_at, 
          t.created_at AS entry_date,
          u.name AS assigned_to_name
        FROM tasks t
        LEFT JOIN users u ON u.id::text = t.assigned_to::text
        WHERE t.function_id = $1
        ORDER BY t.created_at DESC;
        `,
        [functionId]
      ),

      // Messages + communications (recent)
      pool.query(
        `
        SELECT * FROM (
          SELECT 
            m.id::text AS message_id,
            m.subject,
            m.body,
            m.body_html,
            m.message_type,
            m.from_email,
            m.to_email,
            m.created_at,
            m.sent_at,
            m.received_at,
            COALESCE(m.sent_at, m.created_at, m.received_at) AS entry_date
          FROM messages m
          WHERE m.related_function::text = $1::text
          UNION ALL
          SELECT
            c.id::text AS message_id,
            c.subject,
            c.body,
            c.body AS body_html,
            COALESCE(c.channel, 'proposal') AS message_type,
            NULL AS from_email,
            NULL AS to_email,
            c.created_at,
            NULL AS sent_at,
            NULL AS received_at,
            c.created_at AS entry_date
          FROM communications c
          WHERE c.function_id::text = $1::text
        ) AS combined
        ORDER BY entry_date DESC
        LIMIT 8;
        `,
        [functionId]
      ),

      // Static lookup data
      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),
      pool.query(`SELECT id, name FROM users ORDER BY name ASC;`),
      pool.query(
        `SELECT 
           fmu.menu_id, 
           fmu.updated_at, 
           fmu.created_at,
           u.name AS updated_by_name
         FROM function_menu_updates fmu
         LEFT JOIN users u ON u.id = fmu.updated_by
        WHERE fmu.function_id = $1`,
        [functionId]
      ),
      pool.query(
        `SELECT p.id, p.status, p.created_at, p.updated_at, p.updated_by, u.name AS updated_by_name
           FROM proposals p
           LEFT JOIN users u ON u.id = p.updated_by
          WHERE p.function_id = $1
          ORDER BY p.created_at DESC
          LIMIT 1;`,
        [functionId]
      ),
      pool.query(
        `SELECT pae.client_status,
                pae.submitted_by,
                pae.submitted_ip,
                pae.submitted_at AS created_at,
                pae.id AS event_id
           FROM proposal_acceptance_events pae
           JOIN proposals p ON p.id = pae.proposal_id
          WHERE p.function_id = $1
          ORDER BY pae.id DESC
          LIMIT 1`,
        [functionId]
      ),
    ]);

    // 3️⃣ Build combined timeline entries
    const allEntries = [
      ...notesRes.rows.map((n) => ({ ...n, entry_type: "note", entry_id: n.id })),
      ...tasksRes.rows.map((t) => ({ ...t, entry_type: "task", entry_id: t.id })),
      ...messagesRes.rows.map((m) => ({
        ...m,
        entry_type: "message",
        entry_id: m.message_id || m.id,
      })),
    ];

    const activeProposal = proposalLookupRes.rows[0] || null;
    let proposalItems = [];
    let totalsRow = null;

    if (activeProposal) {
      const [itemsRes, totalsRes] = await Promise.all([
        pool.query(
          `SELECT id, description, unit_price
             FROM proposal_items
            WHERE proposal_id = $1
            ORDER BY id ASC;`,
          [activeProposal.id]
        ),
        pool.query(
          `SELECT pt.subtotal,
                  pt.gratuity_percent,
                  pt.gratuity_amount,
                  pt.discount_amount,
                  pt.deposit_amount,
                  pt.total_paid,
                  pt.remaining_due,
                  pt.created_at,
                  pt.updated_at,
                  pt.updated_by,
                  u.name AS updated_by_name
             FROM proposal_totals pt
        LEFT JOIN users u ON u.id = pt.updated_by
            WHERE pt.proposal_id = $1
            LIMIT 1;`,
          [activeProposal.id]
        ),
      ]);
      proposalItems = itemsRes.rows;
      totalsRow = totalsRes.rows[0] || null;
    }

    const menuAuditMap = new Map(
      (menuUpdatesRes.rows || []).map((row) => [String(row.menu_id), row])
    );
    const menuItemsMap = buildMenuItemsByMenu(proposalItems);
    const overviewMenus = summarizeProposalMenus(proposalItems).map((menu) => {
      const audit = menuAuditMap.get(String(menu.id));
      return {
        ...menu,
        audit: audit
          ? {
              updated_at: audit.updated_at,
              created_at: audit.created_at,
              initials: abbreviateName(audit.updated_by_name || ""),
              name: audit.updated_by_name || "",
            }
          : null,
        items: menuItemsMap.get(String(menu.id)) || [],
      };
    });

    const totals =
      totalsRow
        ? {
            ...totalsRow,
            audit: {
              updated_at: totalsRow.updated_at,
              created_at: totalsRow.created_at,
              initials: abbreviateName(totalsRow.updated_by_name || ""),
              name: totalsRow.updated_by_name || "",
            },
          }
        : buildFallbackTotals(proposalItems);
    if (!totals.audit) {
      totals.audit = null;
    }

    const overviewNotes = notesRes.rows.slice(0, 4).map((note) => {
      const initials = abbreviateName(note.updated_by_name || note.author || "");
      return {
        ...note,
        id: note.id,
        type: note.note_type,
        content: note.body,
        title:
          note.note_type === "call"
            ? "Call"
            : note.note_type
            ? note.note_type.charAt(0).toUpperCase() + note.note_type.slice(1)
            : "Note",
        preview: safePreview(note.body),
        updated_by_name: note.updated_by_name || note.author || "",
        updated_by_initials: initials,
      };
    });

    const communications = messagesRes.rows.map((message) => {
      const msgId = message.message_id || message.id;
      const type = (message.message_type || "email").toLowerCase();
      const timestamp =
        message.entry_date || message.created_at || message.sent_at || message.received_at || null;
      return {
        id: msgId,
        type,
        subject: message.subject || "Message",
        preview: safePreview(message.body_html || message.body),
        sender: message.from_email || "",
        recipient: Array.isArray(message.to_email)
          ? message.to_email.join(", ")
          : message.to_email || "",
        entry_date: timestamp,
        link:
          type === "proposal"
            ? `/functions/${functionId}/proposal/preview`
            : `/functions/${functionId}/communications/${encodeURIComponent(msgId)}`,
      };
    });

    const proposalAudit = activeProposal
      ? {
          id: activeProposal.id,
          status: activeProposal.status,
          updated_at: activeProposal.updated_at,
          created_at: activeProposal.created_at,
          initials: abbreviateName(activeProposal.updated_by_name || ""),
          name: activeProposal.updated_by_name || "",
        }
      : null;

    const { rows: feedbackRows } = await pool.query(
      `
      SELECT rating_overall, rating_service, nps_score, recommend, comments, issue_tags, status, completed_at, sent_at, updated_at
        FROM feedback_responses
       WHERE entity_type = 'function'
         AND entity_id = $1
       ORDER BY completed_at DESC NULLS LAST, sent_at DESC NULLS LAST, updated_at DESC
      LIMIT 5;
      `,
      [functionId]
    );

    // Contact feedback aggregates (per contact/email)
    const { rows: contactFeedbackRows } = await pool.query(
      `
      SELECT
        COALESCE(contact_id::text, LOWER(contact_email)) AS contact_key,
        COUNT(*) FILTER (WHERE status = 'completed') AS responses,
        AVG(rating_overall) FILTER (WHERE status = 'completed') AS avg_overall,
        AVG(rating_service) FILTER (WHERE status = 'completed') AS avg_service,
        AVG(CASE WHEN recommend IS NULL THEN NULL ELSE (CASE WHEN recommend THEN 1 ELSE 0 END) END)
          FILTER (WHERE status = 'completed') AS recommend_rate
      FROM feedback_responses
      WHERE status = 'completed'
        AND (
          contact_id IN (SELECT contact_id FROM function_contacts WHERE function_id = $1)
          OR LOWER(contact_email) IN (
            SELECT LOWER(c.email) FROM contacts c
            JOIN function_contacts fc ON fc.contact_id = c.id
            WHERE fc.function_id = $1
          )
        )
      GROUP BY contact_key;
      `,
      [functionId]
    );
    const contactFeedbackMap = contactFeedbackRows.reduce((acc, row) => {
      acc[row.contact_key] = {
        responses: Number(row.responses) || 0,
        avg_overall: row.avg_overall ? Number(row.avg_overall).toFixed(2) : null,
        avg_service: row.avg_service ? Number(row.avg_service).toFixed(2) : null,
        recommend_rate:
          row.recommend_rate === null || typeof row.recommend_rate === "undefined"
            ? null
            : Math.round(Number(row.recommend_rate) * 100),
      };
      return acc;
    }, {});

    const grouped = allEntries.reduce((acc, entry) => {
      const dateKey = new Date(entry.entry_date).toISOString().split("T")[0];
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(entry);
      return acc;
    }, {});

    // 4️⃣ Render function detail view
    res.render("pages/functions/overview", {
      layout: 'layouts/main',  // ✅ use main layout again
      title: fn.event_name,
      active: "functions",
      user: req.session.user || null,
      pageType: 'function-detail',
      fn,
      linkedContacts: linkedContactsRes.rows,
      notes: notesRes.rows,
      tasks: tasksRes.rows,
      overviewNotes,
      overviewMenus,
      totals,
      communications,
      feedbackEntries: feedbackRows,
      contactFeedback: contactFeedbackMap,
      proposalId: activeProposal?.id || null,
      proposalPreviewLink: activeProposal ? `/functions/${fn.id_uuid}/proposal/preview` : null,
      proposalAuditData: proposalAudit,
      grouped,
      activeTab,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      users: usersRes.rows
    });

  } catch (err) {
    console.error("❌ [Function DETAIL] Error loading function detail:", err);
    res.status(500).send("Error loading function detail");
  }
});

/* =========================================================
   🧩 TASK MANAGEMENT (UUID-SAFE, CLEAN VERSION)
========================================================= */

// 🧭 GET: All tasks for a given function
router.get("/:id/tasks", async (req, res) => {
  const { id: functionId } = req.params;

  try {
    // 1️⃣ Fetch parent function info
    const { rows: fnRows } = await pool.query(
      `
      SELECT 
        id_uuid, event_name, event_date, status, attendees, budget, 
        totals_cost, totals_price, room_id, event_type 
      FROM functions 
      WHERE id_uuid = $1;
      `,
      [functionId]
    );

    const fn = fnRows[0];
    if (!fn) {
      console.warn(`⚠️ [Tasks GET] Function not found: ${functionId}`);
      return res.status(404).send("Function not found");
    }

    // 2️⃣ Fetch tasks
    const { rows: tasks } = await pool.query(
      `
      SELECT 
        t.*, 
        u.name AS assigned_user_name, 
        u.email AS assigned_user_email
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_user_id
      WHERE t.function_id = $1
      ORDER BY t.created_at DESC;
      `,
      [functionId]
    );

    // 3️⃣ Fetch supporting data
    const [linkedContactsRes, roomsRes, eventTypesRes, usersRes] = await Promise.all([
      pool.query(`
        SELECT 
          c.id, c.name, c.email, c.phone, c.company, fc.is_primary
        FROM contacts c
        JOIN function_contacts fc ON fc.contact_id = c.id
        WHERE fc.function_id = $1
        ORDER BY fc.is_primary DESC, c.name ASC;
      `, [functionId]),

      pool.query(`SELECT id, name, capacity FROM rooms ORDER BY name ASC;`),
      pool.query(`SELECT name FROM club_event_types ORDER BY name ASC;`),
      pool.query(`SELECT id, name FROM users ORDER BY name ASC;`)
    ]);

    // 🖥️ Render the task management page
    res.render("pages/functions/tasks", {
      layout: "layouts/main",
      title: `${fn.event_name} — Tasks`,
      pageName: 'Tasks',   // 👈 add this
      user: req.session.user || null,
      fn,
      tasks,
      linkedContacts: linkedContactsRes.rows,
      rooms: roomsRes.rows,
      eventTypes: eventTypesRes.rows,
      users: usersRes.rows,
      activeTab: "tasks"
    });

    console.log(`🧾 [Tasks GET] Loaded ${tasks.length} tasks for function ${functionId}`);

  } catch (err) {
    console.error("❌ [Tasks GET] Error:", err);
    res.status(500).send("Failed to load tasks");
  }
});


// 🆕 POST: Create a new task for a function
router.post("/:id/tasks/new", async (req, res) => {
  const { id: functionId } = req.params;
  const { title, description, assigned_to, due_at, send_email } = req.body;

  if (!title?.trim()) {
    return res.status(400).json({ success: false, error: "Task title is required" });
  }

  try {
    // 🧠 Convert frontend variable to correct type
    const assignedUserId = assigned_to ? parseInt(assigned_to, 10) : null;

    const { rows } = await pool.query(
      `
      INSERT INTO tasks (title, description, function_id, assigned_user_id, due_at, status, created_at)
      VALUES ($1, $2, $3, $4, $5, 'open', NOW())
      RETURNING *;
      `,
      [title.trim(), description || null, functionId, assignedUserId, due_at || null]
    );

    const newTask = rows[0];
    console.log(`✅ [Tasks NEW] Created task '${title}' for function ${functionId}`);

    const shouldEmailAssignee = isTruthy(send_email);
    await maybeSendTaskAssignmentEmail(req, newTask, assignedUserId, shouldEmailAssignee);

    res.json({ success: true, task: newTask });
  } catch (err) {
    console.error("❌ [Tasks NEW] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ✏️ UPDATE an existing task
router.post("/tasks/:taskId/update", async (req, res) => {
  const { taskId } = req.params;
  const { title, description, assigned_to, due_at, status, send_email } = req.body;

  try {
    const assignedUserId = assigned_to ? parseInt(assigned_to, 10) : null;

    const { rows } = await pool.query(
      `
      UPDATE tasks
      SET 
        title = $1,
        description = $2,
        assigned_user_id = $3,
        due_at = $4,
        status = COALESCE($5, status),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *;
      `,
      [title, description || null, assignedUserId, due_at || null, status || null, taskId]
    );

    const updatedTask = rows[0];
    if (!updatedTask) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    const shouldEmailAssignee = isTruthy(send_email);
    await maybeSendTaskAssignmentEmail(req, updatedTask, updatedTask.assigned_user_id, shouldEmailAssignee);

    console.log(`✏️ [Tasks UPDATE] Task ${taskId} updated successfully`);
    res.json({ success: true, task: updatedTask });
  } catch (err) {
    console.error("❌ [Tasks UPDATE] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ✅ MARK TASK AS COMPLETED
router.post("/tasks/:taskId/complete", async (req, res) => {
  const { taskId } = req.params;

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE tasks
      SET status = 'completed', updated_at = NOW()
      WHERE id = $1;
      `,
      [taskId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    console.log(`🏁 [Tasks COMPLETE] Task ${taskId} marked as completed`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Tasks COMPLETE] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// 🔁 REOPEN a completed task
router.post("/tasks/:taskId/reopen", async (req, res) => {
  const { taskId } = req.params;

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE tasks
      SET status = 'open', updated_at = NOW()
      WHERE id = $1;
      `,
      [taskId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    console.log(`🔄 [Tasks REOPEN] Task ${taskId} reopened`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Tasks REOPEN] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// 🗑️ DELETE an existing task
router.delete("/tasks/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const result = await pool.query("DELETE FROM tasks WHERE id = $1;", [taskId]);
    if (result.rowCount === 0)
      return res.status(404).json({ success: false, error: "Task not found" });

    console.log(`🗑️ [Tasks DELETE] Task ${taskId} deleted`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Tasks DELETE] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------
// Delete a function and related records
// ------------------------------------------------------
router.delete("/:functionId", async (req, res) => {
  const { functionId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: fnRows } = await client.query(
      `SELECT id_uuid FROM functions WHERE id_uuid = $1 LIMIT 1;`,
      [functionId]
    );
    if (!fnRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Function not found" });
    }

    await client.query(
      `DELETE FROM proposal_acceptance_events
         WHERE proposal_id IN (SELECT id FROM proposals WHERE function_id = $1);`,
      [functionId]
    );
    await client.query(
      `DELETE FROM proposal_items
         WHERE proposal_id IN (SELECT id FROM proposals WHERE function_id = $1);`,
      [functionId]
    );
    await client.query(
      `DELETE FROM proposal_totals
         WHERE proposal_id IN (SELECT id FROM proposals WHERE function_id = $1);`,
      [functionId]
    );
    await client.query(`DELETE FROM proposals WHERE function_id = $1;`, [functionId]);
    await client.query(`DELETE FROM function_contacts WHERE function_id = $1;`, [functionId]);
    await client.query(`DELETE FROM function_notes WHERE function_id = $1;`, [functionId]);
    await client.query(`DELETE FROM tasks WHERE function_id = $1;`, [functionId]);
    await client.query(`DELETE FROM communications WHERE function_id = $1;`, [functionId]);
    await client.query(`DELETE FROM messages WHERE related_function = $1;`, [functionId]);
    await client.query(`DELETE FROM function_menu_updates WHERE function_id = $1;`, [functionId]);
    await client.query(
      `DELETE FROM feedback_responses WHERE entity_type = 'function' AND entity_id::text = $1::text;`,
      [functionId]
    );

    await client.query(`DELETE FROM functions WHERE id_uuid = $1;`, [functionId]);

    await client.query("COMMIT");
    console.log(`🗑️ [Function DELETE] Function ${functionId} deleted`);
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ [Function DELETE] Error:", err.message);
    res.status(500).json({ success: false, error: err.message || "Failed to delete function" });
  } finally {
    client.release();
  }
});


/* =========================================================
   🕒 FUNCTION FIELD UPDATE (UUID-SAFE, TYPE-SAFE VERSION)
========================================================= */
router.post("/:id/update-field", async (req, res) => {
  const { id: functionId } = req.params; // UUID string
  let { field, value } = req.body;
  await ensureFunctionCancelColumn();
  await ensureFunctionLeadSourceColumn();

  // ✅ Define only allowed, safe-to-update columns
  const allowed = new Map([
    ["start_time", "start_time"],
    ["end_time", "end_time"],
    ["event_date", "event_date"],
    ["event_time", "event_time"],
    ["status", "status"],
    ["cancelled_reason", "cancelled_reason"],
    ["event_name", "event_name"],
    ["event_type", "event_type"],
    ["attendees", "attendees"],
    ["budget", "budget"],
    ["totals_price", "totals_price"],
    ["totals_cost", "totals_cost"],
    ["notes", "notes"],
    ["lead_source", "lead_source"],
    ["room_id", "room_id"] // integer column - handle separately
  ]);

  const column = allowed.get(field);
  if (!column) {
    console.warn(`⚠️ [Update-Field] Invalid field attempted: ${field}`);
    return res.status(400).json({ success: false, error: "Invalid field name" });
  }

  // 🧩 Normalize time formats
  if (["start_time", "end_time"].includes(column) && value && /^\d{2}:\d{2}$/.test(value)) {
    value = `${value}:00`;
  }

  // 🧩 Coerce types for numeric fields
  if (["budget", "totals_price", "totals_cost"].includes(column)) {
    value = value === "" ? null : parseFloat(value);
  }

  if (column === "room_id") {
    value = value === "" ? null : parseInt(value, 10);
  }

  // 💬 Debug logging before query
  console.log(`🛠️ [Function UPDATE-FIELD] Updating ${column} to '${value}' for function ${functionId}`);

  try {
    const query = `
      UPDATE functions 
      SET ${column} = $1, updated_at = NOW()
      WHERE id_uuid = $2
      RETURNING *;
    `;

    const { rows } = await pool.query(query, [value, functionId]);

    if (!rows.length) {
      console.warn(`⚠️ [Update-Field] Function not found for UUID: ${functionId}`);
      return res.status(404).json({ success: false, error: "Function not found" });
    }

    console.log(`✅ [Function UPDATE-FIELD] Updated ${column} successfully for ${functionId}`);
    res.json({ success: true, data: rows[0] });

  } catch (err) {
    console.error("❌ [Function UPDATE-FIELD] Error:", err.message);
    res.status(500).json({ success: false, error: "Database update failed" });
  }
});

module.exports = router;
