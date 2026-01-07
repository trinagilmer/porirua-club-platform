const express = require("express");
const { pool } = require("../db");
const { getFeedbackSettings } = require("../services/feedbackService");

const router = express.Router();

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
}

function normalizeSlug(value, fallback) {
  const base = slugify(value) || slugify(fallback);
  return base || null;
}

function normalizeDateParam(value) {
  if (!value) return null;
  const cleaned = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function normalizeDisplayType(value) {
  const cleaned = String(value || "").trim().toLowerCase();
  if (cleaned === "entertainment" || cleaned === "regularevents") return cleaned;
  return null;
}

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT e.*,
             r.name AS room_name,
             COALESCE(
               json_agg(
                 json_build_object('id', a.id, 'name', a.name, 'external_url', a.external_url)
                 ORDER BY a.name
               ) FILTER (WHERE a.id IS NOT NULL),
               '[]'
             ) AS acts
        FROM entertainment_events e
        LEFT JOIN entertainment_event_acts ea ON ea.event_id = e.id
        LEFT JOIN entertainment_acts a ON a.id = ea.act_id
        LEFT JOIN rooms r ON r.id = e.room_id
       WHERE e.status = 'published'
         AND e.start_at >= NOW() - INTERVAL '1 day'
       GROUP BY e.id, r.name
       ORDER BY e.start_at ASC;
      `
    );
    const { rows: pastRows } = await pool.query(
      `
      SELECT e.*,
             r.name AS room_name,
             COALESCE(
               json_agg(
                 json_build_object('id', a.id, 'name', a.name, 'external_url', a.external_url)
                 ORDER BY a.name
               ) FILTER (WHERE a.id IS NOT NULL),
               '[]'
             ) AS acts
        FROM entertainment_events e
        LEFT JOIN entertainment_event_acts ea ON ea.event_id = e.id
        LEFT JOIN entertainment_acts a ON a.id = ea.act_id
        LEFT JOIN rooms r ON r.id = e.room_id
       WHERE e.status = 'published'
         AND e.start_at < NOW()
       GROUP BY e.id, r.name
       ORDER BY e.start_at DESC
       LIMIT 6;
      `
    );
    const feedbackSettings = await getFeedbackSettings();
    const entertainmentEvents = rows.filter((event) => event.display_type !== "regularevents");
    const regularEvents = rows.filter((event) => event.display_type === "regularevents");
    const viewParam = (req.query.view || "").toLowerCase();
    const initialView = ["month", "week", "agenda", "list", "pinboard"].includes(viewParam)
      ? viewParam
      : "month";
    const typeParam = normalizeDisplayType(req.query.type) || "entertainment";
    res.render("pages/entertainment/index", {
      layout: "layouts/main",
      title: "Entertainment",
      active: "entertainment",
      entertainmentEvents,
      regularEvents,
      pastEvents: pastRows,
      entertainmentHeaderHtml: feedbackSettings.events_header_html,
      showEntertainmentHeader: feedbackSettings.show_entertainment_header,
      initialCalendarView: initialView,
      initialCalendarType: typeParam,
      pageCss: ["https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css"],
      pageJs: [
        "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js",
        "/js/entertainment/calendar.js",
      ],
    });
  } catch (err) {
    console.error("[Entertainment] Failed to load events:", err);
    res.status(500).send("Unable to load entertainment schedule.");
  }
});

router.get("/events", async (req, res) => {
  try {
    const startDate = normalizeDateParam(req.query.start);
    const endDate = normalizeDateParam(req.query.end);
    const displayType = normalizeDisplayType(req.query.type);
    const params = [];
    const where = [`e.status = 'published'`];
    if (startDate) {
      params.push(startDate);
      where.push(`e.start_at >= $${params.length}::date`);
    }
    if (endDate) {
      params.push(endDate);
      where.push(`e.start_at < $${params.length}::date`);
    }
    if (displayType) {
      params.push(displayType);
      where.push(`e.display_type = $${params.length}`);
    }
    const { rows } = await pool.query(
      `
      SELECT e.*, r.name AS room_name
        FROM entertainment_events e
        LEFT JOIN rooms r ON r.id = e.room_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY e.start_at ASC;
      `,
      params
    );
    const events = rows.map((row) => {
      const defaultColor = row.display_type === "regularevents" ? "#e8f5fc" : "#6bb4de";
      const color = row.event_color || defaultColor;
      return {
        id: row.id,
        title: row.title,
        start: row.start_at,
        end: row.end_at,
        url: `/entertainment/${row.slug || row.id}`,
        backgroundColor: color,
        borderColor: color,
        textColor: "#0f172a",
        extendedProps: {
          display_type: row.display_type || "entertainment",
          room_name: row.room_name,
          external_url: row.external_url,
        },
      };
    });
    res.json(events);
  } catch (err) {
    console.error("[Entertainment] Failed to load calendar events:", err);
    res.status(500).json({ error: "Unable to load entertainment events." });
  }
});

router.get("/:slugOrId", async (req, res) => {
  try {
    const key = req.params.slugOrId;
    let query;
    let params;
    if (/^\d+$/.test(key)) {
      query = `
        SELECT e.*,
               r.name AS room_name,
               COALESCE(
                 json_agg(
                   json_build_object('id', a.id, 'name', a.name, 'external_url', a.external_url)
                   ORDER BY a.name
                 ) FILTER (WHERE a.id IS NOT NULL),
                 '[]'
               ) AS acts
          FROM entertainment_events e
          LEFT JOIN entertainment_event_acts ea ON ea.event_id = e.id
          LEFT JOIN entertainment_acts a ON a.id = ea.act_id
          LEFT JOIN rooms r ON r.id = e.room_id
         WHERE e.id = $1
         GROUP BY e.id, r.name
         LIMIT 1;
      `;
      params = [Number(key)];
    } else {
      query = `
        SELECT e.*,
               r.name AS room_name,
               COALESCE(
                 json_agg(
                   json_build_object('id', a.id, 'name', a.name, 'external_url', a.external_url)
                   ORDER BY a.name
                 ) FILTER (WHERE a.id IS NOT NULL),
                 '[]'
               ) AS acts
          FROM entertainment_events e
          LEFT JOIN entertainment_event_acts ea ON ea.event_id = e.id
          LEFT JOIN entertainment_acts a ON a.id = ea.act_id
          LEFT JOIN rooms r ON r.id = e.room_id
         WHERE e.slug = $1
         GROUP BY e.id, r.name
         LIMIT 1;
      `;
      params = [key.toLowerCase()];
    }
    const { rows } = await pool.query(query, params);
    const event = rows[0] || null;
    if (!event || event.status !== "published") {
      return res.status(404).render("pages/entertainment/not-found", {
        layout: "layouts/main",
        title: "Event not found",
        active: "entertainment",
      });
    }
    const shareUrl = `${process.env.APP_URL || ""}/entertainment/${event.slug || event.id}`;
    const feedbackSettings = await getFeedbackSettings();
    res.render("pages/entertainment/detail", {
      layout: "layouts/main",
      title: event.title,
      active: "entertainment",
      event,
      shareUrl,
      entertainmentHeaderHtml: feedbackSettings.events_header_html,
      showEntertainmentHeader: feedbackSettings.show_entertainment_header,
    });
  } catch (err) {
    console.error("[Entertainment] Failed to load event detail:", err);
    res.status(500).send("Unable to load event.");
  }
});

module.exports = router;
