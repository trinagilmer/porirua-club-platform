const express = require("express");
const { randomUUID } = require("crypto");
const { pool } = require("../db");
const { sendMail } = require("../services/graphService");
const { getAppToken } = require("../utils/graphAuth");
const recurrenceService = require("../services/recurrenceService");
const { replaceTokens } = require("../services/templateRenderer");
const {
  DEFAULT_RESTAURANT_EMAIL_TEMPLATES,
  getRestaurantSettings,
} = require("../services/restaurantSettings");
const { ensureRestaurantServiceBookingLimitColumn } = require("../services/restaurantServiceSchema");
const {
  exceedsOnlinePartySize,
  isCapacityError,
} = require("../utils/restaurantBookingRules");

const router = express.Router();

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

const EVENT_TYPES = ["functions", "restaurant", "entertainment"];
const FUNCTION_STATUSES = [
  "lead",
  "qualified",
  "confirmed",
  "balance_due",
  "completed",
  "cancelled",
];
const DEFAULT_FUNCTION_STATUS_FILTER = [
  "lead",
  "qualified",
  "confirmed",
  "balance_due",
  "completed",
];
const STATUS_COLOURS = {
  lead: "#CBD5F5", // muted indigo
  qualified: "#A5B4FC",
  confirmed: "#A7F3D0",
  balance_due: "#FDE68A",
  completed: "#D1D5DB",
};
const ROOM_COLOUR_FALLBACKS = [
  "#6bb4de",
  "#59c27a",
  "#f5c044",
  "#e25b5b",
  "#8b6fde",
  "#4a9ecc",
  "#d86aa1",
  "#5bbbd6",
];

function getRoomColourFallback(roomId) {
  if (!roomId && roomId !== 0) return ROOM_COLOUR_FALLBACKS[0];
  const key = String(roomId);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  }
  return ROOM_COLOUR_FALLBACKS[hash % ROOM_COLOUR_FALLBACKS.length];
}
const DEFAULT_DAY_SLOT_MINUTES = 30;
const RESTAURANT_STATUS_COLOURS = {
  pending: "#fde68a",
  confirmed: "#bbf7d0",
  seated: "#a5f3fc",
  completed: "#d9f99d",
  cancelled: "#fecaca",
};
const RESTAURANT_STATUSES = new Set(["pending", "confirmed", "seated", "completed", "cancelled"]);

async function ensureEntertainmentFunctionLinkColumn() {
  await pool.query(
    "ALTER TABLE entertainment_events ADD COLUMN IF NOT EXISTS function_id UUID;"
  );
  await pool.query(
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'entertainment_events_function_id_fkey'
      ) THEN
        ALTER TABLE entertainment_events
          ADD CONSTRAINT entertainment_events_function_id_fkey
          FOREIGN KEY (function_id)
          REFERENCES functions(id_uuid)
          ON DELETE SET NULL;
      END IF;
    END $$;
    `
  );
}

async function ensureFunctionEndDateColumn() {
  await pool.query("ALTER TABLE functions ADD COLUMN IF NOT EXISTS end_date DATE;");
}

async function ensureFunctionRoomAllocationsTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS function_room_allocations (
      id SERIAL PRIMARY KEY,
      function_id UUID NOT NULL REFERENCES functions(id_uuid) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      start_at TIMESTAMP WITHOUT TIME ZONE NULL,
      end_at TIMESTAMP WITHOUT TIME ZONE NULL,
      notes TEXT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    );
  `);
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const CAPACITY_CONTACT_MESSAGE =
  "please contact the restaurant to complete this booking email:  chef@poriruaclub.co.nz or phone 04 237 6143 ext 2";

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

function parseFunctionStatusFilter(raw) {
  if (!raw) return DEFAULT_FUNCTION_STATUS_FILTER.slice();
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  const filtered = list
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter((entry) => FUNCTION_STATUSES.includes(entry));
  return filtered.length ? Array.from(new Set(filtered)) : DEFAULT_FUNCTION_STATUS_FILTER.slice();
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

function addDaysToDateString(dateValue, days) {
  const datePart = normaliseDate(dateValue);
  if (!datePart) return null;
  const dateObj = new Date(datePart);
  if (Number.isNaN(dateObj.getTime())) return datePart;
  dateObj.setDate(dateObj.getDate() + days);
  return formatLocalDate(dateObj);
}

function addHour(dateTimeString) {
  if (!dateTimeString || !dateTimeString.includes("T")) return dateTimeString;
  const dateObj = new Date(dateTimeString);
  if (Number.isNaN(dateObj.getTime())) return dateTimeString;
  dateObj.setTime(dateObj.getTime() + ONE_HOUR_MS);
  return formatLocalDateTime(dateObj);
}

function mapFunctionRow(row) {
  const hasTime = row.start_time || row.end_time;
  const start = composeDateTimeString(row.event_date, row.start_time);
  let end = null;
  if (row.end_date) {
    if (!hasTime) {
      end = addDaysToDateString(row.end_date, 1);
    } else {
      end = composeDateTimeString(row.end_date, row.end_time || row.start_time);
      if (!row.end_time && end && end.includes("T")) {
        end = addHour(end);
      }
    }
  } else {
    end = composeDateTimeString(row.event_date, row.end_time);
    if (!end && start && start.includes("T")) {
      end = addHour(start);
    }
  }
  const allDay = !row.start_time && !row.end_time;
  const statusKey = String(row.status || "").toLowerCase();
  const baseColour = STATUS_COLOURS[statusKey] || "#6bb4de";
  const title = row.event_name || "Function";
  const allocationRooms = Array.isArray(row.allocation_rooms) ? row.allocation_rooms : [];
  const allocationRoomNames = Array.isArray(row.allocation_room_names)
    ? row.allocation_room_names
    : [];
  const allocationRoomColors = Array.isArray(row.allocation_room_colors)
    ? row.allocation_room_colors
    : [];
  const allocationRoomColorsFilled = allocationRooms.map((room, idx) => {
    const raw = allocationRoomColors[idx];
    return raw && String(raw).trim() ? raw : getRoomColourFallback(room.id);
  });
  const roomNameSet = new Set(
    [row.room_name, ...allocationRoomNames].filter(Boolean).map((name) => String(name))
  );
  const roomNames = Array.from(roomNameSet);
  const roomIdSet = new Set(
    [row.room_id, ...allocationRooms.map((room) => room.id)]
      .filter((id) => Number.isInteger(id))
      .map((id) => Number(id))
  );
  const roomIds = Array.from(roomIdSet);
  const primaryRoomColor = row.room_id
    ? (row.room_color && String(row.room_color).trim()) || getRoomColourFallback(row.room_id)
    : null;
  const roomColor = primaryRoomColor || allocationRoomColorsFilled.find((c) => c) || null;
  const forceStatusColour = ["completed", "cancelled"].includes(statusKey);
  const colour = forceStatusColour ? baseColour : roomColor || baseColour;
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
      roomNames,
      roomIds,
      roomColor: roomColor || null,
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
  await ensureRestaurantServiceBookingLimitColumn(db);
  const { rows } = await db.query(
    `
    SELECT id, name, day_of_week, start_time, end_time,
           slot_minutes, turn_minutes,
           max_covers_per_slot, max_online_covers, max_online_party_size,
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
  await ensureRestaurantServiceBookingLimitColumn(db);
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

  // Parse as local date to avoid UTC shift when using YYYY-MM-DD strings.
  const dateObj = new Date(`${targetDate}T00:00:00`);
  const dow = dateObj.getDay();
  const candidateTime = normaliseTime(bookingTime) || null;

  const { rows } = await db.query(
    `
    SELECT id, name, start_time, end_time,
           slot_minutes, turn_minutes,
           max_covers_per_slot, max_online_covers, max_online_party_size,
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
    excludeBookingId = null,
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
       AND ($5::int IS NULL OR id <> $5)
       AND COALESCE(status, 'pending') NOT IN ('cancelled', 'no_show');
    `,
    [bookingDate, service.id, startTime, endTime, excludeBookingId]
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
  const colour = row.event_color || "#fbcfe8";
  const priceValue = row.price !== null && row.price !== undefined ? Number(row.price) : null;
  const eventUrl = `/entertainment/${row.slug || row.id}`;
  const functionUrl = row.function_id ? `/functions/${row.function_id}` : null;
  const additionalRooms = Array.isArray(row.additional_rooms) ? row.additional_rooms : [];
  const additionalRoomNames = Array.isArray(row.additional_room_names)
    ? row.additional_room_names
    : [];
  const roomNames = [row.room_name, ...additionalRoomNames].filter(Boolean);
  const roomIds = [row.room_id, ...additionalRooms.map((room) => room.id)]
    .filter((id) => Number.isInteger(id));
  return {
    id: `entertainment-${row.id}`,
    title: row.title,
    start,
    end,
    color: colour,
    backgroundColor: colour,
    borderColor: colour,
    extendedProps: {
      type: "entertainment",
      sourceId: row.id,
      organiser: row.organiser,
      status: row.status,
      price: priceValue,
      currency: row.currency || "NZD",
      link: row.external_url,
      roomId: row.room_id || null,
      roomName: row.room_name || "Entertainment",
      roomNames: roomNames,
      roomIds: roomIds,
      functionId: row.function_id || null,
      functionName: row.function_name || null,
      detailUrl: functionUrl || eventUrl,
      eventUrl,
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

  if (exceedsOnlinePartySize(service, size, payload.channel)) {
    const error = new Error("Online booking exceeds maximum diners per booking.");
    error.code = "MAX_ONLINE_PARTY_SIZE";
    throw error;
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
      excludeBookingId: null,
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
  if (!options.suppressEmail && process.env.NODE_ENV !== "test") {
    notifyRestaurantTeam(booking, service, options.req).catch((err) => {
      console.error("[Restaurant Calendar] Failed to send booking email:", err.message);
    });
    if (booking.contact_email) {
      const template = (booking.status || "").toLowerCase() === "confirmed" ? "confirm" : "request";
      notifyRestaurantCustomer(booking, service, template, options.req).catch((err) => {
        console.error("[Restaurant Calendar] Failed to send customer email:", err.message);
      });
    }
  }

  return { booking, service };
}

async function notifyRestaurantTeam(booking, service, req = null) {
  try {
    const accessToken = await acquireGraphToken();
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
    const accessToken = await acquireGraphToken();
    if (!accessToken || !booking?.contact_email) return;
    const settings = await getRestaurantSettings();
    const mode = template === "confirm" ? "confirm" : "request";
    const subjectTemplate =
      settings[`${mode}_subject`] || DEFAULT_RESTAURANT_EMAIL_TEMPLATES[`${mode}_subject`];
    const bodyTemplate =
      settings[`${mode}_body_html`] || DEFAULT_RESTAURANT_EMAIL_TEMPLATES[`${mode}_body_html`];
    const price = service?.special_menu_price
      ? ` ($${Number(service.special_menu_price).toFixed(2)})`
      : "";
    const menuLine =
      isSpecialMenuActive(service, booking.booking_date) && service?.special_menu_label
        ? `<br><strong>Menu:</strong> ${service.special_menu_label}${price}`
        : "";
    const bookingTime = booking.booking_time || "TBC";
    const bookingDateTime = composeDateTimeString(booking.booking_date, booking.booking_time);
    const data = {
      booking: {
        ...booking,
        booking_time: bookingTime,
        booking_datetime: bookingDateTime,
      },
      service: service || {},
      menu_line: menuLine,
    };
    const subject = replaceTokens(subjectTemplate, data);
    const body = replaceTokens(bodyTemplate, data);

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
    await ensureEntertainmentFunctionLinkColumn();
    const params = [];
    const where = [`(e.status IS NULL OR e.status <> 'cancelled')`];
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
      const roomParam = `$${params.length}`;
      where.push(
        `(e.room_id = ANY(${roomParam}::int[]) OR e.id IN (SELECT event_id FROM entertainment_event_rooms WHERE room_id = ANY(${roomParam}::int[])))`
      );
    }
    const query = `
      SELECT e.*, r.name AS room_name, fn.event_name AS function_name,
             er.additional_rooms, er.additional_room_names
        FROM entertainment_events e
        LEFT JOIN rooms r ON r.id = e.room_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(
                 jsonb_agg(
                     jsonb_build_object('id', rr.id, 'name', rr.name, 'color', rr.color_code)
                     ORDER BY rr.name
                   ) FILTER (WHERE rr.id IS NOT NULL),
                   '[]'::jsonb
                 ) AS additional_rooms,
                 COALESCE(
                   array_agg(rr.name ORDER BY rr.name) FILTER (WHERE rr.id IS NOT NULL),
                   ARRAY[]::text[]
                 ) AS additional_room_names
            FROM entertainment_event_rooms eer
            JOIN rooms rr ON rr.id = eer.room_id
           WHERE eer.event_id = e.id
        ) er ON TRUE
        LEFT JOIN functions fn ON fn.id_uuid = e.function_id
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

async function acquireGraphToken() {
  try {
    return await getAppToken();
  } catch (err) {
    console.error("[Calendar] Failed to acquire Graph token:", err.message);
    return null;
  }
}

router.get("/", async (req, res) => {
  try {
    const daySlotMinutes = await fetchCalendarSettings();
    const { rows: roomsRaw } = await pool.query(
      `SELECT id, name, capacity, color_code
         FROM rooms
        ORDER BY name ASC`
    );
    const rooms = roomsRaw.map((room) => ({
      ...room,
      color_code: (room.color_code && String(room.color_code).trim()) || getRoomColourFallback(room.id),
    }));

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
    const functionStatuses = parseFunctionStatusFilter(req.query.statuses);
    const startDate = normaliseDate(req.query.start);
    const endDate = normaliseDate(req.query.end);

    const events = [];

    if (includeFunctions) {
      await ensureFunctionEndDateColumn();
      await ensureFunctionRoomAllocationsTable();
      const whereParts = ["f.event_date IS NOT NULL"];
      const params = [];

      if (startDate) {
        params.push(startDate);
        whereParts.push(`COALESCE(f.end_date, f.event_date) >= $${params.length}`);
      }
      if (endDate) {
        params.push(endDate);
        whereParts.push(`f.event_date <= $${params.length}`);
      }
      if (roomIds.length) {
        params.push(roomIds);
        const roomParam = `$${params.length}`;
        const allocFilters = [];
        if (startDate) {
          params.push(startDate);
          allocFilters.push(
            `COALESCE(fra.end_at::date, COALESCE(f.end_date, f.event_date)) >= $${params.length}`
          );
        }
        if (endDate) {
          params.push(endDate);
          allocFilters.push(
            `COALESCE(fra.start_at::date, f.event_date) <= $${params.length}`
          );
        }
        const allocClause = allocFilters.length ? ` AND ${allocFilters.join(" AND ")}` : "";
        whereParts.push(`
          (
            EXISTS (
              SELECT 1
                FROM function_room_allocations fra
               WHERE fra.function_id = f.id_uuid
                 AND fra.room_id = ANY(${roomParam}::int[])
                 ${allocClause}
            )
            OR (
              f.room_id = ANY(${roomParam}::int[])
              AND NOT EXISTS (
                SELECT 1
                  FROM function_room_allocations fra2
                 WHERE fra2.function_id = f.id_uuid
                   AND fra2.room_id = f.room_id
              )
            )
          )
        `);
      }
      if (functionStatuses.length) {
        params.push(functionStatuses);
        whereParts.push(`LOWER(COALESCE(f.status, 'lead')) = ANY($${params.length}::text[])`);
      }

      const query = `
        SELECT
          f.id_uuid,
          f.event_name,
          f.event_date,
          f.end_date,
          f.start_time,
          f.end_time,
          f.status,
          f.attendees,
          r.name AS room_name,
          r.id AS room_id,
          r.color_code AS room_color,
          fr.allocation_rooms,
          fr.allocation_room_names,
          fr.allocation_room_colors,
          c.name AS contact_name
        FROM functions f
        LEFT JOIN rooms r ON r.id = f.room_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(
                   jsonb_agg(
                     jsonb_build_object('id', rr.id, 'name', rr.name)
                     ORDER BY rr.name
                   ) FILTER (WHERE rr.id IS NOT NULL),
                   '[]'::jsonb
                 ) AS allocation_rooms,
                 COALESCE(
                   array_agg(rr.name ORDER BY rr.name) FILTER (WHERE rr.id IS NOT NULL),
                   ARRAY[]::text[]
                 ) AS allocation_room_names
                ,COALESCE(
                   array_agg(rr.color_code ORDER BY rr.name) FILTER (WHERE rr.id IS NOT NULL),
                   ARRAY[]::text[]
                 ) AS allocation_room_colors
            FROM function_room_allocations fra
            JOIN rooms rr ON rr.id = fra.room_id
           WHERE fra.function_id = f.id_uuid
        ) fr ON TRUE
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

    const embed = req.query.embed === "1";
    res.render("pages/calendar/restaurant", {
      layout: embed ? false : "layouts/main",
      title: "Restaurant Calendar",
      active: "restaurant",
      pageType: "calendar",
      embed,
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
  const recurrenceFrequency = String(req.body.recurrence_frequency || "none").toLowerCase();
  const recurrence = recurrenceService.parseRecurrenceForm(req.body);
  if (recurrenceFrequency !== "none" && !recurrence) {
    return res.redirect(
      "/calendar/restaurant?error=" +
        encodeURIComponent("Recurring bookings require an end date.")
    );
  }
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
  const occurrenceDates = recurrence
    ? recurrenceService.generateOccurrenceDates({
        startDate: payload.bookingDate,
        recurrence,
      })
    : [payload.bookingDate];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!occurrenceDates.length) {
      throw new Error("Recurring bookings require a valid start/end date.");
    }
    const suppressEmail = Boolean(recurrence && occurrenceDates.length > 1);
    for (const date of occurrenceDates) {
      await createRestaurantBooking(
        {
          ...payload,
          bookingDate: date,
        },
        { db: client, suppressEmail }
      );
    }
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
    await ensureRestaurantServiceBookingLimitColumn();
    const { rows: services } = await pool.query(
      `SELECT id, name, day_of_week, start_time, end_time,
              max_online_party_size,
              special_menu_label, special_menu_price, special_menu_start, special_menu_end, special_menu_only
         FROM restaurant_services
        WHERE active = TRUE
        ORDER BY day_of_week, start_time;`
    );
    const draft = req.session?.restaurantBookingDraft || null;
    if (req.session?.restaurantBookingDraft) {
      delete req.session.restaurantBookingDraft;
    }
    const rawError = draft?.errorMessage || req.query.error || null;
    const safeDecode = (value) => {
      if (!value) return value;
      try {
        return decodeURIComponent(value);
      } catch (err) {
        return value;
      }
    };
    const decodedError = safeDecode(rawError);
    const normalizedError =
      decodedError && isCapacityError({ message: decodedError })
        ? CAPACITY_CONTACT_MESSAGE
        : decodedError;
    res.render("pages/calendar/restaurant-book", {
      layout: embed ? false : "layouts/main",
      title: "Book the Restaurant",
      active: "restaurant",
      services,
      success: req.query.success || null,
      errorMessage: normalizedError || null,
      embed,
      formData: draft?.formData || null,
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
    const embed = req.query.embed === "1";
    const message = isCapacityError(err)
      ? CAPACITY_CONTACT_MESSAGE
      : err.message || "Unable to submit booking";
    if (req.session) {
      req.session.restaurantBookingDraft = {
        formData: {
          party_name: req.body.party_name,
          contact_email: req.body.contact_email,
          contact_phone: req.body.contact_phone,
          booking_date: req.body.booking_date,
          booking_time: req.body.booking_time,
          size: req.body.size,
          service_id: req.body.service_id,
          notes: req.body.notes,
        },
        errorMessage: message,
        embed,
      };
    }
    try {
      await ensureRestaurantServiceBookingLimitColumn();
      const { rows: services } = await pool.query(
        `SELECT id, name, day_of_week, start_time, end_time,
                max_online_party_size,
                special_menu_label, special_menu_price, special_menu_start, special_menu_end, special_menu_only
           FROM restaurant_services
          WHERE active = TRUE
          ORDER BY day_of_week, start_time;`
      );
      res.status(400).render("pages/calendar/restaurant-book", {
        layout: embed ? false : "layouts/main",
        title: "Book the Restaurant",
        active: "restaurant",
        services,
        success: null,
        errorMessage: message,
        embed,
        formData: {
          party_name: req.body.party_name,
          contact_email: req.body.contact_email,
          contact_phone: req.body.contact_phone,
          booking_date: req.body.booking_date,
          booking_time: req.body.booking_time,
          size: req.body.size,
          service_id: req.body.service_id,
          notes: req.body.notes,
        },
      });
    } catch (loadErr) {
      console.error("[Restaurant Calendar] Failed to reload booking form:", loadErr);
      res.status(400).render("pages/calendar/restaurant-book", {
        layout: embed ? false : "layouts/main",
        title: "Book the Restaurant",
        active: "restaurant",
        services: [],
        success: null,
        errorMessage: message,
        embed,
        formData: {
          party_name: req.body.party_name,
          contact_email: req.body.contact_email,
          contact_phone: req.body.contact_phone,
          booking_date: req.body.booking_date,
          booking_time: req.body.booking_time,
          size: req.body.size,
          service_id: req.body.service_id,
          notes: req.body.notes,
        },
      });
    }
  }
});

router.get("/restaurant/bookings/:id", async (req, res) => {
  if (!isPrivileged(req)) {
    return res.redirect("/calendar/restaurant?error=Admin%20access%20required");
  }
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) throw new Error("Missing booking id");
    const [bookingRes, servicesRes, zonesRes, tablesRes] = await Promise.all([
      pool.query(
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
      ),
      pool.query(
        `
        SELECT id, name, day_of_week, start_time, end_time
          FROM restaurant_services
         WHERE active = TRUE
         ORDER BY day_of_week, start_time;
        `
      ),
      pool.query(
        `
        SELECT id, name
          FROM restaurant_zones
         ORDER BY name ASC;
        `
      ),
      pool.query(
        `
        SELECT id, label, zone_id, active
          FROM restaurant_tables
         WHERE active = TRUE
         ORDER BY label ASC;
        `
      ),
    ]);
    const booking = bookingRes.rows[0];
    if (!booking) return res.status(404).send("Booking not found");
    res.render("pages/calendar/restaurant-booking-detail", {
      layout: "layouts/main",
      title: `Booking · ${booking.party_name}`,
      active: "restaurant",
      booking,
      services: servicesRes.rows,
      zones: zonesRes.rows,
      tables: tablesRes.rows,
      success: req.query.success || null,
      errorMessage: req.query.error || null,
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to load booking detail:", err);
    res.status(500).send("Unable to load booking detail.");
  }
});

router.post("/restaurant/bookings/:id/edit", async (req, res) => {
  if (!isPrivileged(req)) {
    return res.redirect("/calendar/restaurant?error=Admin%20access%20required");
  }
  const bookingId = Number(req.params.id);
  if (!bookingId) {
    return res.redirect("/calendar/restaurant?error=Missing%20booking%20id");
  }
  const payload = {
    partyName: (req.body.party_name || "").trim(),
    bookingDate: req.body.booking_date,
    bookingTime: req.body.booking_time,
    size: parseInt(req.body.size, 10) || 0,
    serviceId: req.body.service_id ? Number(req.body.service_id) : null,
    zoneId: req.body.zone_id ? Number(req.body.zone_id) : null,
    tableId: req.body.table_id ? Number(req.body.table_id) : null,
    notes: req.body.notes || null,
    contactEmail: req.body.contact_email || null,
    contactPhone: req.body.contact_phone || null,
  };

  try {
    if (!payload.partyName) throw new Error("Party name is required.");
    const bookingDate = normaliseDate(payload.bookingDate);
    const bookingTime = normaliseTime(payload.bookingTime);
    if (!bookingDate) throw new Error("Booking date is invalid.");
    if (!bookingTime) throw new Error("Booking time is required.");
    if (!payload.size) throw new Error("Party size is required.");

    const service = await findServiceForSlot(bookingDate, bookingTime, payload.serviceId);
    if (!service) throw new Error("No service matches the requested time.");

    const { slotStart, slotEnd } = computeSlotBounds(service, bookingTime);
    await ensureRestaurantCapacity({
      bookingDate,
      service,
      slotStart,
      slotEnd,
      partySize: payload.size,
      channel: "internal",
      excludeBookingId: bookingId,
    });

    await pool.query(
      `
      UPDATE restaurant_bookings
         SET party_name = $1,
             booking_date = $2,
             booking_time = $3,
             size = $4,
             service_id = $5,
             zone_id = $6,
             table_id = $7,
             contact_email = $8,
             contact_phone = $9,
             notes = $10,
             updated_at = NOW()
       WHERE id = $11;
      `,
      [
        payload.partyName,
        bookingDate,
        bookingTime,
        payload.size,
        service.id,
        payload.zoneId,
        payload.tableId,
        payload.contactEmail || null,
        payload.contactPhone || null,
        payload.notes || null,
        bookingId,
      ]
    );

    res.redirect(`/calendar/restaurant/bookings/${bookingId}?success=1`);
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to edit booking:", err);
    const message = encodeURIComponent(err.message || "Unable to update booking");
    res.redirect(`/calendar/restaurant/bookings/${bookingId}?error=${message}`);
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

router.post("/restaurant/bookings/:id/delete", async (req, res) => {
  if (!isPrivileged(req)) {
    return res.redirect("/calendar/restaurant?error=Admin%20access%20required");
  }
  try {
    const bookingId = Number(req.params.id);
    if (!bookingId) throw new Error("Missing booking id");
    await pool.query("DELETE FROM restaurant_bookings WHERE id = $1;", [bookingId]);
    res.redirect("/calendar/restaurant?success=Booking%20deleted");
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to delete booking:", err);
    const message = encodeURIComponent(err.message || "Unable to delete booking");
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
    let endAt = null;
    if (fn.end_date) {
      endAt = composeDateTimeString(fn.end_date, fn.end_time || fn.start_time || fn.event_time || "00:00:00");
    } else if (fn.end_time) {
      endAt = composeDateTimeString(fn.event_date, fn.end_time);
    }
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
  await ensureFunctionEndDateColumn();
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
        id_uuid, event_name, status, event_date, end_date, start_time, end_time,
        attendees, room_id, event_type, owner_id, created_at, updated_at, updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,NULL,$7,NULL,$8,$9,NOW(),NOW(),$9
      );
      `,
      [
        fnId,
        booking.party_name || "Restaurant booking",
        statusValue,
        booking.booking_date,
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
  await ensureFunctionEndDateColumn();
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
    const endDate = event.end_at ? new Date(event.end_at) : null;
    const endDatePart = endDate ? formatLocalDate(endDate) : null;
    await client.query(
      `
      INSERT INTO functions (
        id_uuid, event_name, status, event_date, end_date, start_time, end_time,
        attendees, room_id, event_type, owner_id, created_at, updated_at, updated_by
      )
      VALUES (
        $1,$2,'lead',$3,$4,$5,$6,0,NULL,'Entertainment',$7,NOW(),NOW(),$7
      );
      `,
      [fnId, event.title || "Entertainment", datePart, endDatePart, timePart, null, userId || null]
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
