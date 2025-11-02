// backend/services/templateRenderer.js
// Uses date-fns-tz's formatInTimeZone to render {{tokens}} with optional pipes (e.g., {{event.start_time|nzTime}})

// backend/services/templateRenderer.js
const { formatInTimeZone } = require("date-fns-tz");
const NZ_TZ = "Pacific/Auckland";

const formatters = {
  // ✅ Preferred names
  date: (v) => {
    if (!v) return "";
    // Wed, 12 Nov 2025
    return formatInTimeZone(new Date(v), NZ_TZ, "EEE, d MMM yyyy");
  },
  time: (v) => {
    if (!v) return "";
    // 3:45 PM
    return formatInTimeZone(new Date(v), NZ_TZ, "h:mm a");
  },

  // ↩️ Back-compat aliases (so old templates still work)
  nzDate: (v) => formatters.date(v),
  nzTime: (v) => formatters.time(v),

  // Other helpers unchanged
  currency: (v) =>
    new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(Number(v || 0)),
  upper: (v) => String(v ?? "").toUpperCase(),
  lower: (v) => String(v ?? "").toLowerCase(),
  title: (v) =>
    String(v ?? "").replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
};

// ---------- Helpers ----------
function getByPath(obj, path) {
  try {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  } catch {
    return undefined;
  }
}

/**
 * Replace {{ token[|pipe] }} occurrences in `html` using `data`.
 * - token: e.g., "event.start_time"
 * - pipe:  e.g., "|nzTime" (see `formatters` above)
 */
function replaceTokens(html, data, extraFormatters = {}) {
  const allFormatters = { ...formatters, ...extraFormatters };

  // Quick helpers to detect date-like values
  const isDateObj = (v) => v instanceof Date && !isNaN(v.getTime?.());
  const isIsoOrYmd = (v) =>
    typeof v === "string" &&
    (/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(v) ||
     /^\d{4}\/\d{2}\/\d{2}$/.test(v));

  return String(html || "").replace(
    /\{\{\s*([a-zA-Z0-9._]+)(\|[a-zA-Z]+)?\s*\}\}/g,
    (_, key, pipe) => {
      const raw = getByPath(data, key);
      if (raw == null) return "";

      // If a pipe is provided, use it.
      if (pipe) {
        const f = pipe.slice(1); // strip '|'
        return allFormatters[f] ? allFormatters[f](raw) : String(raw);
      }

      // No pipe: apply smart defaults for date-like values
      if (isDateObj(raw) || isIsoOrYmd(raw)) {
        return allFormatters.date ? allFormatters.date(raw) : String(raw);
      }

      return String(raw);
    }
  );
}


/**
 * Render a note:
 * - If you have `raw_html` from the editor, use that directly.
 * - If you later store TipTap JSON and want server-side HTML, add a JSON->HTML step here.
 */
async function renderNote({ raw_html, rendered_html, content_json }, data, extraFormatters = {}) {
  const sourceHtml = raw_html || rendered_html || "";
  const merged = replaceTokens(sourceHtml, data, extraFormatters);
  return merged;
}

module.exports = {
  renderNote,
  replaceTokens,
  formatters,
};
