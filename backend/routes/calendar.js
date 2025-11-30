const express = require("express");
const { randomUUID } = require("crypto");
const { pool } = require("../db");
const { sendMail } = require("../services/graphService");
const { cca } = require("../auth/msal");
const { getValidGraphToken } = require("../utils/graphAuth");
const recurrenceService = require("../services/recurrenceService");

const router = express.Router();

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

const EVENT_TYPES = ["functions", "restaurant", "entertainment"];
const STATUS_COLOURS = {
  lead: "#CBD5F5", // muted indigo
  qualified: "#A5B4FC",
  confirmed: "#A7F3D0",
  balance_due: "#FDE68A",
  completed: "#D1D5DB",
};
const DEFAULT_DAY_SLOT_MINUTES = 30;
const RESTAURANT_STATUS_COLOURS = {
  pending: "#fde68a",
  confirmed: "#bbf7d0",
  seated: "#a5f3fc",
  completed: "#d9f99d",
  cancelled: "#fecaca",
};
const RESTAURANT_STATUSES = new Set(["pending", "confirmed", "seated", "completed", "cancelled"]);

const ONE_HOUR_MS = 60 * 60 * 1000;

function formatDateNZ(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";
  const weekday = d.toLocaleDateString("en-NZ", { weekday: "long" });
  const month = d.toLocaleDateString("en-NZ", { month: "long" });
  const year = d.getFullYear();
  return `${weekday}, ${day}${suffix} ${month} ${year}`;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatLocalDateTime(date) {
  return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
}

function normaliseDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) {
    return formatLocalDate(value);
  }
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return null;
  return formatLocalDate(date);
}

function parseTypes(raw) {
  if (!raw) return ["functions"];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  const filtered = list
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter((entry) => EVENT_TYPES.includes(entry));
  return filtered.length ? Array.from(new Set(filtered)) : ["functions"];
}

function parseRoomFilter(raw) {
  if (!raw && raw !== 0) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  return list
    .map((entry) => Number(entry))
    .filter((num) => Number.isInteger(num));
}

function normaliseTime(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  let str = String(value).trim();
  if (!str) return null;
  if (str.includes("T")) {
    str = str.split("T")[1];
  }
  if (/^\d{2}:\d{2}:\d{2}/.test(str)) {
    return str.slice(0, 8);
  }
  if (/^\d{2}:\d{2}$/.test(str)) {
    return `${str}:00`;
  }
  if (/^\d{2}$/.test(str)) {
    return `${str}:00:00`;
  }
  return null;
}

function composeDateTimeString(dateValue, timeValue) {
  const datePart = normaliseDate(dateValue);
  if (!datePart) return null;
  const timePart = normaliseTime(timeValue);
  return timePart ? `${datePart}T${timePart}` : datePart;
}

function addHour(dateTimeString) {
  if (!dateTimeString || !dateTimeString.includes("T")) return dateTimeString;
  const dateObj = new Date(dateTimeString);
  if (Number.isNaN(dateObj.getTime())) return dateTimeString;
  dateObj.setTime(dateObj.getTime() + ONE_HOUR_MS);
  return formatLocalDateTime(dateObj);
}

function mapFunctionRow(row) {
  const start = composeDateTimeString(row.event_date, row.start_time);
  let end = composeDateTimeString(row.event_date, row.end_time);
  if (!end && start && start.includes("T")) {
    end = addHour(start);
  }
  const allDay = !row.start_time && !row.end_time;
  const colour = STATUS_COLOURS[row.status] || "#6bb4de";
  const title = row.event_name || "Function";
  return {
    id: row.id_uuid,
    title,
    start,
    end,
    allDay,
    backgroundColor: colour,
    borderColor: colour,
    extendedProps: {
      type: "functions",
      sourceId: row.id_uuid,
      status: row.status,
      attendees: row.attendees || 0,
      roomId: row.room_id,
      roomName: row.room_name || "Unassigned",
      contactName: row.contact_name || "",
      functionId: row.id_uuid,
      detailUrl: `/functions/${row.id_uuid}`,
      startLabel: start || null,
      endLabel: end || null,
    },
  };
}

function isPrivileged(req) {
  const role = (req.session?.user?.role || "").toLowerCase();
  return role === "admin" || role === "owner";
}

function minutesFromTimeString(timeValue) {
  if (!timeValue) return 0;
  const [h, m] = timeValue.split(":").map((part) => parseInt(part, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function timeStringFromMinutes(totalMinutes) {
  const mins = Math.max(totalMinutes, 0);
  const hours = Math.floor(mins / 60) % 24;
  const minutes = mins % 60;
  return `${pad(hours)}:${pad(minutes)}:00`;
}

async function fetchOverrideForService(serviceId, bookingDate, db = pool) {
  const { rows } = await db.query(
    `
    SELECT max_covers_per_slot, slot_minutes
      FROM restaurant_capacity_overrides
     WHERE service_id = $1
       AND override_date = $2
     LIMIT 1;
    `,
    [serviceId, bookingDate]
  );
  return rows[0] || null;
}

function isSpecialMenuActive(service = {}, bookingDate = null) {
  if (!service || !service.special_menu_label) return false;
  if (!bookingDate) return true;
  const d = new Date(bookingDate);
  if (Number.isNaN(d.getTime())) return true;
  const start = service.special_menu_start ? new Date(service.special_menu_start) : null;
  const end = service.special_menu_end ? new Date(service.special_menu_end) : null;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

async function fetchServiceById(serviceId, db = pool) {
  const { rows } = await db.query(
    `
    SELECT id, name, day_of_week, start_time, end_time,
           slot_minutes, turn_minutes,
           max_covers_per_slot, max_online_covers,
           special_menu_label, special_menu_price, special_menu_start, special_menu_end, special_menu_only
      FROM restaurant_services
     WHERE id = $1 AND active = TRUE
     LIMIT 1;
    `,
    [serviceId]
  );
  return rows[0] || null;
}

async function findServiceForSlot(bookingDate, bookingTime, explicitServiceId, db = pool) {
  const targetDate = normaliseDate(bookingDate);
  if (!targetDate) return null;

  if (explicitServiceId) {
    const service = await fetchServiceById(explicitServiceId, db);
    if (!service) return null;
    const override = await fetchOverrideForService(service.id, targetDate, db);
    return {
      ...service,
      slot_minutes_effective: override?.slot_minutes || service.slot_minutes,
      max_covers_effective: override?.max_covers_per_slot ?? service.max_covers_per_slot,
    };
  }

  const dateObj = new Date(targetDate);
  const dow = dateObj.getDay();
  const candidateTime = normaliseTime(bookingTime) || null;

  const { rows } = await db.query(
    `
    SELECT id, name, start_time, end_time,
           slot_minutes, turn_minutes,
           max_covers_per_slot, max_online_covers,
           special_menu_label, special_menu_price, special_menu_start, special_menu_end, special_menu_only
      FROM restaurant_services
     WHERE day_of_week = $1
       AND active = TRUE
     ORDER BY start_time ASC;
    `,
    [dow]
  );

  for (const service of rows) {
    if (!candidateTime) {
      const override = await fetchOverrideForService(service.id, targetDate, db);
      return {
        ...service,
        slot_minutes_effective: override?.slot_minutes || service.slot_minutes,
        max_covers_effective: override?.max_covers_per_slot ?? service.max_covers_per_slot,
      };
    }
    const withinWindow =
      candidateTime >= service.start_time && candidateTime <= service.end_time;
    if (withinWindow) {
      const override = await fetchOverrideForService(service.id, targetDate, db);
      return {
        ...service,
        slot_minutes_effective: override?.slot_minutes || service.slot_minutes,
        max_covers_effective: override?.max_covers_per_slot ?? service.max_covers_per_slot,
      };
    }
  }
  return null;
}

function computeSlotBounds(service, bookingTime) {
  const slotMinutes = service.slot_minutes_effective || service.slot_minutes || DEFAULT_DAY_SLOT_MINUTES;
  const serviceStart = minutesFromTimeString(service.start_time);
  const serviceEnd = minutesFromTimeString(service.end_time);
  const requested = bookingTime ? minutesFromTimeString(bookingTime) : serviceStart;
  if (requested < serviceStart) {
    const slotStart = serviceStart;
    return { slotStart, slotEnd: slotStart + slotMinutes };
  }
  if (requested >= serviceEnd) {
    return { slotStart: serviceEnd - slotMinutes, slotEnd: serviceEnd };
  }
  const offset = requested - serviceStart;
  const slotIndex = Math.floor(offset / slotMinutes);
  const slotStart = serviceStart + slotIndex * slotMinutes;
  let slotEnd = slotStart + slotMinutes;
  if (slotEnd > serviceEnd) slotEnd = serviceEnd;
  return { slotStart, slotEnd };
}

async function ensureRestaurantCapacity(
  {
    bookingDate,
    service,
    slotStart,
    slotEnd,
    partySize,
    channel,
  },
  db = pool
) {
  if (!partySize || partySize <= 0) return;
  const limits = {
    total: service.max_covers_effective || service.max_covers_per_slot || null,
    online: service.max_online_covers || null,
  };
  const startTime = timeStringFromMinutes(slotStart);
  const endTime = timeStringFromMinutes(slotEnd);
  const { rows } = await db.query(
    `
    SELECT COALESCE(SUM(size), 0) AS covers
      FROM restaurant_bookings
     WHERE booking_date = $1
       AND service_id = $2
       AND booking_time >= $3::time
       AND booking_time < $4::time
       AND COALESCE(status, 'pending') NOT IN ('cancelled', 'no_show');
    `,
    [bookingDate, service.id, startTime, endTime]
  );
  const currentCovers = Number(rows[0]?.covers || 0);
  const totalLimit = limits.total;
  if (totalLimit && currentCovers + partySize > totalLimit) {
    throw new Error("No capacity remaining for this slot.");
  }
  if (channel === "online") {
    const onlineLimit = limits.online;
    if (onlineLimit && currentCovers + partySize > onlineLimit) {
      throw new Error("Online allocation for this slot is full.");
    }
  }
}

function mapRestaurantBookingRow(row) {
  const date = normaliseDate(row.booking_date);
  const time = normaliseTime(row.booking_time) || row.service_start || "00:00:00";
  const start = composeDateTimeString(date, time);
  const slotMinutes = row.slot_minutes_override || row.slot_minutes || DEFAULT_DAY_SLOT_MINUTES;
  const slotEnd = timeStringFromMinutes(minutesFromTimeString(time) + slotMinutes);
  const end = composeDateTimeString(date, slotEnd);
  const colour =
    RESTAURANT_STATUS_COLOURS[(row.status || "").toLowerCase()] || "#f9a8d4";
  return {
    id: `restaurant-${row.id}`,
    title: `${row.party_name} (${row.size || 0})`,
    start,
    end,
    backgroundColor: colour,
    borderColor: colour,
    extendedProps: {
      type: "restaurant",
      sourceId: row.id,
      status: row.status,
      channel: row.channel,
      zone: row.zone_name,
      table: row.table_label,
      notes: row.notes,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone,
      partySize: row.size,
      roomName: row.zone_name || row.table_label || "Restaurant",
      detailUrl: row.id ? `/calendar/restaurant/bookings/${row.id}` : null,
    },
  };
}

function mapEntertainmentEventRow(row) {
  const start = row.start_at ? new Date(row.start_at).toISOString() : null;
  const end = row.end_at ? new Date(row.end_at).toISOString() : null;
  const colour = "#fbcfe8";
  const priceValue = row.price !== null && row.price !== undefined ? Number(row.price) : null;
  return {
    id: `entertainment-${row.id}`,
    title: row.title,
    start,
    end,
    backgroundColor: colour,
    borderColor: colour,
    extendedProps: {
      type: "entertainment",
      sourceId: row.id,
      organiser: row.organiser,
      price: priceValue,
      currency: row.currency || "NZD",
      link: row.external_url,
      roomId: row.room_id || null,
      roomName: row.room_name || "Entertainment",
      detailUrl: `/entertainment/${row.slug || row.id}`,
    },
  };
}

async function createRestaurantBooking(payload, options = {}) {
  const partyName = (payload.partyName || "").trim();
  const bookingDate = normaliseDate(payload.bookingDate);
  const bookingTime = normaliseTime(payload.bookingTime);
  const size = parseInt(payload.size, 10) || 0;
  const explicitServiceId = payload.serviceId ? Number(payload.serviceId) : null;
  const zoneId = payload.zoneId ? Number(payload.zoneId) : null;
  const tableId = payload.tableId ? Number(payload.tableId) : null;
  if (!partyName) throw new Error("Party name is required.");
  if (!bookingDate) throw new Error("Booking date is invalid.");
  if (!bookingTime) throw new Error("Booking time is required.");
  if (!size) throw new Error("Party size is required.");

  const db = options.db || pool;
  const service = await findServiceForSlot(bookingDate, bookingTime, explicitServiceId, db);
  if (!service) {
    throw new Error("No service matches the requested time.");
  }

  const contactId =
    options.contactId ||
    (await ensureContactFromBooking(
      partyName,
      payload.contactEmail || payload.contact_email,
      payload.contactPhone || payload.contact_phone
    ));

  const { slotStart, slotEnd } = computeSlotBounds(service, bookingTime);
  await ensureRestaurantCapacity(
    {
      bookingDate,
      service,
      slotStart,
      slotEnd,
      partySize: size,
      channel: payload.channel || "internal",
    },
    db
  );

  const result = await db.query(
    `
    INSERT INTO restaurant_bookings
      (party_name, booking_date, booking_time, size, status, menu_type, price,
       owner_id, service_id, zone_id, table_id, channel,
       contact_email, contact_phone, contact_id, notes, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
    RETURNING *;
    `,
    [
      partyName,
      bookingDate,
      timeStringFromMinutes(slotStart).slice(0, 8),
      size,
      payload.status || "pending",
      payload.ownerId || null,
      service.id,
      zoneId,
      tableId,
      payload.channel || "internal",
      payload.contactEmail || null,
      payload.contactPhone || null,
      contactId || null,
      payload.notes || null,
    ]
  );

  const booking = result.rows[0];
  if (!options.suppressEmail) {
    notifyRestaurantTeam(booking, service, options.req).catch((err) => {
      console.error("[Restaurant Calendar] Failed to send booking email:", err.message);
    });
    if (booking.contact_email) {
      notifyRestaurantCustomer(booking, service, "request", options.req).catch((err) => {
        console.error("[Restaurant Calendar] Failed to send customer email:", err.message);
      });
    }
  }

  return { booking, service };
}

async function notifyRestaurantTeam(booking, service, req = null) {
  try {
    const accessToken = (req && (await tryGetDelegatedToken(req))) || (await acquireGraphToken());
    if (!accessToken) throw new Error("Missing Graph token (delegated)");
    const to = process.env.RESTAURANT_NOTIFICATIONS || "events@poriruaclub.co.nz";
    const subject = `🍽️ New Restaurant Booking: ${booking.party_name} (${booking.size || 0})`;
    const details = [
      `<strong>Name:</strong> ${booking.party_name}`,
      `<strong>Date:</strong> ${formatDateNZ(booking.booking_date)}`,
      `<strong>Time:</strong> ${booking.booking_time || "TBC"}`,
      `<strong>Guests:</strong> ${booking.size || 0}`,
      `<strong>Status:</strong> ${booking.status || "pending"}`,
      `<strong>Channel:</strong> ${booking.channel || "internal"}`,
      `<strong>Service:</strong> ${service?.name || "Auto"}`,
    ];
    if (isSpecialMenuActive(service, booking.booking_date)) {
      const price = service?.special_menu_price ? ` ($${Number(service.special_menu_price).toFixed(2)})` : "";
      details.push(`<strong>Menu:</strong> ${service.special_menu_label}${price}`);
    }
    if (booking.contact_email) details.push(`<strong>Email:</strong> ${booking.contact_email}`);
    if (booking.contact_phone) details.push(`<strong>Phone:</strong> ${booking.contact_phone}`);
    if (booking.notes) details.push(`<strong>Notes:</strong> ${booking.notes}`);

    const body = `
      <p>A new restaurant booking has been submitted.</p>
      <p>${details.join("<br>")}</p>
      <p><a href="${process.env.APP_URL || "https://portal.poriruaclub.co.nz"}/calendar/restaurant">View calendar</a></p>
    `;

    await sendMail(accessToken, {
      to,
      subject,
      body,
      fromMailbox: process.env.RESTAURANT_MAILBOX || process.env.SHARED_MAILBOX || "bookings@poriruaclub.co.nz",
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Booking email skipped:", err.message);
  }
}

async function notifyRestaurantCustomer(booking, service, template = "request", req = null) {
  try {
    const accessToken = (req && (await tryGetDelegatedToken(req))) || (await acquireGraphToken());
    if (!accessToken || !booking?.contact_email) return;
    const subject =
      template === "confirm"
        ? "Restaurant booking confirmation"
        : "Restaurant booking request received";
    const details = [
      `<strong>Name:</strong> ${booking.party_name}`,
      `<strong>Date:</strong> ${formatDateNZ(booking.booking_date)}`,
      `<strong>Time:</strong> ${booking.booking_time || "TBC"}`,
      `<strong>Guests:</strong> ${booking.size || 0}`,
      `<strong>Service:</strong> ${service?.name || "Restaurant"}`,
    ];
    if (isSpecialMenuActive(service, booking.booking_date)) {
      const price = service?.special_menu_price ? ` ($${Number(service.special_menu_price).toFixed(2)})` : "";
      details.push(`<strong>Menu:</strong> ${service.special_menu_label}${price}`);
    }
    const intro =
      template === "confirm"
        ? "<p>Your restaurant booking has been confirmed. We look forward to seeing you.</p>"
        : "<p>Thank you for your reservation request. We will confirm availability as soon as possible.</p>";

    const body = `
      ${intro}
      <p>${details.join("<br>")}</p>
      <p>If you need to make changes, please contact us.</p>
    `;

    await sendMail(accessToken, {
      to: booking.contact_email,
      subject,
      body,
      fromMailbox: process.env.RESTAURANT_MAILBOX || process.env.SHARED_MAILBOX || "bookings@poriruaclub.co.nz",
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Customer email skipped:", err.message);
  }
}

async function fetchRestaurantBookingsBetween(startDate, endDate) {
  const params = [];
  const where = [];
  if (startDate) {
    params.push(startDate);
    where.push(`b.booking_date >= $${params.length}`);
  }
  if (endDate) {
    params.push(endDate);
    where.push(`b.booking_date <= $${params.length}`);
  }
  const query = `
    SELECT b.*,
           s.name AS service_name,
           s.slot_minutes,
           s.start_time AS service_start,
           s.end_time AS service_end,
           z.name AS zone_name,
           t.label AS table_label,
           COALESCE(o.slot_minutes, s.slot_minutes) AS slot_minutes_override
      FROM restaurant_bookings b
      LEFT JOIN restaurant_services s ON s.id = b.service_id
      LEFT JOIN restaurant_zones z ON z.id = b.zone_id
      LEFT JOIN restaurant_tables t ON t.id = b.table_id
      LEFT JOIN restaurant_capacity_overrides o
             ON o.service_id = b.service_id AND o.override_date = b.booking_date
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY b.booking_date ASC, COALESCE(b.booking_time, '00:00:00') ASC
  `;
  const { rows } = await pool.query(query, params);
  return rows;
}

async function fetchEntertainmentEventsBetween(startDate, endDate, roomIds = []) {
  const params = [];
  const where = [`status = 'published'`];
  if (startDate) {
    params.push(startDate);
    where.push(`start_at >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    where.push(`start_at <= $${params.length}::date`);
  }
  if (roomIds?.length) {
    params.push(roomIds);
    where.push(`room_id = ANY($${params.length}::int[])`);
  }
  const query = `
    SELECT e.*, r.name AS room_name
      FROM entertainment_events e
      LEFT JOIN rooms r ON r.id = e.room_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY start_at ASC;
  `;
  const { rows } = await pool.query(query, params);
  return rows;
}

async function fetchCalendarSettings() {
  try {
    const { rows } = await pool.query(`SELECT day_slot_minutes FROM calendar_settings LIMIT 1`);
    const value = rows[0]?.day_slot_minutes;
    const minutes = Number.isFinite(value) ? Number(value) : parseInt(value, 10);
    if (!minutes || Number.isNaN(minutes)) return DEFAULT_DAY_SLOT_MINUTES;
    return Math.min(Math.max(minutes, 5), 240);
  } catch (err) {
    console.warn("[Calendar] Unable to load settings, using default:", err.message);
    return DEFAULT_DAY_SLOT_MINUTES;
  }
}

async function ensureContactFromBooking(name, email, phone) {
  if (!email) return null;
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

async function tryGetDelegatedToken(req) {
  try {
    if (!req || !req.session) return null;
    const now = Date.now();
    const expMs = req.session.graphTokenExpires ? req.session.graphTokenExpires * 1000 : null;
    const isFresh = expMs ? expMs > now : true;
    const token =
      req.session.graphAccessToken ||
      req.session.graphToken ||
      (req.session.graph && req.session.graph.accessToken);
    if (token && isFresh) return token;
    return await getValidGraphToken(req);
  } catch (err) {
    console.warn("[Calendar] Delegated token fetch failed:", err.message);
    return null;
  }
}

async function acquireGraphToken() {
  if (!cca) return null;
  try {
    const response = await cca.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    return response?.accessToken || null;
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to acquire Graph token:", err.message);
    return null;
  }
}

router.get("/", async (req, res) => {
  try {
    const daySlotMinutes = await fetchCalendarSettings();
    const { rows: rooms } = await pool.query(
      `SELECT id, name, capacity
         FROM rooms
        ORDER BY name ASC`
    );

    res.render("pages/calendar/index", {
      layout: "layouts/main",
      title: "Calendar",
      active: "calendar",
      pageType: "calendar",
      rooms,
      calendarConfig: {
        daySlotMinutes,
      },
      pageCss: ["https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css"],
      pageJs: [
        "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js",
        "/js/calendar/index.js",
      ],
    });
  } catch (err) {
    console.error("[Calendar] Failed to load calendar page:", err);
    res.status(500).send("Unable to load calendar.");
  }
});

router.get("/events", async (req, res) => {
  try {
    const types = parseTypes(req.query.include);
    const includeFunctions = types.includes("functions");
    const includeRestaurant = types.includes("restaurant");
    const includeEntertainment = types.includes("entertainment");
    const roomIds = parseRoomFilter(req.query.rooms);
    const startDate = normaliseDate(req.query.start);
    const endDate = normaliseDate(req.query.end);

    const events = [];

    if (includeFunctions) {
      const whereParts = ["f.event_date IS NOT NULL"];
      const params = [];

      if (startDate) {
        params.push(startDate);
        whereParts.push(`f.event_date >= $${params.length}`);
      }
      if (endDate) {
        params.push(endDate);
        whereParts.push(`f.event_date <= $${params.length}`);
      }
      if (roomIds.length) {
        params.push(roomIds);
        whereParts.push(`f.room_id = ANY($${params.length}::int[])`);
      }

      const query = `
        SELECT
          f.id_uuid,
          f.event_name,
          f.event_date,
          f.start_time,
          f.end_time,
          f.status,
          f.attendees,
          r.name AS room_name,
          r.id AS room_id,
          c.name AS contact_name
        FROM functions f
        LEFT JOIN rooms r ON r.id = f.room_id
        LEFT JOIN function_contacts fc
          ON fc.function_id = f.id_uuid AND COALESCE(fc.is_primary, FALSE) = TRUE
        LEFT JOIN contacts c ON c.id = fc.contact_id
        ${whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""}
        ORDER BY f.event_date ASC, COALESCE(f.start_time, '00:00:00') ASC
      `;

      const { rows } = await pool.query(query, params);
      rows.forEach((row) => {
        const event = mapFunctionRow(row);
        events.push(event);
      });
    }

    if (includeRestaurant) {
      const bookings = await fetchRestaurantBookingsBetween(startDate, endDate);
      bookings.forEach((row) => events.push(mapRestaurantBookingRow(row)));
    }

    if (includeEntertainment) {
      const shows = await fetchEntertainmentEventsBetween(startDate, endDate, roomIds);
      shows.forEach((row) => events.push(mapEntertainmentEventRow(row)));
    }

    res.json(events);
  } catch (err) {
    console.error("[Calendar] Failed to load events:", err);
    res.status(500).json({ success: false, error: "Unable to load calendar events." });
  }
});

router.get("/restaurant", async (req, res) => {
  try {
    const [servicesRes, zonesRes, tablesRes, bookingsRes] = await Promise.all([
      pool.query(
        `SELECT id, name, day_of_week, start_time, end_time, slot_minutes, max_covers_per_slot,
                special_menu_label, special_menu_price, special_menu_start, special_menu_end, special_menu_only
           FROM restaurant_services
          WHERE active = TRUE
          ORDER BY day_of_week, start_time;`
      ),
      pool.query(
        `SELECT id, name
           FROM restaurant_zones
          ORDER BY name ASC;`
      ),
      pool.query(
        `SELECT id, label, zone_id
           FROM restaurant_tables
          WHERE active = TRUE
          ORDER BY label ASC;`
      ),
      pool.query(
        `
        SELECT b.id,
               b.party_name,
               b.booking_date,
               b.booking_time,
               b.size,
               b.status,
               b.created_at,
               s.name AS service_name,
               s.special_menu_label,
               s.special_menu_price,
               s.special_menu_start,
               s.special_menu_end,
               s.special_menu_only
          FROM restaurant_bookings b
     LEFT JOIN restaurant_services s ON s.id = b.service_id
         WHERE b.booking_date >= CURRENT_DATE - INTERVAL '1 day'
         ORDER BY CASE WHEN LOWER(b.status) = 'pending' THEN 0 ELSE 1 END,
                  b.booking_date ASC,
                  b.booking_time ASC,
                  b.id ASC
         LIMIT 20;
        `
      ),
    ]);

    res.render("pages/calendar/restaurant", {
      layout: "layouts/main",
      title: "Restaurant Calendar",
      active: "restaurant",
      pageType: "calendar",
      services: servicesRes.rows,
      zones: zonesRes.rows,
      tables: tablesRes.rows,
      upcomingBookings: bookingsRes.rows,
      canManage: isPrivileged(req),
      message: req.query.success ? "Booking saved." : null,
      errorMessage: req.query.error || null,
      prefillBooking: {
        booking_date: req.query.booking_date || req.query.prefill_date || "",
        booking_time: req.query.booking_time || req.query.prefill_time || "",
        party_name: req.query.party_name || "",
        size: req.query.size || "",
        status: req.query.status || "confirmed",
      },
      calendarConfig: {
        daySlotMinutes: await fetchCalendarSettings(),
      },
      pageCss: ["https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css"],
      pageJs: [
        "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js",
        "/js/calendar/restaurant.js",
      ],
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to load page:", err);
    res.status(500).send("Unable to load restaurant calendar.");
  }
});

router.get("/restaurant/bookings", async (req, res) => {
  if (!isPrivileged(req)) {
    return res.redirect("/calendar/restaurant?error=Admin%20access%20required");
  }
  try {
    const statusFilter = (req.query.status || "pending").toLowerCase();
    const showAll = statusFilter === "all";
    const bookings = await fetchRestaurantBookingsBetween(null, null);
    const filtered = showAll
      ? bookings
      : bookings.filter((b) => (b.status || "pending").toLowerCase() === statusFilter);
    res.render("pages/calendar/restaurant-bookings", {
      layout: "layouts/main",
      title: "Restaurant Bookings",
      active: "restaurant",
      bookings: filtered,
      filter: statusFilter,
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to load booking list:", err);
    res.status(500).send("Unable to load bookings.");
  }
});

router.get("/restaurant/events", async (req, res) => {
  try {
    const startDate = normaliseDate(req.query.start);
    const endDate = normaliseDate(req.query.end);
    const bookings = await fetchRestaurantBookingsBetween(startDate, endDate);
    const events = bookings.map((row) => mapRestaurantBookingRow(row));
    res.json(events);
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to load events:", err);
    res.status(500).json({ success: false, error: "Unable to load restaurant events." });
  }
});

router.post("/restaurant/bookings", async (req, res) => {
  if (!isPrivileged(req)) {
    return res.redirect("/calendar/restaurant?error=Admin access required");
  }
  const recurrence = recurrenceService.parseRecurrenceForm(req.body);
  const payload = {
    partyName: req.body.party_name,
    bookingDate: req.body.booking_date,
    bookingTime: req.body.booking_time,
    size: req.body.size,
    serviceId: req.body.service_id ? Number(req.body.service_id) : null,
    zoneId: req.body.zone_id ? Number(req.body.zone_id) : null,
    tableId: req.body.table_id ? Number(req.body.table_id) : null,
    notes: req.body.notes,
    contactEmail: req.body.contact_email,
    contactPhone: req.body.contact_phone,
    channel: "internal",
    status: req.body.status || "confirmed",
    ownerId: req.session.user?.id || null,
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await createRestaurantBooking(payload, { db: client });
    await client.query("COMMIT");
    res.redirect("/calendar/restaurant?success=1");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Restaurant Calendar] Failed to create booking:", err);
    const message = encodeURIComponent(err.message || "Unable to save booking");
    res.redirect(`/calendar/restaurant?error=${message}`);
  } finally {
    client.release();
  }
});

router.get("/restaurant/book", async (req, res) => {
  try {
    const embed = req.query.embed === "1";
    const { rows: services } = await pool.query(
      `SELECT id, name, day_of_week, start_time, end_time,
              special_menu_label, special_menu_price, special_menu_start, special_menu_end, special_menu_only
         FROM restaurant_services
        WHERE active = TRUE
        ORDER BY day_of_week, start_time;`
    );
    res.render("pages/calendar/restaurant-book", {
      layout: embed ? false : "layouts/main",
      title: "Book the Restaurant",
      active: "restaurant",
      services,
      success: req.query.success || null,
      errorMessage: req.query.error || null,
      embed,
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to load booking form:", err);
    res.status(500).send("Unable to load booking form.");
  }
});

router.post("/restaurant/book", async (req, res) => {
  try {
    const embed = req.query.embed === "1";
    await createRestaurantBooking({
      partyName: req.body.party_name,
      bookingDate: req.body.booking_date,
      bookingTime: req.body.booking_time,
      size: req.body.size,
      serviceId: req.body.service_id ? Number(req.body.service_id) : null,
      notes: req.body.notes,
      contactEmail: req.body.contact_email,
      contactPhone: req.body.contact_phone,
      channel: "online",
      status: "pending",
    });
    const successUrl = embed
      ? "/calendar/restaurant/book?embed=1&success=1"
      : "/calendar/restaurant/book?success=1";
    res.redirect(successUrl);
  } catch (err) {
    console.error("[Restaurant Calendar] Public booking failed:", err);
    const message = encodeURIComponent(err.message || "Unable to submit booking");
    const embedPrefix = req.query.embed === "1" ? "embed=1&" : "";
    res.redirect(`/calendar/restaurant/book?${embedPrefix}error=${message}`);
  }
});

router.get("/restaurant/bookings/:id", async (req, res) => {
  if (!isPrivileged(req)) {
    return res.redirect("/calendar/restaurant?error=Admin%20access%20required");
  }
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) throw new Error("Missing booking id");
    const { rows } = await pool.query(
      `
      SELECT b.*,
             s.name AS service_name,
             s.day_of_week,
             s.start_time AS service_start,
             s.end_time AS service_end,
             s.special_menu_label,
             s.special_menu_price,
             s.special_menu_start,
             s.special_menu_end,
             s.special_menu_only,
             z.name AS zone_name,
             t.label AS table_label
        FROM restaurant_bookings b
        LEFT JOIN restaurant_services s ON s.id = b.service_id
        LEFT JOIN restaurant_zones z ON z.id = b.zone_id
        LEFT JOIN restaurant_tables t ON t.id = b.table_id
       WHERE b.id = $1
       LIMIT 1;
      `,
      [bookingId]
    );
    const booking = rows[0];
    if (!booking) return res.status(404).send("Booking not found");
    res.render("pages/calendar/restaurant-booking-detail", {
      layout: "layouts/main",
      title: `Booking · ${booking.party_name}`,
      active: "restaurant",
      booking,
      success: req.query.success || null,
      errorMessage: req.query.error || null,
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to load booking detail:", err);
    res.status(500).send("Unable to load booking detail.");
  }
});

router.post("/restaurant/bookings/:id/status", async (req, res) => {
  if (!isPrivileged(req)) {
    return res.redirect("/calendar/restaurant?error=Admin%20access%20required");
  }
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) throw new Error("Missing booking id");
    const newStatus = (req.body.status || "").trim().toLowerCase();
    if (!RESTAURANT_STATUSES.has(newStatus)) throw new Error("Status required");
    const { rows: existingRows } = await pool.query(
      `SELECT contact_email, party_name, booking_date, booking_time, size, service_id
         FROM restaurant_bookings
        WHERE id = $1
        LIMIT 1;`,
      [bookingId]
    );
    const existing = existingRows[0] || null;

    await pool.query(
      `
      UPDATE restaurant_bookings
         SET status = $1,
             notes = COALESCE($2, notes),
             confirmation_sent_at = CASE WHEN $1 = 'confirmed' THEN NOW() ELSE confirmation_sent_at END,
             updated_at = NOW()
       WHERE id = $3;
      `,
      [newStatus, req.body.notes || null, bookingId]
    );

    if (newStatus === "confirmed" && existing?.contact_email) {
      // Fetch service info for email
      let service = null;
      if (existing.service_id) {
        const { rows } = await pool.query(
          `SELECT id, name FROM restaurant_services WHERE id = $1 LIMIT 1;`,
          [existing.service_id]
        );
        service = rows[0] || null;
      }
      notifyRestaurantCustomer(
        {
          ...existing,
          status: newStatus,
        },
        service,
        "confirm"
      ).catch((err) => console.error("[Restaurant Calendar] Confirm email failed:", err.message));
    }

    res.redirect(`/calendar/restaurant/bookings/${bookingId}?success=1`);
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to update booking status:", err);
    const message = encodeURIComponent(err.message || "Unable to update booking");
    res.redirect(`/calendar/restaurant/bookings/${req.params.id}?error=${message}`);
  }
});

async function fetchFunctionWithContact(functionId, db = pool) {
  const { rows } = await db.query(
    `
    SELECT f.*, c.email AS contact_email, c.phone AS contact_phone
      FROM functions f
      LEFT JOIN function_contacts fc
        ON fc.function_id = f.id_uuid AND COALESCE(fc.is_primary, FALSE) = TRUE
      LEFT JOIN contacts c ON c.id = fc.contact_id
     WHERE f.id_uuid = $1
     LIMIT 1;
    `,
    [functionId]
  );
  return rows[0] || null;
}

async function convertFunctionToRestaurant(functionId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fn = await fetchFunctionWithContact(functionId, client);
    if (!fn) throw new Error("Function not found");
    if (!fn.event_date) {
      throw new Error("Function is missing a date.");
    }
    const startTime = fn.start_time || fn.event_time || "00:00:00";
    const { booking } = await createRestaurantBooking(
      {
        partyName: fn.event_name || "Function",
        bookingDate: fn.event_date,
        bookingTime: startTime,
        size: fn.attendees || 0,
        notes: `Converted from function ${fn.event_name || ""}`.trim(),
        contactEmail: fn.contact_email || null,
        contactPhone: fn.contact_phone || null,
        ownerId: userId || null,
        status: "confirmed",
        channel: "internal",
      },
      { db: client, suppressEmail: true }
    );
    await client.query(`DELETE FROM functions WHERE id_uuid = $1;`, [functionId]);
    await client.query("COMMIT");
    return { detailUrl: `/calendar/restaurant/bookings/${booking.id}` };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function convertFunctionToEntertainment(functionId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fn = await fetchFunctionWithContact(functionId, client);
    if (!fn) throw new Error("Function not found");
    if (!fn.event_date) throw new Error("Function is missing a date.");
    const startAt = composeDateTimeString(fn.event_date, fn.start_time || fn.event_time || "00:00:00");
    const endAt = fn.end_time ? composeDateTimeString(fn.event_date, fn.end_time) : null;
    const slug = `${slugify(fn.event_name) || "event"}-${functionId.slice(0, 6)}`;
    const insert = await client.query(
      `
      INSERT INTO entertainment_events
        (title, slug, adjunct_name, external_url, organiser, room_id, price, description,
         image_url, start_at, end_at, status, created_by, updated_by, created_at, updated_at)
      VALUES
        ($1,$2,NULL,NULL,$3,$4,NULL,NULL,NULL,$5,$6,'scheduled',$7,$7,NOW(),NOW())
      RETURNING id;
      `,
      [
        fn.event_name || "Club event",
        slug,
        fn.owner_id ? `Owner #${fn.owner_id}` : null,
        fn.room_id || null,
        startAt,
        endAt,
        userId || null,
      ]
    );
    const eventId = insert.rows[0]?.id;
    await client.query(`DELETE FROM functions WHERE id_uuid = $1;`, [functionId]);
    await client.query("COMMIT");
    const detailSlug = eventId ? `${slug}` : "";
    return { detailUrl: `/entertainment/${detailSlug || eventId}` };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function convertRestaurantToFunction(bookingId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      SELECT *
        FROM restaurant_bookings
       WHERE id = $1
       LIMIT 1;
      `,
      [bookingId]
    );
    const booking = rows[0];
    if (!booking) throw new Error("Booking not found");
    const fnId = randomUUID();
    const statusMap = {
      pending: "lead",
      confirmed: "confirmed",
      seated: "qualified",
      completed: "completed",
    };
    const statusValue = statusMap[(booking.status || "").toLowerCase()] || "lead";
    await client.query(
      `
      INSERT INTO functions (
        id_uuid, event_name, status, event_date, start_time, end_time,
        attendees, room_id, event_type, owner_id, created_at, updated_at, updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,NULL,$6,NULL,$7,$8,NOW(),NOW(),$8
      );
      `,
      [
        fnId,
        booking.party_name || "Restaurant booking",
        statusValue,
        booking.booking_date,
        booking.booking_time || null,
        booking.size || 0,
        "Restaurant Booking",
        userId || null,
      ]
    );
    await client.query(`DELETE FROM restaurant_bookings WHERE id = $1;`, [bookingId]);
    await client.query("COMMIT");
    return { detailUrl: `/functions/${fnId}` };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function convertEntertainmentToFunction(eventId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      SELECT *
        FROM entertainment_events
       WHERE id = $1
       LIMIT 1;
      `,
      [eventId]
    );
    const event = rows[0];
    if (!event) throw new Error("Event not found");
    const fnId = randomUUID();
    const startDate = event.start_at ? new Date(event.start_at) : null;
    const datePart = startDate ? formatLocalDate(startDate) : null;
    const timePart = startDate ? `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}:00` : null;
    await client.query(
      `
      INSERT INTO functions (
        id_uuid, event_name, status, event_date, start_time, end_time,
        attendees, room_id, event_type, owner_id, created_at, updated_at, updated_by
      )
      VALUES (
        $1,$2,'lead',$3,$4,$5,0,NULL,'Entertainment',$6,NOW(),NOW(),$6
      );
      `,
      [fnId, event.title || "Entertainment", datePart, timePart, null, userId || null]
    );
    await client.query(`DELETE FROM entertainment_events WHERE id = $1;`, [eventId]);
    await client.query("COMMIT");
    return { detailUrl: `/functions/${fnId}` };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

router.post("/convert", async (req, res) => {
  if (!isPrivileged(req)) {
    return res.status(403).json({ success: false, error: "Admin access required" });
  }
  try {
    const { sourceType, sourceId, targetType } = req.body || {};
    if (!sourceType || !sourceId || !targetType) {
      throw new Error("Missing conversion details.");
    }
    let result;
    if (sourceType === "functions" && targetType === "restaurant") {
      result = await convertFunctionToRestaurant(sourceId, req.session.user?.id || null);
    } else if (sourceType === "functions" && targetType === "entertainment") {
      result = await convertFunctionToEntertainment(sourceId, req.session.user?.id || null);
    } else if (sourceType === "restaurant" && targetType === "functions") {
      result = await convertRestaurantToFunction(Number(sourceId), req.session.user?.id || null);
    } else if (sourceType === "entertainment" && targetType === "functions") {
      result = await convertEntertainmentToFunction(Number(sourceId), req.session.user?.id || null);
    } else {
      throw new Error("Conversion not supported.");
    }
    res.json({ success: true, detailUrl: result?.detailUrl || null });
  } catch (err) {
    console.error("[Calendar] Conversion failed:", err);
    res.status(400).json({ success: false, error: err.message || "Unable to convert" });
  }
});

module.exports = router;
