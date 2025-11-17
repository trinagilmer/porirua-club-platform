const express = require("express");
const { pool } = require("../db");

const router = express.Router();

function corsJson(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

router.options("/api/widgets/:name", (req, res) => {
  corsJson(res);
  return res.sendStatus(204);
});

async function fetchPublishedEntertainment(limit) {
  const { rows } = await pool.query(
    `
    SELECT e.id, e.title, e.slug, e.start_at, e.end_at, e.price, e.currency,
           e.description, e.image_url, e.adjunct_name, e.organiser,
           e.external_url, e.event_link, e.venue_name,
           COALESCE(
             json_agg(
               json_build_object('id', a.id, 'name', a.name, 'external_url', a.external_url)
               ORDER BY a.name
             ) FILTER (WHERE a.id IS NOT NULL), '[]'
           ) AS acts
      FROM entertainment_events e
      LEFT JOIN entertainment_event_acts ea ON ea.event_id = e.id
      LEFT JOIN entertainment_acts a ON a.id = ea.act_id
     WHERE e.status = 'published'
       AND COALESCE(e.end_at, e.start_at) >= NOW() - INTERVAL '1 day'
     GROUP BY e.id
     ORDER BY e.start_at ASC NULLS LAST
     LIMIT $1;
    `,
    [limit]
  );
  return rows;
}

router.get("/api/widgets/pc-entertainment", async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isNaN(rawLimit) ? 12 : Math.min(Math.max(rawLimit, 1), 50);
    const events = await fetchPublishedEntertainment(limit);
    corsJson(res);
    res.set("Cache-Control", "no-store");
    res.json({ events, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[Widgets] Failed to load entertainment feed:", err);
    corsJson(res);
    res.status(500).json({ error: "Unable to load entertainment data" });
  }
});

router.get("/widgets/pc-entertainment.js", async (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  const apiUrl = req.query.endpoint || `${base}/api/widgets/pc-entertainment`;
  const detailBase = `${base}/entertainment`;
  res.type("application/javascript");
  res.set("Cache-Control", "no-store");
  res.send(`(function(){
  const scriptEl = document.currentScript;
  const targetSelector = scriptEl?.getAttribute("data-target") || "[data-pc-entertainment]";
  const limit = parseInt(scriptEl?.getAttribute("data-limit") || "8", 10) || 8;
  const theme = (scriptEl?.getAttribute("data-theme") || "light").toLowerCase();
  const endpoint = scriptEl?.getAttribute("data-endpoint") || ${JSON.stringify(apiUrl)};
  const detailBase = scriptEl?.getAttribute("data-detail-base") || ${JSON.stringify(detailBase)};
  const containers = Array.from(document.querySelectorAll(targetSelector));
  if (!containers.length && scriptEl?.parentNode) {
    const fallback = document.createElement("div");
    fallback.setAttribute("data-pc-entertainment", "");
    scriptEl.parentNode.insertBefore(fallback, scriptEl.nextSibling);
    containers.push(fallback);
  }
  if (!containers.length) return;

  const styleId = "pc-entertainment-widget-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    const css = ${JSON.stringify(`
      .pc-ent-widget{font-family:'Inter','Segoe UI',system-ui,sans-serif;display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));}
      .pc-ent-card{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff;color:#111;box-shadow:0 8px 16px rgba(15,23,42,0.08);display:flex;flex-direction:column;min-height:260px;}
      .pc-ent-card.dark{background:#0f172a;color:#f8fafc;border-color:#1f2a44;box-shadow:0 12px 20px rgba(0,0,0,0.4);}
      .pc-ent-img{width:100%;height:160px;background-size:cover;background-position:center;}
      .pc-ent-body{padding:1rem;display:flex;flex-direction:column;gap:0.4rem;flex:1;}
      .pc-ent-date{font-size:0.85rem;color:#475569;text-transform:uppercase;letter-spacing:0.05em;}
      .pc-ent-card.dark .pc-ent-date{color:#cbd5f5;}
      .pc-ent-title{font-size:1.05rem;font-weight:600;margin:0;}
      .pc-ent-meta{font-size:0.85rem;color:#475569;}
      .pc-ent-card.dark .pc-ent-meta{color:#cbd5f5;}
      .pc-ent-acts{font-size:0.82rem;color:#6366f1;}
      .pc-ent-link{margin-top:auto;font-weight:600;color:#2563eb;text-decoration:none;}
      .pc-ent-card.dark .pc-ent-link{color:#a5b4fc;}
      .pc-ent-empty{font-family:'Inter','Segoe UI',system-ui,sans-serif;padding:1rem;border:1px dashed #94a3b8;border-radius:8px;text-align:center;color:#475569;}
    `)};
    style.textContent = css;
    document.head.appendChild(style);
  }

  function fmtDate(value){
    if(!value) return "";
    try {
      return new Date(value).toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
    } catch(err){ return value; }
  }

  function render(container, events){
    if(!events?.length){
      container.innerHTML = '<div class="pc-ent-empty">No scheduled entertainment.</div>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'pc-ent-widget';
    events.forEach((event)=>{
      const card = document.createElement('article');
      card.className = 'pc-ent-card' + (theme === 'dark' ? ' dark' : '');
      if (event.image_url) {
        const img = document.createElement('div');
        img.className = 'pc-ent-img';
        const safeUrl = (event.image_url || '').replace(/'/g, "%27");
        img.style.backgroundImage = "url('" + safeUrl + "')";
        card.appendChild(img);
      }
      const body = document.createElement('div');
      body.className = 'pc-ent-body';
      const dateEl = document.createElement('div');
      dateEl.className = 'pc-ent-date';
      dateEl.textContent = fmtDate(event.start_at);
      body.appendChild(dateEl);
      const title = document.createElement('h3');
      title.className = 'pc-ent-title';
      title.textContent = event.title || 'Entertainment';
      body.appendChild(title);
      if (event.adjunct_name) {
        const adjunct = document.createElement('div');
        adjunct.className = 'pc-ent-meta';
        adjunct.textContent = event.adjunct_name;
        body.appendChild(adjunct);
      }
      if (Array.isArray(event.acts) && event.acts.length) {
        const acts = document.createElement('div');
        acts.className = 'pc-ent-acts';
        acts.textContent = event.acts.map((act)=>act.name).join(', ');
        body.appendChild(acts);
      }
      if (event.description) {
        const desc = document.createElement('p');
        desc.className = 'pc-ent-meta';
        desc.textContent = event.description.length > 140 ? event.description.slice(0,137)+'…' : event.description;
        body.appendChild(desc);
      }
      const link = document.createElement('a');
      link.className = 'pc-ent-link';
      const url = event.external_url || (event.slug ? detailBase + '/' + event.slug : detailBase + '/' + event.id);
      link.href = url;
      link.target = scriptEl?.getAttribute('data-link-target') || '_blank';
      link.rel = 'noopener';
      link.textContent = 'View details';
      body.appendChild(link);
      card.appendChild(body);
      grid.appendChild(card);
    });
    container.innerHTML = '';
    container.appendChild(grid);
  }

  fetch(endpoint + '?limit=' + limit)
    .then((resp)=>resp.json())
    .then((data)=>{
      containers.forEach((container)=>render(container, data.events || []));
    })
    .catch((err)=>{
      console.error('PCEntertainment widget failed:', err);
      containers.forEach((container)=>{
        container.innerHTML = '<div class="pc-ent-empty">Unable to load entertainment.</div>';
      });
    });
})();`);
});

router.get("/api/widgets/pc-bookings/services", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, day_of_week, start_time, end_time, slot_minutes, turn_minutes,
              max_covers_per_slot, max_online_covers
         FROM restaurant_services
        WHERE active = TRUE
        ORDER BY day_of_week, start_time;`
    );
    corsJson(res);
    res.set("Cache-Control", "no-store");
    res.json({ services: rows, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[Widgets] Failed to load restaurant services:", err);
    corsJson(res);
    res.status(500).json({ error: "Unable to load restaurant availability" });
  }
});

router.get("/widgets/pc-bookings.js", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  const formUrl = `${base}/calendar/restaurant/book?embed=1`;
  res.type("application/javascript");
  res.set("Cache-Control", "no-store");
  res.send(`(function(){
  const scriptEl = document.currentScript;
  const targetSelector = scriptEl?.getAttribute('data-target') || '[data-pc-bookings]';
  const height = scriptEl?.getAttribute('data-height') || '640';
  const containers = Array.from(document.querySelectorAll(targetSelector));
  if (!containers.length && scriptEl?.parentNode) {
    const fallback = document.createElement('div');
    fallback.setAttribute('data-pc-bookings','');
    scriptEl.parentNode.insertBefore(fallback, scriptEl.nextSibling);
    containers.push(fallback);
  }
  if (!containers.length) return;
  containers.forEach((container)=>{
    const iframe = document.createElement('iframe');
    iframe.src = scriptEl?.getAttribute('data-src') || ${JSON.stringify(formUrl)};
    iframe.loading = 'lazy';
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.minHeight = height.endsWith('px') ? height : height + 'px';
    iframe.setAttribute('title','Porirua Club Restaurant Booking');
    container.innerHTML = '';
    container.appendChild(iframe);
  });
})();`);
});

module.exports = router;
