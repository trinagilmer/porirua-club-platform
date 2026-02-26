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

function getAppBaseUrl(req) {
  const envBase = (process.env.APP_URL || "").trim();
  if (envBase) return envBase.replace(/\/$/, "");
  if (req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.get("host");
    if (host) return `${proto}://${host}`.replace(/\/$/, "");
  }
  return "";
}

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT e.*,
             r.name AS room_name,
             ar.additional_rooms,
             ar.additional_room_names,
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
        LEFT JOIN LATERAL (
          SELECT COALESCE(
                   jsonb_agg(
                     jsonb_build_object('id', rr.id, 'name', rr.name)
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
        ) ar ON TRUE
       WHERE e.status = 'published'
         AND (e.start_at AT TIME ZONE 'Pacific/Auckland')::date >= (NOW() AT TIME ZONE 'Pacific/Auckland')::date
       GROUP BY e.id, r.name, ar.additional_rooms, ar.additional_room_names
       ORDER BY e.start_at ASC;
      `
    );
    const { rows: pastRows } = await pool.query(
      `
      SELECT e.*,
             r.name AS room_name,
             ar.additional_rooms,
             ar.additional_room_names,
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
        LEFT JOIN LATERAL (
          SELECT COALESCE(
                   jsonb_agg(
                     jsonb_build_object('id', rr.id, 'name', rr.name)
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
        ) ar ON TRUE
       WHERE e.status = 'published'
         AND e.display_type <> 'regularevents'
         AND e.start_at < NOW()
       GROUP BY e.id, r.name, ar.additional_rooms, ar.additional_room_names
       ORDER BY e.start_at DESC
       LIMIT 6;
      `
    );
    const feedbackSettings = await getFeedbackSettings();
    const entertainmentEvents = rows.filter((event) => event.display_type !== "regularevents");
    const regularEvents = rows.filter((event) => event.display_type === "regularevents");
    const viewParam = (req.query.view || "").toLowerCase();
    const hasViewParam = Boolean(viewParam);
    const initialView = ["month", "week", "agenda", "list", "pinboard"].includes(viewParam)
      ? viewParam
      : "month";
    const embed = req.query.embed === "1";
    const safeInitialView = embed && !hasViewParam ? "pinboard" : initialView;
    const typeParam = normalizeDisplayType(req.query.type) || "entertainment";
    res.render("pages/entertainment/index", {
      layout: "layouts/main",
      hideChrome: embed,
      title: "Entertainment",
      active: "entertainment",
      entertainmentEvents,
      regularEvents,
      pastEvents: pastRows,
      entertainmentHeaderHtml: feedbackSettings.events_header_html,
      showEntertainmentHeader: feedbackSettings.show_entertainment_header,
      initialCalendarView: safeInitialView,
      initialCalendarType: typeParam,
      embed,
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
    const where = [
      `e.status = 'published'`,
      `(e.start_at AT TIME ZONE 'Pacific/Auckland')::date >= (NOW() AT TIME ZONE 'Pacific/Auckland')::date`,
    ];
    if (startDate) {
      params.push(startDate);
      where.push(`(e.start_at AT TIME ZONE 'Pacific/Auckland')::date >= $${params.length}::date`);
    }
    if (endDate) {
      params.push(endDate);
      where.push(`(e.start_at AT TIME ZONE 'Pacific/Auckland')::date < $${params.length}::date`);
    }
    if (displayType) {
      params.push(displayType);
      where.push(`e.display_type = $${params.length}`);
    }
    const { rows } = await pool.query(
      `
      WITH series_colors AS (
        SELECT DISTINCT ON (series_id) series_id, event_color AS series_color
          FROM entertainment_events
         WHERE series_id IS NOT NULL
           AND event_color IS NOT NULL
         ORDER BY series_id, series_order ASC NULLS LAST, start_at ASC
      )
      SELECT e.*, r.name AS room_name,
             ar.additional_rooms,
             ar.additional_room_names,
             COALESCE(e.event_color, sc.series_color) AS effective_event_color
        FROM entertainment_events e
        LEFT JOIN rooms r ON r.id = e.room_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(
                   jsonb_agg(
                     jsonb_build_object('id', rr.id, 'name', rr.name)
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
        ) ar ON TRUE
        LEFT JOIN series_colors sc ON sc.series_id = e.series_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY e.start_at ASC;
      `,
      params
    );
    const events = rows.map((row) => {
      const defaultColor = row.display_type === "regularevents" ? "#e8f5fc" : "#6bb4de";
      const color = row.effective_event_color || row.event_color || defaultColor;
      const additionalRooms = Array.isArray(row.additional_rooms) ? row.additional_rooms : [];
      const additionalRoomNames = Array.isArray(row.additional_room_names)
        ? row.additional_room_names
        : [];
      const roomNames = [row.room_name, ...additionalRoomNames].filter(Boolean);
      const roomIds = [row.room_id, ...additionalRooms.map((room) => room.id)]
        .filter((id) => Number.isInteger(id));
      return {
        id: row.id,
        title: row.title,
        start: row.start_at,
        end: row.end_at,
        url: `/entertainment/${row.slug || row.id}`,
        color,
        backgroundColor: color,
        borderColor: color,
        textColor: "#0f172a",
        extendedProps: {
          display_type: row.display_type || "entertainment",
          event_color: row.effective_event_color || row.event_color || null,
          room_name: row.room_name,
          room_names: roomNames,
          room_ids: roomIds,
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
               ar.additional_rooms,
               ar.additional_room_names,
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
          LEFT JOIN LATERAL (
            SELECT COALESCE(
                     jsonb_agg(
                       jsonb_build_object('id', rr.id, 'name', rr.name)
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
          ) ar ON TRUE
         WHERE e.id = $1
         GROUP BY e.id, r.name, ar.additional_rooms, ar.additional_room_names
         LIMIT 1;
      `;
      params = [Number(key)];
    } else {
      query = `
        SELECT e.*,
               r.name AS room_name,
               ar.additional_rooms,
               ar.additional_room_names,
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
          LEFT JOIN LATERAL (
            SELECT COALESCE(
                     jsonb_agg(
                       jsonb_build_object('id', rr.id, 'name', rr.name)
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
          ) ar ON TRUE
         WHERE e.slug = $1
         GROUP BY e.id, r.name, ar.additional_rooms, ar.additional_room_names
         LIMIT 1;
      `;
      params = [key.toLowerCase()];
    }
    const { rows } = await pool.query(query, params);
    const event = rows[0] || null;
    if (!event || event.status !== "published") {
      const embed = req.query.embed === "1";
      return res.status(404).render("pages/entertainment/not-found", {
        layout: "layouts/main",
        hideChrome: embed,
        title: "Event not found",
        active: "entertainment",
        embed,
      });
    }
    const baseUrl = getAppBaseUrl(req);
    const shareUrl = `${baseUrl}/entertainment/${event.slug || event.id}`;
    const feedbackSettings = await getFeedbackSettings();
    const embed = req.query.embed === "1";
    res.render("pages/entertainment/detail", {
      layout: "layouts/main",
      hideChrome: embed,
      title: event.title,
      active: "entertainment",
      event,
      shareUrl,
      entertainmentHeaderHtml: feedbackSettings.events_header_html,
      showEntertainmentHeader: feedbackSettings.show_entertainment_header,
      embed,
    });
  } catch (err) {
    console.error("[Entertainment] Failed to load event detail:", err);
    res.status(500).send("Unable to load event.");
  }
});

module.exports = router;
