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
    res.render("pages/entertainment/index", {
      layout: "layouts/main",
      title: "Entertainment",
      active: "entertainment",
      entertainmentEvents,
      regularEvents,
      pastEvents: pastRows,
      entertainmentHeaderHtml: feedbackSettings.events_header_html,
    });
  } catch (err) {
    console.error("[Entertainment] Failed to load events:", err);
    res.status(500).send("Unable to load entertainment schedule.");
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
    });
  } catch (err) {
    console.error("[Entertainment] Failed to load event detail:", err);
    res.status(500).send("Unable to load event.");
  }
});

module.exports = router;
