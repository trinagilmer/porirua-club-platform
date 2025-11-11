const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const EVENT_TYPES = ["functions", "restaurant", "events"];
const STATUS_COLOURS = {
  lead: "#CBD5F5", // muted indigo
  qualified: "#A5B4FC",
  confirmed: "#A7F3D0",
  balance_due: "#FDE68A",
  completed: "#D1D5DB",
};
const DEFAULT_DAY_SLOT_MINUTES = 30;

const ONE_HOUR_MS = 60 * 60 * 1000;

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

    // Restaurant/events placeholders can be added here later

    res.json(events);
  } catch (err) {
    console.error("[Calendar] Failed to load events:", err);
    res.status(500).json({ success: false, error: "Unable to load calendar events." });
  }
});

module.exports = router;
