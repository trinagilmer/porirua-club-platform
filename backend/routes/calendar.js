const express = require("express");
const { pool } = require("../db");
const { sendMail } = require("../services/graphService");
const { cca } = require("../auth/msal");

const router = express.Router();

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

const EVENT_TYPES = ["functions", "restaurant", "events"];
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

async function fetchOverrideForService(serviceId, bookingDate) {
  const { rows } = await pool.query(
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

async function fetchServiceById(serviceId) {
  const { rows } = await pool.query(
    `
    SELECT id, name, day_of_week, start_time, end_time,
           slot_minutes, turn_minutes,
           max_covers_per_slot, max_online_covers
      FROM restaurant_services
     WHERE id = $1 AND active = TRUE
     LIMIT 1;
    `,
    [serviceId]
  );
  return rows[0] || null;
}

async function findServiceForSlot(bookingDate, bookingTime, explicitServiceId) {
  const targetDate = normaliseDate(bookingDate);
  if (!targetDate) return null;

  if (explicitServiceId) {
    const service = await fetchServiceById(explicitServiceId);
    if (!service) return null;
    const override = await fetchOverrideForService(service.id, targetDate);
    return {
      ...service,
      slot_minutes_effective: override?.slot_minutes || service.slot_minutes,
      max_covers_effective: override?.max_covers_per_slot ?? service.max_covers_per_slot,
    };
  }

  const dateObj = new Date(targetDate);
  const dow = dateObj.getDay();
  const candidateTime = normaliseTime(bookingTime) || null;

  const { rows } = await pool.query(
    `
    SELECT id, name, start_time, end_time,
           slot_minutes, turn_minutes,
           max_covers_per_slot, max_online_covers
      FROM restaurant_services
     WHERE day_of_week = $1
       AND active = TRUE
     ORDER BY start_time ASC;
    `,
    [dow]
  );

  for (const service of rows) {
    if (!candidateTime) {
      const override = await fetchOverrideForService(service.id, targetDate);
      return {
        ...service,
        slot_minutes_effective: override?.slot_minutes || service.slot_minutes,
        max_covers_effective: override?.max_covers_per_slot ?? service.max_covers_per_slot,
      };
    }
    const withinWindow =
      candidateTime >= service.start_time && candidateTime < service.end_time;
    if (withinWindow) {
      const override = await fetchOverrideForService(service.id, targetDate);
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

async function ensureRestaurantCapacity({
  bookingDate,
  service,
  slotStart,
  slotEnd,
  partySize,
  channel,
}) {
  if (!partySize || partySize <= 0) return;
  const limits = {
    total: service.max_covers_effective || service.max_covers_per_slot || null,
    online: service.max_online_covers || null,
  };
  const startTime = timeStringFromMinutes(slotStart);
  const endTime = timeStringFromMinutes(slotEnd);
  const { rows } = await pool.query(
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
      status: row.status,
      channel: row.channel,
      zone: row.zone_name,
      table: row.table_label,
      notes: row.notes,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone,
      roomName: row.zone_name || row.table_label || "Restaurant",
      detailUrl: row.id ? `/calendar/restaurant/bookings/${row.id}` : null,
    },
  };
}

async function createRestaurantBooking(payload) {
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

  const service = await findServiceForSlot(bookingDate, bookingTime, explicitServiceId);
  if (!service) {
    throw new Error("No service matches the requested time.");
  }

  const { slotStart, slotEnd } = computeSlotBounds(service, bookingTime);
  await ensureRestaurantCapacity({
    bookingDate,
    service,
    slotStart,
    slotEnd,
    partySize: size,
    channel: payload.channel || "internal",
  });

  const result = await pool.query(
    `
    INSERT INTO restaurant_bookings
      (party_name, booking_date, booking_time, size, status, menu_type, price,
       owner_id, service_id, zone_id, table_id, channel,
       contact_email, contact_phone, notes, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
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
      payload.notes || null,
    ]
  );

  const booking = result.rows[0];
  notifyRestaurantTeam(booking, service).catch((err) => {
    console.error("[Restaurant Calendar] Failed to send booking email:", err.message);
  });

  return { booking, service };
}

async function notifyRestaurantTeam(booking, service) {
  try {
    const accessToken = await acquireGraphToken();
    if (!accessToken) throw new Error("Missing Graph token");
    const to = process.env.RESTAURANT_NOTIFICATIONS || "events@poriruaclub.co.nz";
    const subject = `🍽️ New Restaurant Booking: ${booking.party_name} (${booking.size || 0})`;
    const details = [
      `<strong>Name:</strong> ${booking.party_name}`,
      `<strong>Date:</strong> ${booking.booking_date}`,
      `<strong>Time:</strong> ${booking.booking_time || "TBC"}`,
      `<strong>Guests:</strong> ${booking.size || 0}`,
      `<strong>Status:</strong> ${booking.status || "pending"}`,
      `<strong>Channel:</strong> ${booking.channel || "internal"}`,
      `<strong>Service:</strong> ${service?.name || "Auto"}`,
    ];
    if (booking.contact_email) details.push(`<strong>Email:</strong> ${booking.contact_email}`);
    if (booking.contact_phone) details.push(`<strong>Phone:</strong> ${booking.contact_phone}`);
    if (booking.notes) details.push(`<strong>Notes:</strong> ${booking.notes}`);

    const body = `
      <p>A new restaurant booking has been submitted.</p>
      <p>${details.join("<br>")}</p>
      <p><a href="${process.env.APP_URL || "https://poriruaclub.co.nz"}/calendar/restaurant">View calendar</a></p>
    `;

    await sendMail(accessToken, {
      to,
      subject,
      body,
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Booking email skipped:", err.message);
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

    res.json(events);
  } catch (err) {
    console.error("[Calendar] Failed to load events:", err);
    res.status(500).json({ success: false, error: "Unable to load calendar events." });
  }
});

router.get("/restaurant", async (req, res) => {
  try {
    const [servicesRes, zonesRes, tablesRes] = await Promise.all([
      pool.query(
        `SELECT id, name, day_of_week, start_time, end_time, slot_minutes, max_covers_per_slot
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
    ]);

    res.render("pages/calendar/restaurant", {
      layout: "layouts/main",
      title: "Restaurant Calendar",
      active: "restaurant",
      pageType: "calendar",
      services: servicesRes.rows,
      zones: zonesRes.rows,
      tables: tablesRes.rows,
      canManage: isPrivileged(req),
      message: req.query.success ? "Booking saved." : null,
      errorMessage: req.query.error || null,
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
  try {
    await createRestaurantBooking({
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
    });
    res.redirect("/calendar/restaurant?success=1");
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to create booking:", err);
    const message = encodeURIComponent(err.message || "Unable to save booking");
    res.redirect(`/calendar/restaurant?error=${message}`);
  }
});

router.get("/restaurant/book", async (req, res) => {
  try {
    const { rows: services } = await pool.query(
      `SELECT id, name, day_of_week, start_time, end_time
         FROM restaurant_services
        WHERE active = TRUE
        ORDER BY day_of_week, start_time;`
    );
    res.render("pages/calendar/restaurant-book", {
      layout: "layouts/main",
      title: "Book the Restaurant",
      active: "restaurant",
      services,
      success: req.query.success || null,
      errorMessage: req.query.error || null,
    });
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to load booking form:", err);
    res.status(500).send("Unable to load booking form.");
  }
});

router.post("/restaurant/book", async (req, res) => {
  try {
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
    res.redirect("/calendar/restaurant/book?success=1");
  } catch (err) {
    console.error("[Restaurant Calendar] Public booking failed:", err);
    const message = encodeURIComponent(err.message || "Unable to submit booking");
    res.redirect(`/calendar/restaurant/book?error=${message}`);
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
    await pool.query(
      `
      UPDATE restaurant_bookings
         SET status = $1,
             notes = COALESCE($2, notes),
             updated_at = NOW()
       WHERE id = $3;
      `,
      [newStatus, req.body.notes || null, bookingId]
    );
    res.redirect(`/calendar/restaurant/bookings/${bookingId}?success=1`);
  } catch (err) {
    console.error("[Restaurant Calendar] Failed to update booking status:", err);
    const message = encodeURIComponent(err.message || "Unable to update booking");
    res.redirect(`/calendar/restaurant/bookings/${req.params.id}?error=${message}`);
  }
});

module.exports = router;
