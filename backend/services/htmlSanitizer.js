function sanitizeRichHtml(input) {
  if (!input) return "";
  let html = String(input);

  // Remove dangerous elements entirely.
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, "");

  // Remove inline event handlers like onclick="...".
  html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Remove inline styles to avoid CSS-based injection vectors.
  html = html.replace(/\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Block javascript: and data:text/html URLs in href/src.
  html = html.replace(/\s(href|src)\s*=\s*(["'])\s*(javascript:|data:text\/html)[^"']*\2/gi, " $1=$2#$2");
  html = html.replace(/\s(href|src)\s*=\s*([^\s>]+)(?=[\s>])/gi, (match, attr, raw) => {
    const value = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
    if (/^(javascript:|data:text\/html)/i.test(value)) {
      return ` ${attr}="#"`;
    }
    return match;
  });

  return html.trim();
}

module.exports = {
  sanitizeRichHtml,
};
