const express = require("express");
const ExcelJS = require("exceljs");
const { pool } = require("../db");

const router = express.Router();

function isPrivileged(req) {
  const role = (req.session?.user?.role || "").toLowerCase();
  return role === "admin" || role === "owner";
}

function ensurePrivileged(req, res, next) {
  if (isPrivileged(req)) return next();
  if (req.xhr || req.headers.accept?.includes("application/json")) {
    return res.status(403).json({ success: false, error: "Admin access required" });
  }
  return res.redirect("/dashboard?error=Admin%20access%20required");
}

function parseDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start, end };
}

function parseRange(query) {
  const start = parseDateOnly(query.start_date);
  const end = parseDateOnly(query.end_date);
  if (start && end && end >= start) {
    return { start, end };
  }
  return getDefaultRange();
}

async function loadFunctionReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT f.id_uuid,
           f.event_name,
           f.status,
           f.event_date,
           f.start_time,
           f.end_time,
           COALESCE(f.attendees, 0) AS attendees,
           COALESCE(f.totals_price, 0) AS totals_price,
           COALESCE(f.totals_cost, 0) AS totals_cost,
           r.name AS room_name,
           u.name AS owner_name
      FROM functions f
      LEFT JOIN rooms r ON r.id = f.room_id
      LEFT JOIN users u ON u.id = f.owner_id
     WHERE f.event_date BETWEEN $1 AND $2
     ORDER BY f.event_date ASC, COALESCE(f.start_time, '00:00:00') ASC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      const status = row.status || "unspecified";
      acc.statusCounts[status] = (acc.statusCounts[status] || 0) + 1;
      acc.totalAttendees += Number(row.attendees) || 0;
      acc.totalRevenue += Number(row.totals_price) || 0;
      acc.totalCost += Number(row.totals_cost) || 0;
      return acc;
    },
    { statusCounts: {}, totalAttendees: 0, totalRevenue: 0, totalCost: 0 }
  );
  summary.totalProfit = summary.totalRevenue - summary.totalCost;
  return { rows, summary };
}

async function loadRestaurantReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT b.id,
           b.party_name,
           b.booking_date,
           b.booking_time,
           b.size,
           b.status,
           b.channel,
           s.name AS service_name
      FROM restaurant_bookings b
      LEFT JOIN restaurant_services s ON s.id = b.service_id
     WHERE b.booking_date BETWEEN $1 AND $2
     ORDER BY b.booking_date ASC, b.booking_time ASC NULLS LAST;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      const status = row.status || "pending";
      acc.statusCounts[status] = (acc.statusCounts[status] || 0) + 1;
      acc.totalGuests += Number(row.size) || 0;
      return acc;
    },
    { statusCounts: {}, totalGuests: 0 }
  );
  return { rows, summary };
}

async function loadEntertainmentReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT e.id,
           e.title,
           e.status,
           e.start_at,
           e.end_at,
           e.organiser,
           e.adjunct_name,
           r.name AS room_name
      FROM entertainment_events e
      LEFT JOIN rooms r ON r.id = e.room_id
     WHERE e.start_at::date BETWEEN $1 AND $2
     ORDER BY e.start_at ASC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      const status = row.status || "scheduled";
      acc.statusCounts[status] = (acc.statusCounts[status] || 0) + 1;
      return acc;
    },
    { statusCounts: {} }
  );
  return { rows, summary };
}

async function loadContactValueReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.name,
      c.email,
      c.phone,
      COUNT(DISTINCT f.id_uuid) AS function_count,
      COALESCE(SUM(f.totals_price), 0) AS revenue,
      COALESCE(SUM(f.totals_cost), 0) AS cost
    FROM contacts c
    JOIN function_contacts fc ON fc.contact_id = c.id
    JOIN functions f ON f.id_uuid = fc.function_id
   WHERE f.event_date BETWEEN $1 AND $2
   GROUP BY c.id
   ORDER BY revenue DESC, c.name ASC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalRevenue += Number(row.revenue) || 0;
      acc.totalCost += Number(row.cost) || 0;
      acc.totalFunctions += Number(row.function_count) || 0;
      if (!acc.topContact || row.revenue > acc.topContact.revenue) {
        acc.topContact = row;
      }
      return acc;
    },
    { totalRevenue: 0, totalCost: 0, totalFunctions: 0, topContact: null }
  );
  summary.totalProfit = summary.totalRevenue - summary.totalCost;
  summary.contactCount = rows.length;
  return { rows, summary };
}

async function fetchReportData(type, range) {
  if (type === "restaurant") return loadRestaurantReport(range);
  if (type === "entertainment") return loadEntertainmentReport(range);
  if (type === "contact-value") return loadContactValueReport(range);
  return loadFunctionReport(range);
}

function formatDisplayDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-NZ", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value) {
  if (!value) return "--";
  if (value instanceof Date) {
    return value.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  }
  const [h, m] = String(value).split(":");
  if (!h) return value;
  const date = new Date(`1970-01-01T${h.padStart(2, "0")}:${(m || "00").padStart(2, "0")}:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
}

function formatCurrency(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
  });
}

router.get("/", ensurePrivileged, async (req, res) => {
  try {
    const type = (req.query.type || "functions").toLowerCase();
    const range = parseRange(req.query || {});
    const { rows, summary } = await fetchReportData(type, range);
    res.render("pages/reports/index", {
      layout: "layouts/main",
      title: "Reports",
      active: "reports",
      pageType: "reports",
      user: req.session.user || null,
      filters: {
        type,
        startDate: formatDateInput(range.start),
        endDate: formatDateInput(range.end),
      },
      report: {
        rows,
        summary,
        helpers: {
          formatDisplayDate,
          formatTime,
          formatCurrency,
        },
      },
    });
  } catch (err) {
    console.error("[Reports] Failed to load page:", err);
    res.status(500).send("Unable to load reports.");
  }
});

router.get("/export", ensurePrivileged, async (req, res) => {
  try {
    const type = (req.query.type || "functions").toLowerCase();
    const range = parseRange(req.query || {});
    const { rows } = await fetchReportData(type, range);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(type.charAt(0).toUpperCase() + type.slice(1));

    if (type === "restaurant") {
      sheet.columns = [
        { header: "Party", key: "party_name", width: 24 },
        { header: "Date", key: "booking_date", width: 14 },
        { header: "Time", key: "booking_time", width: 12 },
        { header: "Guests", key: "size", width: 10 },
        { header: "Status", key: "status", width: 14 },
        { header: "Service", key: "service_name", width: 18 },
        { header: "Channel", key: "channel", width: 12 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          party_name: row.party_name,
          booking_date: formatDisplayDate(row.booking_date),
          booking_time: formatTime(row.booking_time),
          size: row.size || 0,
          status: row.status || "pending",
          service_name: row.service_name || "—",
          channel: row.channel || "internal",
        });
      });
    } else if (type === "entertainment") {
      sheet.columns = [
        { header: "Event", key: "title", width: 30 },
        { header: "Date", key: "start_date", width: 18 },
        { header: "Time", key: "start_time", width: 12 },
        { header: "Status", key: "status", width: 14 },
        { header: "Adjunct", key: "adjunct_name", width: 18 },
        { header: "Organiser", key: "organiser", width: 18 },
      ];
      rows.forEach((row) => {
        const dateObj = row.start_at ? new Date(row.start_at) : null;
        sheet.addRow({
          title: row.title,
          start_date: formatDisplayDate(dateObj),
          start_time: formatTime(dateObj),
          status: row.status || "scheduled",
          adjunct_name: row.adjunct_name || "—",
          organiser: row.organiser || "—",
        });
      });
    } else if (type === "contact-value") {
      sheet.columns = [
        { header: "Contact", key: "name", width: 28 },
        { header: "Email", key: "email", width: 28 },
        { header: "Phone", key: "phone", width: 18 },
        { header: "Functions", key: "function_count", width: 12 },
        { header: "Revenue", key: "revenue", width: 14 },
        { header: "Cost", key: "cost", width: 14 },
        { header: "Profit", key: "profit", width: 14 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          name: row.name,
          email: row.email || "",
          phone: row.phone || "",
          function_count: row.function_count || 0,
          revenue: formatCurrency(row.revenue),
          cost: formatCurrency(row.cost),
          profit: formatCurrency((row.revenue || 0) - (row.cost || 0)),
        });
      });
    } else {
      sheet.columns = [
        { header: "Event", key: "event_name", width: 28 },
        { header: "Date", key: "event_date", width: 16 },
        { header: "Start", key: "start_time", width: 12 },
        { header: "Status", key: "status", width: 14 },
        { header: "Attendees", key: "attendees", width: 12 },
        { header: "Room", key: "room_name", width: 18 },
        { header: "Owner", key: "owner_name", width: 18 },
        { header: "Revenue", key: "totals_price", width: 14 },
        { header: "Cost", key: "totals_cost", width: 14 },
        { header: "Profit", key: "profit", width: 14 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          event_name: row.event_name,
          event_date: formatDisplayDate(row.event_date),
          start_time: formatTime(row.start_time || row.event_time),
          status: row.status || "lead",
          attendees: row.attendees || 0,
          room_name: row.room_name || "—",
          owner_name: row.owner_name || "—",
          totals_price: formatCurrency(row.totals_price),
          totals_cost: formatCurrency(row.totals_cost),
          profit: formatCurrency((row.totals_price || 0) - (row.totals_cost || 0)),
        });
      });
    }

    sheet.getRow(1).font = { bold: true };
    const filename = `${type}-report-${Date.now()}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[Reports] Export failed:", err);
    res.status(500).send("Unable to export report.");
  }
});

module.exports = router;
