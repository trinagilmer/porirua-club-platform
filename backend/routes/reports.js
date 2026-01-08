const express = require("express");
const ExcelJS = require("exceljs");
const { pool } = require("../db");

const router = express.Router();

const REPORT_TYPES = [
  { value: "functions", label: "Functions", category: "Functions" },
  { value: "payments-balance", label: "Payments & balance", category: "Functions" },
  { value: "booking-pipeline", label: "Booking pipeline", category: "Functions" },
  { value: "revenue-by-room", label: "Revenue by room", category: "Functions" },
  { value: "revenue-by-menu", label: "Revenue by menu", category: "Functions" },
  { value: "upcoming-functions", label: "Upcoming functions", category: "Functions" },
  { value: "cancellations", label: "Cancellations", category: "Functions" },
  { value: "restaurant", label: "Restaurant bookings", category: "Restaurant" },
  { value: "restaurant-performance", label: "Restaurant performance", category: "Restaurant" },
  { value: "entertainment", label: "Entertainment events", category: "Entertainment" },
  { value: "entertainment-performance", label: "Entertainment performance", category: "Entertainment" },
  { value: "contact-value", label: "Contacts (spend)", category: "Contacts" },
];

const REPORT_CARDS = [
  {
    title: "Payments & balance",
    description: "Track subtotal, discounts, payments, and remaining balance by function.",
    type: "payments-balance",
    icon: "bi-cash-stack",
    category: "Functions",
  },
  {
    title: "Booking pipeline",
    description: "See counts and revenue by function status for the selected dates.",
    type: "booking-pipeline",
    icon: "bi-bar-chart",
    category: "Functions",
  },
  {
    title: "Revenue by room",
    description: "Compare revenue, cost, and profit across rooms.",
    type: "revenue-by-room",
    icon: "bi-door-open",
    category: "Functions",
  },
  {
    title: "Revenue by menu",
    description: "Understand menu contribution based on quoted items.",
    type: "revenue-by-menu",
    icon: "bi-journal-text",
    category: "Functions",
  },
  {
    title: "Upcoming functions",
    description: "Upcoming schedule with status, attendees, and value.",
    type: "upcoming-functions",
    icon: "bi-calendar-event",
    category: "Functions",
  },
  {
    title: "Cancellations",
    description: "Monitor cancelled functions and reasons provided.",
    type: "cancellations",
    icon: "bi-x-octagon",
    category: "Functions",
  },
  {
    title: "Restaurant bookings",
    description: "Bookings and guest volume for the date range.",
    type: "restaurant",
    icon: "bi-cup-hot",
    category: "Restaurant",
  },
  {
    title: "Restaurant performance",
    description: "Bookings and guests split by service with status breakdowns.",
    type: "restaurant-performance",
    icon: "bi-speedometer2",
    category: "Restaurant",
  },
  {
    title: "Entertainment events",
    description: "Entertainment schedule details for the selected dates.",
    type: "entertainment",
    icon: "bi-music-note-beamed",
    category: "Entertainment",
  },
  {
    title: "Entertainment performance",
    description: "Event counts by room with status summary.",
    type: "entertainment-performance",
    icon: "bi-activity",
    category: "Entertainment",
  },
  {
    title: "Contacts (spend)",
    description: "Top contacts by revenue and profit contribution.",
    type: "contact-value",
    icon: "bi-people",
    category: "Contacts",
  },
];

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
       AND COALESCE(f.status, '') <> 'cancelled'
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
     AND COALESCE(f.status, '') <> 'cancelled'
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

async function loadPaymentsBalanceReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    WITH latest_proposals AS (
      SELECT DISTINCT ON (p.function_id) p.id, p.function_id, p.created_at
        FROM proposals p
       ORDER BY p.function_id, p.created_at DESC
    )
    SELECT f.id_uuid,
           f.event_name,
           f.event_date,
           f.status,
           COALESCE(r.name, 'Unassigned') AS room_name,
           COALESCE(pt.subtotal, f.totals_price, 0) AS subtotal,
           COALESCE(pt.discount_amount, 0) AS discount_amount,
           COALESCE(pay.total_paid, 0) AS total_paid,
           COALESCE(pt.subtotal, f.totals_price, 0) - COALESCE(pt.discount_amount, 0) - COALESCE(pay.total_paid, 0) AS remaining_due
      FROM functions f
      LEFT JOIN latest_proposals lp ON lp.function_id = f.id_uuid
      LEFT JOIN proposal_totals pt ON pt.proposal_id = lp.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount), 0) AS total_paid
          FROM payments p
         WHERE p.proposal_id = lp.id
      ) pay ON true
      LEFT JOIN rooms r ON r.id = f.room_id
     WHERE f.event_date BETWEEN $1 AND $2
       AND COALESCE(f.status, '') <> 'cancelled'
     ORDER BY f.event_date ASC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalSubtotal += Number(row.subtotal) || 0;
      acc.totalDiscount += Number(row.discount_amount) || 0;
      acc.totalPaid += Number(row.total_paid) || 0;
      acc.totalRemaining += Number(row.remaining_due) || 0;
      return acc;
    },
    { totalSubtotal: 0, totalDiscount: 0, totalPaid: 0, totalRemaining: 0 }
  );
  return {
    rows,
    summary,
    meta: {
      summary: [
        { label: "Functions", value: rows.length },
        { label: "Subtotal", value: summary.totalSubtotal, format: "currency" },
        { label: "Discounts", value: summary.totalDiscount, format: "currency" },
        { label: "Payments", value: summary.totalPaid, format: "currency" },
        { label: "Balance due", value: summary.totalRemaining, format: "currency" },
      ],
      columns: [
        { label: "Event", key: "event_name" },
        { label: "Date", key: "event_date", format: "date" },
        { label: "Status", key: "status" },
        { label: "Room", key: "room_name" },
        { label: "Subtotal", key: "subtotal", format: "currency" },
        { label: "Discount", key: "discount_amount", format: "currency" },
        { label: "Payments", key: "total_paid", format: "currency" },
        { label: "Balance due", key: "remaining_due", format: "currency" },
      ],
    },
  };
}

async function loadBookingPipelineReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT COALESCE(status, 'unspecified') AS status,
           COUNT(*) AS function_count,
           COALESCE(SUM(totals_price), 0) AS total_revenue,
           COALESCE(SUM(totals_cost), 0) AS total_cost
      FROM functions
     WHERE event_date BETWEEN $1 AND $2
       AND COALESCE(status, '') <> 'cancelled'
     GROUP BY COALESCE(status, 'unspecified')
     ORDER BY function_count DESC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalFunctions += Number(row.function_count) || 0;
      acc.totalRevenue += Number(row.total_revenue) || 0;
      acc.totalCost += Number(row.total_cost) || 0;
      return acc;
    },
    { totalFunctions: 0, totalRevenue: 0, totalCost: 0 }
  );
  summary.totalProfit = summary.totalRevenue - summary.totalCost;
  const withProfit = rows.map((row) => ({
    ...row,
    total_profit: (Number(row.total_revenue) || 0) - (Number(row.total_cost) || 0),
  }));
  return {
    rows: withProfit,
    summary,
    meta: {
      summary: [
        { label: "Functions", value: summary.totalFunctions },
        { label: "Revenue", value: summary.totalRevenue, format: "currency" },
        { label: "Profit", value: summary.totalProfit, format: "currency" },
      ],
      columns: [
        { label: "Status", key: "status" },
        { label: "Functions", key: "function_count" },
        { label: "Revenue", key: "total_revenue", format: "currency" },
        { label: "Cost", key: "total_cost", format: "currency" },
        { label: "Profit", key: "total_profit", format: "currency" },
      ],
    },
  };
}

async function loadRevenueByRoomReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT COALESCE(r.name, 'Unassigned') AS room_name,
           COUNT(*) AS function_count,
           COALESCE(SUM(f.totals_price), 0) AS revenue,
           COALESCE(SUM(f.totals_cost), 0) AS cost
      FROM functions f
      LEFT JOIN rooms r ON r.id = f.room_id
     WHERE f.event_date BETWEEN $1 AND $2
       AND COALESCE(f.status, '') <> 'cancelled'
     GROUP BY COALESCE(r.name, 'Unassigned')
     ORDER BY revenue DESC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalFunctions += Number(row.function_count) || 0;
      acc.totalRevenue += Number(row.revenue) || 0;
      acc.totalCost += Number(row.cost) || 0;
      return acc;
    },
    { totalFunctions: 0, totalRevenue: 0, totalCost: 0 }
  );
  summary.totalProfit = summary.totalRevenue - summary.totalCost;
  const withProfit = rows.map((row) => ({
    ...row,
    profit: (Number(row.revenue) || 0) - (Number(row.cost) || 0),
  }));
  return {
    rows: withProfit,
    summary,
    meta: {
      summary: [
        { label: "Functions", value: summary.totalFunctions },
        { label: "Revenue", value: summary.totalRevenue, format: "currency" },
        { label: "Profit", value: summary.totalProfit, format: "currency" },
      ],
      columns: [
        { label: "Room", key: "room_name" },
        { label: "Functions", key: "function_count" },
        { label: "Revenue", key: "revenue", format: "currency" },
        { label: "Cost", key: "cost", format: "currency" },
        { label: "Profit", key: "profit", format: "currency" },
      ],
    },
  };
}

async function loadRevenueByMenuReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    WITH latest_proposals AS (
      SELECT DISTINCT ON (p.function_id) p.id, p.function_id, p.created_at
        FROM proposals p
       ORDER BY p.function_id, p.created_at DESC
    )
    SELECT COALESCE(m.name, 'Unassigned') AS menu_name,
           COUNT(DISTINCT f.id_uuid) AS function_count,
           COUNT(*) AS item_count,
           COALESCE(SUM(pi.unit_price), 0) AS revenue
      FROM functions f
      JOIN latest_proposals lp ON lp.function_id = f.id_uuid
      JOIN proposal_items pi ON pi.proposal_id = lp.id
      LEFT JOIN menus m
        ON m.id = NULLIF(substring(pi.description from '\\[menu_id:(\\d+)\\]'), '')::int
     WHERE f.event_date BETWEEN $1 AND $2
       AND COALESCE(f.status, '') <> 'cancelled'
       AND pi.description ~ '\\[menu_id:\\d+\\]'
       AND pi.description NOT ILIKE '%[excluded:true]%'
     GROUP BY COALESCE(m.name, 'Unassigned')
     ORDER BY revenue DESC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalRevenue += Number(row.revenue) || 0;
      acc.totalItems += Number(row.item_count) || 0;
      return acc;
    },
    { totalRevenue: 0, totalItems: 0 }
  );
  return {
    rows,
    summary,
    meta: {
      summary: [
        { label: "Menus", value: rows.length },
        { label: "Items", value: summary.totalItems },
        { label: "Revenue", value: summary.totalRevenue, format: "currency" },
      ],
      columns: [
        { label: "Menu", key: "menu_name" },
        { label: "Functions", key: "function_count" },
        { label: "Items", key: "item_count" },
        { label: "Revenue", key: "revenue", format: "currency" },
      ],
    },
  };
}

async function loadUpcomingFunctionsReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT f.id_uuid,
           f.event_name,
           f.event_date,
           f.start_time,
           f.status,
           COALESCE(r.name, 'Unassigned') AS room_name,
           COALESCE(f.attendees, 0) AS attendees,
           COALESCE(f.totals_price, 0) AS totals_price
      FROM functions f
      LEFT JOIN rooms r ON r.id = f.room_id
     WHERE f.event_date BETWEEN $1 AND $2
       AND COALESCE(f.status, '') <> 'cancelled'
     ORDER BY f.event_date ASC, COALESCE(f.start_time, '00:00:00') ASC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalAttendees += Number(row.attendees) || 0;
      acc.totalRevenue += Number(row.totals_price) || 0;
      return acc;
    },
    { totalAttendees: 0, totalRevenue: 0 }
  );
  return {
    rows,
    summary,
    meta: {
      summary: [
        { label: "Functions", value: rows.length },
        { label: "Attendees", value: summary.totalAttendees },
        { label: "Revenue", value: summary.totalRevenue, format: "currency" },
      ],
      columns: [
        { label: "Event", key: "event_name" },
        { label: "Date", key: "event_date", format: "date" },
        { label: "Start", key: "start_time", format: "time" },
        { label: "Status", key: "status" },
        { label: "Room", key: "room_name" },
        { label: "Attendees", key: "attendees" },
        { label: "Revenue", key: "totals_price", format: "currency" },
      ],
    },
  };
}

async function loadCancellationsReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT f.id_uuid,
           f.event_name,
           f.event_date,
           COALESCE(r.name, 'Unassigned') AS room_name,
           COALESCE(f.cancelled_reason, '') AS cancelled_reason,
           COALESCE(f.totals_price, 0) AS totals_price
      FROM functions f
      LEFT JOIN rooms r ON r.id = f.room_id
     WHERE f.event_date BETWEEN $1 AND $2
       AND COALESCE(f.status, '') = 'cancelled'
     ORDER BY f.event_date ASC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalRevenue += Number(row.totals_price) || 0;
      return acc;
    },
    { totalRevenue: 0 }
  );
  return {
    rows,
    summary,
    meta: {
      summary: [
        { label: "Cancelled", value: rows.length },
        { label: "Lost revenue", value: summary.totalRevenue, format: "currency" },
      ],
      columns: [
        { label: "Event", key: "event_name" },
        { label: "Date", key: "event_date", format: "date" },
        { label: "Room", key: "room_name" },
        { label: "Reason", key: "cancelled_reason" },
        { label: "Total", key: "totals_price", format: "currency" },
      ],
    },
  };
}

async function loadRestaurantPerformanceReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT COALESCE(s.name, 'Unassigned') AS service_name,
           COUNT(*) AS bookings,
           COALESCE(SUM(b.size), 0) AS guests,
           COUNT(*) FILTER (WHERE b.status = 'confirmed') AS confirmed,
           COUNT(*) FILTER (WHERE b.status = 'pending') AS pending,
           COUNT(*) FILTER (WHERE b.status = 'cancelled') AS cancelled
      FROM restaurant_bookings b
      LEFT JOIN restaurant_services s ON s.id = b.service_id
     WHERE b.booking_date BETWEEN $1 AND $2
     GROUP BY COALESCE(s.name, 'Unassigned')
     ORDER BY bookings DESC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalBookings += Number(row.bookings) || 0;
      acc.totalGuests += Number(row.guests) || 0;
      return acc;
    },
    { totalBookings: 0, totalGuests: 0 }
  );
  return {
    rows,
    summary,
    meta: {
      summary: [
        { label: "Bookings", value: summary.totalBookings },
        { label: "Guests", value: summary.totalGuests },
      ],
      columns: [
        { label: "Service", key: "service_name" },
        { label: "Bookings", key: "bookings" },
        { label: "Guests", key: "guests" },
        { label: "Confirmed", key: "confirmed" },
        { label: "Pending", key: "pending" },
        { label: "Cancelled", key: "cancelled" },
      ],
    },
  };
}

async function loadEntertainmentPerformanceReport(range) {
  const params = [formatDateInput(range.start), formatDateInput(range.end)];
  const { rows } = await pool.query(
    `
    SELECT COALESCE(r.name, 'Unassigned') AS room_name,
           COUNT(*) AS events,
           COUNT(*) FILTER (WHERE e.status = 'scheduled') AS scheduled,
           COUNT(*) FILTER (WHERE e.status = 'cancelled') AS cancelled,
           COUNT(*) FILTER (WHERE e.status = 'draft') AS draft
      FROM entertainment_events e
      LEFT JOIN rooms r ON r.id = e.room_id
     WHERE e.start_at::date BETWEEN $1 AND $2
     GROUP BY COALESCE(r.name, 'Unassigned')
     ORDER BY events DESC;
    `,
    params
  );
  const summary = rows.reduce(
    (acc, row) => {
      acc.totalEvents += Number(row.events) || 0;
      return acc;
    },
    { totalEvents: 0 }
  );
  return {
    rows,
    summary,
    meta: {
      summary: [{ label: "Events", value: summary.totalEvents }],
      columns: [
        { label: "Room", key: "room_name" },
        { label: "Events", key: "events" },
        { label: "Scheduled", key: "scheduled" },
        { label: "Cancelled", key: "cancelled" },
        { label: "Draft", key: "draft" },
      ],
    },
  };
}

async function fetchReportData(type, range) {
  if (type === "payments-balance") return loadPaymentsBalanceReport(range);
  if (type === "booking-pipeline") return loadBookingPipelineReport(range);
  if (type === "revenue-by-room") return loadRevenueByRoomReport(range);
  if (type === "revenue-by-menu") return loadRevenueByMenuReport(range);
  if (type === "upcoming-functions") return loadUpcomingFunctionsReport(range);
  if (type === "cancellations") return loadCancellationsReport(range);
  if (type === "restaurant") return loadRestaurantReport(range);
  if (type === "restaurant-performance") return loadRestaurantPerformanceReport(range);
  if (type === "entertainment") return loadEntertainmentReport(range);
  if (type === "entertainment-performance") return loadEntertainmentPerformanceReport(range);
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
    const hasType = typeof req.query.type === "string" && req.query.type.trim() !== "";
    if (!hasType) {
      const range = parseRange(req.query || {});
      return res.render("pages/reports/landing", {
        layout: "layouts/main",
        title: "Reports",
        active: "reports",
        pageType: "reports",
        user: req.session.user || null,
        reportTypes: REPORT_TYPES,
        reportCards: REPORT_CARDS,
        filters: {
          startDate: formatDateInput(range.start),
          endDate: formatDateInput(range.end),
        },
      });
    }
    const type = (req.query.type || "functions").toLowerCase();
    const range = parseRange(req.query || {});
    const { rows, summary, meta } = await fetchReportData(type, range);
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
      reportTypes: REPORT_TYPES,
      report: {
        rows,
        summary,
        meta: meta || null,
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

    if (type === "payments-balance") {
      sheet.columns = [
        { header: "Event", key: "event_name", width: 28 },
        { header: "Date", key: "event_date", width: 16 },
        { header: "Status", key: "status", width: 14 },
        { header: "Room", key: "room_name", width: 18 },
        { header: "Subtotal", key: "subtotal", width: 14 },
        { header: "Discount", key: "discount_amount", width: 14 },
        { header: "Payments", key: "total_paid", width: 14 },
        { header: "Balance due", key: "remaining_due", width: 14 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          event_name: row.event_name,
          event_date: formatDisplayDate(row.event_date),
          status: row.status || "lead",
          room_name: row.room_name || "-",
          subtotal: formatCurrency(row.subtotal),
          discount_amount: formatCurrency(row.discount_amount),
          total_paid: formatCurrency(row.total_paid),
          remaining_due: formatCurrency(row.remaining_due),
        });
      });
    } else if (type === "booking-pipeline") {
      sheet.columns = [
        { header: "Status", key: "status", width: 18 },
        { header: "Functions", key: "function_count", width: 12 },
        { header: "Revenue", key: "total_revenue", width: 14 },
        { header: "Cost", key: "total_cost", width: 14 },
        { header: "Profit", key: "total_profit", width: 14 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          status: row.status,
          function_count: row.function_count || 0,
          total_revenue: formatCurrency(row.total_revenue),
          total_cost: formatCurrency(row.total_cost),
          total_profit: formatCurrency(row.total_profit || 0),
        });
      });
    } else if (type === "revenue-by-room") {
      sheet.columns = [
        { header: "Room", key: "room_name", width: 22 },
        { header: "Functions", key: "function_count", width: 12 },
        { header: "Revenue", key: "revenue", width: 14 },
        { header: "Cost", key: "cost", width: 14 },
        { header: "Profit", key: "profit", width: 14 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          room_name: row.room_name,
          function_count: row.function_count || 0,
          revenue: formatCurrency(row.revenue),
          cost: formatCurrency(row.cost),
          profit: formatCurrency(row.profit || 0),
        });
      });
    } else if (type === "revenue-by-menu") {
      sheet.columns = [
        { header: "Menu", key: "menu_name", width: 24 },
        { header: "Functions", key: "function_count", width: 12 },
        { header: "Items", key: "item_count", width: 10 },
        { header: "Revenue", key: "revenue", width: 14 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          menu_name: row.menu_name,
          function_count: row.function_count || 0,
          item_count: row.item_count || 0,
          revenue: formatCurrency(row.revenue),
        });
      });
    } else if (type === "upcoming-functions") {
      sheet.columns = [
        { header: "Event", key: "event_name", width: 28 },
        { header: "Date", key: "event_date", width: 16 },
        { header: "Start", key: "start_time", width: 12 },
        { header: "Status", key: "status", width: 14 },
        { header: "Room", key: "room_name", width: 18 },
        { header: "Attendees", key: "attendees", width: 12 },
        { header: "Revenue", key: "totals_price", width: 14 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          event_name: row.event_name,
          event_date: formatDisplayDate(row.event_date),
          start_time: formatTime(row.start_time),
          status: row.status || "lead",
          room_name: row.room_name || "-",
          attendees: row.attendees || 0,
          totals_price: formatCurrency(row.totals_price),
        });
      });
    } else if (type === "cancellations") {
      sheet.columns = [
        { header: "Event", key: "event_name", width: 28 },
        { header: "Date", key: "event_date", width: 16 },
        { header: "Room", key: "room_name", width: 18 },
        { header: "Reason", key: "cancelled_reason", width: 40 },
        { header: "Total", key: "totals_price", width: 14 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          event_name: row.event_name,
          event_date: formatDisplayDate(row.event_date),
          room_name: row.room_name || "-",
          cancelled_reason: row.cancelled_reason || "",
          totals_price: formatCurrency(row.totals_price),
        });
      });
    } else if (type === "restaurant") {
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
    } else if (type === "restaurant-performance") {
      sheet.columns = [
        { header: "Service", key: "service_name", width: 24 },
        { header: "Bookings", key: "bookings", width: 12 },
        { header: "Guests", key: "guests", width: 12 },
        { header: "Confirmed", key: "confirmed", width: 12 },
        { header: "Pending", key: "pending", width: 12 },
        { header: "Cancelled", key: "cancelled", width: 12 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          service_name: row.service_name,
          bookings: row.bookings || 0,
          guests: row.guests || 0,
          confirmed: row.confirmed || 0,
          pending: row.pending || 0,
          cancelled: row.cancelled || 0,
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
          organiser: row.organiser || "-",
        });
      });
    } else if (type === "entertainment-performance") {
      sheet.columns = [
        { header: "Room", key: "room_name", width: 24 },
        { header: "Events", key: "events", width: 12 },
        { header: "Scheduled", key: "scheduled", width: 12 },
        { header: "Cancelled", key: "cancelled", width: 12 },
        { header: "Draft", key: "draft", width: 12 },
      ];
      rows.forEach((row) => {
        sheet.addRow({
          room_name: row.room_name,
          events: row.events || 0,
          scheduled: row.scheduled || 0,
          cancelled: row.cancelled || 0,
          draft: row.draft || 0,
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
