const express = require("express");
const { randomUUID, createHash } = require("crypto");
const { pool } = require("../db");
const { getTeamupSettings } = require("../services/teamupSettings");
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

const EVENT_TYPES = ["functions", "restaurant", "entertainment", "teamup"];
const FATHERS_DAY_BOOKING_DATE = "2026-09-06";
const FATHERS_DAY_MENU_LABEL = "Father's Day Buffet";
const FATHERS_DAY_BOOKING_TIMES = ["11:00", "12:15", "13:30", "17:00"];
const FATHERS_DAY_BOOKING_PATH = "/calendar/restaurant/book/fathers-day";
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
  "confirmed",
];
const STATUS_COLOURS = {
  lead: "#CBD5F5", // muted indigo
  qualified: "#A5B4FC",
  confirmed: "#A7F3D0",
  balance_due: "#FDE68A",
  completed: "#D1D5DB",
};
const ROOM_COLOUR_FALLBACKS = [
  "#6bb4de", // bright blue
  "#D99B26", // warm amber gold
  "#D96B6B", // terracotta rose
  "#689F7D", // sage olive green
  "#A55B8F", // plum / mulberry
  "#339395", // deep teal
  "#8b6fde", // violet
  "#4a9ecc", // medium teal blue
  "#d86aa1", // pink
  "#5bbbd6", // sky blue
  "#fbbf24", // amber
  "#34d399", // emerald
  "#60a5fa", // light blue
  "#a78bfa", // soft violet
  "#fb923c", // orange
  "#e25b5b", // coral red
  "#7c9f35", // olive green
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

function getNamedRoomColour(roomName) {
  const normalizedName = String(roomName || "").trim().toLowerCase();
  if (!normalizedName) return null;
  if (normalizedName.includes("restaurant")) return "#bbf7d0";
  if (normalizedName.includes("courtesy van")) return "#339395";
  return null;
}

function resolveRoomColour(roomId, roomName, rawColour) {
  const namedColour = getNamedRoomColour(roomName);
  if (namedColour) return namedColour;
  const explicitColour = String(rawColour || "").trim();
  if (explicitColour) return explicitColour;
  return getRoomColourFallback(roomId);
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
const TEAMUP_SYNC_LOOKAHEAD_DAYS = 365;
const TEAMUP_SYNC_LOOKBACK_DAYS = 30;
const TEAMUP_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

let teamupSyncState = {
  running: null,
  lastCompletedAt: 0,
};

async function getTeamupConfig() {
  // DB settings take priority over env vars so admin can configure from the UI.
  try {
    const dbSettings = await getTeamupSettings();
    const dbKey = String(dbSettings?.calendar_key || "").trim();
    const dbToken = String(dbSettings?.api_token || "").trim();
    if (dbKey && dbToken) {
      const authToken = String(dbSettings?.auth_token || "").trim();
      const subcalendarIds = String(dbSettings?.subcalendar_ids || "")
        .split(",")
        .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0);
      return { calendarKey: dbKey, apiToken: dbToken, authToken, subcalendarIds };
    }
  } catch (err) {
    console.warn("[Calendar] Could not load Teamup settings from DB, falling back to env:", err.message);
  }
  // Fallback: env vars
  const calendarKey = String(process.env.TEAMUP_CALENDAR_KEY || "").trim();
  const apiToken = String(process.env.TEAMUP_API_TOKEN || process.env.TEAMUP_TOKEN || "").trim();
  const authToken = String(process.env.TEAMUP_AUTH_TOKEN || "").trim();
  const subcalendarIds = String(process.env.TEAMUP_SUBCALENDAR_IDS || "")
    .split(",")
    .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (!calendarKey || !apiToken) return null;
  return { calendarKey, apiToken, authToken, subcalendarIds };
}

function getTeamupHeaders(config, extraHeaders = {}) {
  const headers = {
    "Teamup-Token": config.apiToken,
    Accept: "application/json",
    ...extraHeaders,
  };
  if (config?.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  return headers;
}

function getTeamupConfigStatus() {
  // Check env vars only (synchronous, used for page render)
  // DB-sourced config is checked async via getTeamupConfig()
  const missing = [];
  if (!String(process.env.TEAMUP_CALENDAR_KEY || "").trim()) {
    missing.push("TEAMUP_CALENDAR_KEY (or set via Settings → Teamup)");
  }
  if (!String(process.env.TEAMUP_API_TOKEN || process.env.TEAMUP_TOKEN || "").trim()) {
    missing.push("TEAMUP_API_TOKEN (or set via Settings → Teamup)");
  }
  return {
    configured: missing.length === 0,
    missing,
  };
}

function toTeamupIsoDate(dateValue) {
  const parsed = normaliseDate(dateValue);
  if (!parsed) return null;
  return parsed;
}

function parseTeamupDateTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00:00Z`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function hashTeamupPayload(event) {
  const source = JSON.stringify(event || {});
  return createHash("sha256").update(source).digest("hex");
}

async function ensureTeamupEventsTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS teamup_events (
      id SERIAL PRIMARY KEY,
      teamup_event_id BIGINT NOT NULL UNIQUE,
      teamup_series_id BIGINT NULL,
      teamup_subcalendar_id BIGINT NULL,
      title TEXT NOT NULL,
      starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
      ends_at TIMESTAMP WITH TIME ZONE NULL,
      all_day BOOLEAN NOT NULL DEFAULT FALSE,
      location TEXT NULL,
      original_description TEXT NULL,
      local_description_override TEXT NULL,
      linked_function_id UUID NULL REFERENCES functions(id_uuid) ON DELETE SET NULL,
      external_url TEXT NULL,
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_hash TEXT NULL,
      last_synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_teamup_events_starts_at ON teamup_events(starts_at);`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_teamup_events_linked_function ON teamup_events(linked_function_id);`
  );
  await db.query(
    `ALTER TABLE teamup_events ADD COLUMN IF NOT EXISTS external_url TEXT NULL;`
  );
  await db.query(
    `ALTER TABLE public.teamup_events ENABLE ROW LEVEL SECURITY;`
  );
}

async function fetchTeamupEventsFromApi({ startDate, endDate, config }) {
  const url = new URL(`https://api.teamup.com/${encodeURIComponent(config.calendarKey)}/events`);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: getTeamupHeaders(config),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Teamup API request failed (${res.status}): ${text || res.statusText}`);
  }
  const payload = await res.json();
  const events = Array.isArray(payload?.events)
    ? payload.events
    : Array.isArray(payload?.data?.events)
    ? payload.data.events
    : [];
  return events;
}

async function upsertTeamupEvents(events = [], db = pool) {
  let upserted = 0;
  for (const event of events) {
    const eventIdRaw = event?.id;
    const teamupEventId = Number.parseInt(String(eventIdRaw || ""), 10);
    if (!Number.isInteger(teamupEventId)) continue;
    const startsAt = parseTeamupDateTime(event.start_dt || event.start || event.start_dt_utc);
    if (!startsAt) continue;
    const endsAt = parseTeamupDateTime(event.end_dt || event.end || event.end_dt_utc);
    const sourceHash = hashTeamupPayload(event);
    const title = String(event.title || "Teamup Event").trim() || "Teamup Event";
    const notes = event.notes !== undefined && event.notes !== null ? String(event.notes) : null;
    const location = event.location !== undefined && event.location !== null ? String(event.location) : null;
    const subcalendarId = Number.parseInt(String(event.subcalendar_id || ""), 10);
    const seriesId = Number.parseInt(String(event.series_id || ""), 10);
    const allDay = Boolean(event.all_day);
    const externalUrl = event.web_url || event.url || null;

    await db.query(
      `
      INSERT INTO teamup_events (
        teamup_event_id,
        teamup_series_id,
        teamup_subcalendar_id,
        title,
        starts_at,
        ends_at,
        all_day,
        location,
        original_description,
        external_url,
        source_payload,
        source_hash,
        last_synced_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,NOW(),NOW())
      ON CONFLICT (teamup_event_id)
      DO UPDATE SET
        teamup_series_id = EXCLUDED.teamup_series_id,
        teamup_subcalendar_id = EXCLUDED.teamup_subcalendar_id,
        title = EXCLUDED.title,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        all_day = EXCLUDED.all_day,
        location = EXCLUDED.location,
        original_description = EXCLUDED.original_description,
        external_url = EXCLUDED.external_url,
        source_payload = EXCLUDED.source_payload,
        source_hash = EXCLUDED.source_hash,
        last_synced_at = NOW(),
        updated_at = NOW();
      `,
      [
        teamupEventId,
        Number.isInteger(seriesId) ? seriesId : null,
        Number.isInteger(subcalendarId) ? subcalendarId : null,
        title,
        startsAt,
        endsAt,
        allDay,
        location,
        notes,
        externalUrl,
        JSON.stringify(event || {}),
        sourceHash,
      ]
    );
    upserted += 1;
  }
  return upserted;
}

async function syncTeamupEventsRange({ startDate, endDate, force = false, db = pool }) {
  const config = await getTeamupConfig();
  if (!config) {
    return {
      skipped: true,
      reason: "TEAMUP_CALENDAR_KEY / TEAMUP_API_TOKEN not configured",
      fetched: 0,
      upserted: 0,
    };
  }
  const now = Date.now();
  if (!force && teamupSyncState.running) {
    return teamupSyncState.running;
  }
  if (!force && now - teamupSyncState.lastCompletedAt < TEAMUP_AUTO_SYNC_INTERVAL_MS) {
    return {
      skipped: true,
      reason: "sync throttled",
      fetched: 0,
      upserted: 0,
    };
  }

  const runner = (async () => {
    await ensureTeamupEventsTable(db);
    const start = toTeamupIsoDate(startDate);
    const end = toTeamupIsoDate(endDate);
    if (!start || !end) {
      throw new Error("Teamup sync requires valid start/end date.");
    }
    const events = await fetchTeamupEventsFromApi({ startDate: start, endDate: end, config });
    const filtered = config.subcalendarIds.length
      ? events.filter((event) => config.subcalendarIds.includes(Number(event?.subcalendar_id)))
      : events;
    const upserted = await upsertTeamupEvents(filtered, db);
    teamupSyncState.lastCompletedAt = Date.now();
    return {
      skipped: false,
      reason: null,
      fetched: filtered.length,
      upserted,
    };
  })();

  teamupSyncState.running = runner;
  try {
    return await runner;
  } finally {
    teamupSyncState.running = null;
  }
}

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
  const isLead = statusKey === "lead";
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
    return resolveRoomColour(room.id, room.name, raw);
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
    ? resolveRoomColour(row.room_id, row.room_name, row.room_color)
    : null;
  const roomColor = primaryRoomColor || allocationRoomColorsFilled.find((c) => c) || null;
  const unassignedRoomColour = "#D1D5DB";
  const forceStatusColour = ["completed", "cancelled"].includes(statusKey);
  const colour = forceStatusColour
    ? baseColour
    : roomColor || (roomIds.length === 0 ? unassignedRoomColour : baseColour);
  const opacity = isLead ? 0.45 : 1;
  return {
    id: row.id_uuid,
    title,
    start,
    end,
    allDay,
    backgroundColor: colour,
    borderColor: isLead ? "#94a3b8" : colour,
    textColor: isLead ? "#475569" : undefined,
    classNames: isLead ? ["fc-event--lead"] : [],
    style: `opacity: ${opacity}; border-style: ${isLead ? "dashed" : "solid"}; ${isLead ? "text-decoration: line-through; text-decoration-color: rgba(148, 163, 184, 0.7); text-decoration-thickness: 1px;" : ""}`,
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

async function fetchFathersDayServices(db = pool) {
  await ensureRestaurantServiceBookingLimitColumn(db);
  const { rows } = await db.query(
    `
    SELECT id, name, day_of_week, start_time, end_time, slot_minutes,
           max_online_party_size,
           special_menu_label, special_menu_price, special_menu_start, special_menu_end,
           special_menu_only
      FROM restaurant_services
     WHERE active = TRUE
       AND day_of_week = 0
         AND (
           LOWER(name) LIKE '%father%'
           OR LOWER(COALESCE(special_menu_label, '')) LIKE '%father%'
         )
     ORDER BY start_time ASC;
    `
  );
  return rows;
}

async function findServiceForSlot(
  bookingDate,
  bookingTime,
  explicitServiceId,
  db = pool,
  allowOutsideWindow = false
) {
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
  if (allowOutsideWindow && rows.length) {
    const service = rows[0];
    const override = await fetchOverrideForService(service.id, targetDate, db);
    return {
      ...service,
      slot_minutes_effective: override?.slot_minutes || service.slot_minutes,
      max_covers_effective: override?.max_covers_per_slot ?? service.max_covers_per_slot,
    };
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

function mapTeamupEventRow(row) {
  const start = row.starts_at ? new Date(row.starts_at).toISOString() : null;
  const end = row.ends_at ? new Date(row.ends_at).toISOString() : null;
  const linked = Boolean(row.linked_function_id);
  const effectiveDescription =
    row.local_description_override !== null && row.local_description_override !== undefined
      ? row.local_description_override
      : row.original_description;
  const colour = linked ? "#93c5fd" : "#c7d2fe";
  return {
    id: `teamup-${row.id}`,
    title: row.title || "Teamup Event",
    start,
    end,
    allDay: Boolean(row.all_day),
    backgroundColor: colour,
    borderColor: linked ? "#2563eb" : "#6366f1",
    textColor: "#1f2937",
    extendedProps: {
      type: "teamup",
      sourceId: row.id,
      teamupEventId: row.teamup_event_id,
      teamupSubcalendarId: row.teamup_subcalendar_id,
      status: linked ? "linked" : "unlinked",
      roomName: linked ? row.function_room_name || "Linked function" : "Teamup",
      roomNames: row.function_room_name ? [row.function_room_name] : [],
      description: effectiveDescription || "",
      originalDescription: row.original_description || "",
      localDescriptionOverride: row.local_description_override,
      functionId: row.linked_function_id || null,
      functionName: row.function_name || null,
      detailUrl: row.linked_function_id ? `/functions/${row.linked_function_id}` : null,
      externalUrl: row.external_url || null,
    },
  };
}

async function fetchTeamupEventsBetween(startDate, endDate) {
  await ensureTeamupEventsTable();
  const params = [];
  const where = [];
  if (startDate) {
    params.push(startDate);
    where.push(`te.starts_at::date >= $${params.length}`);
  }
  if (endDate) {
    params.push(endDate);
    where.push(`te.starts_at::date <= $${params.length}`);
  }
  const query = `
    SELECT te.*,
           fn.event_name AS function_name,
           rm.name AS function_room_name
      FROM teamup_events te
      LEFT JOIN functions fn ON fn.id_uuid = te.linked_function_id
      LEFT JOIN rooms rm ON rm.id = fn.room_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY te.starts_at ASC, te.id ASC;
  `;
  const { rows } = await pool.query(query, params);
  return rows;
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
  const allowOutsideWindow = Boolean(options.allowOutsideWindow);
  const service = await findServiceForSlot(
    bookingDate,
    bookingTime,
    explicitServiceId,
    db,
    allowOutsideWindow
  );
  if (!service) {
    throw new Error("No service matches the requested time.");
  }
  const outsideServiceWindow =
    bookingTime < service.start_time || bookingTime > service.end_time;
  const specialMenuActive = isSpecialMenuActive(service, bookingDate);
  const menuType =
    payload.menuType ||
    (specialMenuActive && service.special_menu_only ? service.special_menu_label : null);
  const menuPrice =
    payload.price ?? (menuType && specialMenuActive ? service.special_menu_price : null);

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
  if (!allowOutsideWindow || !outsideServiceWindow) {
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
  }

  const result = await db.query(
    `
    INSERT INTO restaurant_bookings
      (party_name, booking_date, booking_time, size, status, menu_type, price,
       owner_id, service_id, zone_id, table_id, channel,
       contact_email, contact_phone, contact_id, notes, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
    RETURNING *;
    `,
    [
      partyName,
      bookingDate,
      allowOutsideWindow && outsideServiceWindow
        ? bookingTime
        : timeStringFromMinutes(slotStart).slice(0, 8),
      size,
      payload.status || "pending",
      menuType,
      menuPrice,
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
    // Check DB-sourced config first; fall back to env-based status for display
    const dbConfig = await getTeamupConfig().catch(() => null);
    const teamupConfigStatus = dbConfig
      ? { configured: true, missing: [] }
      : getTeamupConfigStatus();
    const { rows: roomsRaw } = await pool.query(
      `SELECT id, name, capacity, color_code
         FROM rooms
        ORDER BY name ASC`
    );
    const rooms = roomsRaw.map((room) => ({
      ...room,
      color_code: resolveRoomColour(room.id, room.name, room.color_code),
    }));

    res.render("pages/calendar/index", {
      layout: "layouts/main",
      title: "Calendar",
      active: "calendar",
      pageType: "calendar",
      rooms,
      teamupConfigStatus,
      calendarConfig: {
        daySlotMinutes,
        teamupConfigured: teamupConfigStatus.configured,
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

router.get("/teamup/connection-test", async (req, res) => {
  try {
    const config = await getTeamupConfig();
    if (!config) {
      return res.status(400).json({
        success: false,
        error: "Teamup credentials are not configured. Go to Settings → Teamup Integration to add them.",
      });
    }

    // Diagnostic: show first 6 + last 4 chars so user can verify correct key was saved
    const tok = config.apiToken || "";
    const tokenPreview = tok.length > 10
      ? `${tok.slice(0, 6)}${"*".repeat(Math.max(0, tok.length - 10))}${tok.slice(-4)}`
      : tok.length > 0 ? "***" : "(empty)";

    // Step 1: validate API key via Teamup's dedicated check-access endpoint
    const checkRes = await fetch("https://api.teamup.com/check-access", {
      headers: getTeamupHeaders(config),
    });
    if (!checkRes.ok) {
      const body = await checkRes.json().catch(() => ({}));
      const msg = body?.error?.message || body?.error?.title || `API key rejected (${checkRes.status})`;
      return res.status(400).json({
        success: false,
        error: `API key invalid: ${msg}`,
        tokenPreview,
        hint: "Check the API key was copied in full with no spaces. Teamup sends it by email after sign-up.",
      });
    }

    // Step 2: verify the calendar key by fetching today's events
    const today = formatLocalDate(new Date());
    const tomorrow = addDaysToDateString(today, 1);
    const events = await fetchTeamupEventsFromApi({ startDate: today, endDate: tomorrow, config });
    const filteredCount = config.subcalendarIds?.length
      ? events.filter((event) => config.subcalendarIds.includes(Number(event?.subcalendar_id))).length
      : events.length;
    return res.json({
      success: true,
      message: "Teamup API connection successful.",
      eventsFetched: events.length,
      eventsAfterSubcalendarFilter: filteredCount,
      tokenPreview,
    });
  } catch (err) {
    console.error("[Calendar] Teamup connection test failed:", err);
    if (String(err.message || "").includes('login_required')) {
      return res.status(400).json({
        success: false,
        error: "API key is accepted, but this calendar key requires Teamup account authentication. Add the optional Bearer Auth Token in Settings → Teamup Integration.",
      });
    }
    return res.status(500).json({
      success: false,
      error: err.message || "Unable to connect to Teamup API.",
    });
  }
});

router.get("/teamup/subcalendars", async (req, res) => {
  try {
    const config = await getTeamupConfig();
    if (!config) {
      return res.status(400).json({
        success: false,
        error: "Teamup credentials are not configured. Go to Settings → Teamup Integration to add them.",
      });
    }
    const url = new URL(`https://api.teamup.com/${encodeURIComponent(config.calendarKey)}/subcalendars`);
    const response = await fetch(url.toString(), {
      headers: getTeamupHeaders(config),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Teamup API error (${response.status}): ${text || response.statusText}`);
    }
    const payload = await response.json();
    const subcalendars = Array.isArray(payload?.subcalendars) ? payload.subcalendars : [];
    return res.json({
      success: true,
      subcalendars: subcalendars.map((sub) => ({
        id: sub.id,
        name: sub.name,
        color: sub.color,
        active: sub.active !== false,
      })),
    });
  } catch (err) {
    console.error("[Calendar] Teamup subcalendars fetch failed:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Unable to load subcalendars.",
    });
  }
});

router.get("/events", async (req, res) => {
  try {
    const types = parseTypes(req.query.include);
    const includeFunctions = types.includes("functions");
    const includeRestaurant = types.includes("restaurant");
    const includeEntertainment = types.includes("entertainment");
    const includeTeamup = types.includes("teamup");
    const roomIds = parseRoomFilter(req.query.rooms);
    const functionStatuses = parseFunctionStatusFilter(req.query.statuses);
    const startDate = normaliseDate(req.query.start);
    const endDate = normaliseDate(req.query.end);

    const events = [];

    if (includeFunctions) {
      await ensureFunctionEndDateColumn();
      await ensureFunctionRoomAllocationsTable();
      const whereParts = ["f.event_date IS NOT NULL", "LOWER(COALESCE(f.status, 'lead')) <> 'cancelled'"];
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
      } else {
        params.push(["lead", "confirmed"]);
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

    if (includeTeamup) {
      const now = new Date();
      const autoStart = startDate || addDaysToDateString(formatLocalDate(now), -TEAMUP_SYNC_LOOKBACK_DAYS);
      const autoEnd = endDate || addDaysToDateString(formatLocalDate(now), TEAMUP_SYNC_LOOKAHEAD_DAYS);
      try {
        await syncTeamupEventsRange({ startDate: autoStart, endDate: autoEnd, force: false });
      } catch (teamupErr) {
        console.warn("[Calendar] Teamup auto-sync skipped:", teamupErr.message);
      }
      const teamupRows = await fetchTeamupEventsBetween(startDate, endDate);
      teamupRows.forEach((row) => events.push(mapTeamupEventRow(row)));
    }

    res.json(events);
  } catch (err) {
    console.error("[Calendar] Failed to load events:", err);
    res.status(500).json({ success: false, error: "Unable to load calendar events." });
  }
});

router.post("/teamup/sync", async (req, res) => {
  try {
    const startDate = normaliseDate(req.body?.start || req.query?.start);
    const endDate = normaliseDate(req.body?.end || req.query?.end);
    const today = formatLocalDate(new Date());
    const effectiveStart = startDate || addDaysToDateString(today, -TEAMUP_SYNC_LOOKBACK_DAYS);
    const effectiveEnd = endDate || addDaysToDateString(today, TEAMUP_SYNC_LOOKAHEAD_DAYS);
    const result = await syncTeamupEventsRange({
      startDate: effectiveStart,
      endDate: effectiveEnd,
      force: true,
    });
    res.json({
      success: true,
      startDate: effectiveStart,
      endDate: effectiveEnd,
      ...result,
    });
  } catch (err) {
    console.error("[Calendar] Teamup sync failed:", err);
    res.status(500).json({ success: false, error: err.message || "Unable to sync Teamup events." });
  }
});

router.get("/teamup/functions", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const includeFunctionId = String(req.query.includeFunctionId || "").trim();
    const unlinkedOnly = ["1", "true", "yes"].includes(String(req.query.unlinkedOnly || "").toLowerCase());
    const params = [];
    const whereParts = ["LOWER(COALESCE(f.status, 'lead')) <> 'cancelled'"];
    if (query) {
      params.push(`%${query.toLowerCase()}%`);
      whereParts.push(`LOWER(COALESCE(f.event_name, '')) LIKE $${params.length}`);
    }
    if (unlinkedOnly) {
      if (includeFunctionId) {
        params.push(includeFunctionId);
        whereParts.push(`(te.id IS NULL OR f.id_uuid = $${params.length})`);
      } else {
        whereParts.push("te.id IS NULL");
      }
    }
    const { rows } = await pool.query(
      `
      SELECT f.id_uuid, f.event_name, f.event_date, f.status
        FROM functions f
        LEFT JOIN teamup_events te ON te.linked_function_id = f.id_uuid
       WHERE ${whereParts.join(" AND ")}
       GROUP BY f.id_uuid, f.event_name, f.event_date, f.status
       ORDER BY f.event_date DESC NULLS LAST, f.event_name ASC
       LIMIT 150;
      `,
      params
    );
    res.json({ success: true, items: rows });
  } catch (err) {
    console.error("[Calendar] Teamup function lookup failed:", err);
    res.status(500).json({ success: false, error: "Unable to load functions." });
  }
});

router.post("/teamup/:id/description", async (req, res) => {
  try {
    const eventId = Number.parseInt(String(req.params.id || ""), 10);
    if (!Number.isInteger(eventId)) {
      return res.status(400).json({ success: false, error: "Invalid Teamup event id." });
    }
    const incoming = req.body?.description;
    const value = incoming === undefined || incoming === null ? null : String(incoming);
    await ensureTeamupEventsTable();
    const { rows } = await pool.query(
      `
      UPDATE teamup_events
         SET local_description_override = $1,
             updated_at = NOW()
       WHERE id = $2
       RETURNING id;
      `,
      [value && value.trim().length ? value : null, eventId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Teamup event not found." });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("[Calendar] Teamup description update failed:", err);
    res.status(500).json({ success: false, error: "Unable to update Teamup description." });
  }
});

router.post("/teamup/:id/link", async (req, res) => {
  try {
    const eventId = Number.parseInt(String(req.params.id || ""), 10);
    if (!Number.isInteger(eventId)) {
      return res.status(400).json({ success: false, error: "Invalid Teamup event id." });
    }
    const functionIdRaw = String(req.body?.functionId || "").trim();
    let functionId = null;
    if (functionIdRaw) {
      const { rows: fnRows } = await pool.query(
        `SELECT id_uuid FROM functions WHERE id_uuid = $1 LIMIT 1;`,
        [functionIdRaw]
      );
      if (!fnRows.length) {
        return res.status(404).json({ success: false, error: "Function not found." });
      }
      functionId = fnRows[0].id_uuid;
    }
    await ensureTeamupEventsTable();
    const { rows } = await pool.query(
      `
      UPDATE teamup_events
         SET linked_function_id = $1,
             updated_at = NOW()
       WHERE id = $2
       RETURNING id;
      `,
      [functionId, eventId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Teamup event not found." });
    }
    return res.json({ success: true, linkedFunctionId: functionId });
  } catch (err) {
    console.error("[Calendar] Teamup link update failed:", err);
    res.status(500).json({ success: false, error: "Unable to update Teamup link." });
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
      canManage: Boolean(req.session?.user),
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
        { db: client, suppressEmail, allowOutsideWindow: true }
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
    if (normaliseDate(req.query.booking_date) === FATHERS_DAY_BOOKING_DATE) {
      return res.redirect(FATHERS_DAY_BOOKING_PATH);
    }
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
    if (normaliseDate(req.body.booking_date) === FATHERS_DAY_BOOKING_DATE) {
      return res.redirect(FATHERS_DAY_BOOKING_PATH);
    }
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

router.get("/restaurant/book/fathers-day", async (req, res) => {
  try {
    const services = await fetchFathersDayServices();
    res.render("pages/calendar/restaurant-book-fathers-day", {
      layout: false,
      title: "Eastwood Restaurant Father's Day Buffet Booking",
      services,
      bookingDate: FATHERS_DAY_BOOKING_DATE,
      bookingTimes: FATHERS_DAY_BOOKING_TIMES,
      menuLabel: FATHERS_DAY_MENU_LABEL,
      success: req.query.success === "1",
      errorMessage: null,
      formData: {},
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to load Father's Day form:", err);
    res.status(500).send("Unable to load the Father's Day booking form.");
  }
});

router.post("/restaurant/book/fathers-day", async (req, res) => {
  let services = [];
  try {
    services = await fetchFathersDayServices();
    const [serviceIdValue, bookingTimeValue] = String(req.body.booking_slot || "").split("|");
    const serviceId = Number(serviceIdValue);
    const bookingTime = normaliseTime(bookingTimeValue);
    const service = services.find((item) => Number(item.id) === serviceId);
    if (!service || !bookingTime) {
      throw new Error("Please choose an available service time.");
    }
    if (!FATHERS_DAY_BOOKING_TIMES.includes(bookingTime.slice(0, 5))) {
      throw new Error("Please choose an available service time.");
    }
    if (bookingTime < service.start_time || bookingTime > service.end_time) {
      throw new Error("That time is outside the selected service.");
    }

    await createRestaurantBooking({
      partyName: req.body.party_name,
      bookingDate: FATHERS_DAY_BOOKING_DATE,
      bookingTime,
      size: req.body.size,
      serviceId,
      menuType: FATHERS_DAY_MENU_LABEL,
      price: service.special_menu_price || null,
      notes: req.body.notes,
      contactEmail: req.body.contact_email,
      contactPhone: req.body.contact_phone,
      channel: "online",
      status: "pending",
    });
    res.redirect("/calendar/restaurant/book/fathers-day?success=1");
  } catch (err) {
    console.error("[Restaurant Calendar] Father's Day booking failed:", err);
    const message = isCapacityError(err)
      ? CAPACITY_CONTACT_MESSAGE
      : err.message || "Unable to submit booking";
    res.status(400).render("pages/calendar/restaurant-book-fathers-day", {
      layout: false,
      title: "Eastwood Restaurant Father's Day Buffet Booking",
      services,
      bookingDate: FATHERS_DAY_BOOKING_DATE,
      bookingTimes: FATHERS_DAY_BOOKING_TIMES,
      menuLabel: FATHERS_DAY_MENU_LABEL,
      success: false,
      errorMessage: message,
      formData: req.body,
    });
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
