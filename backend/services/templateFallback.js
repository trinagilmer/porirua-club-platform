const { sanitizeRichHtml } = require("./htmlSanitizer");

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyTextMarks(text, marks = []) {
  if (!marks || !marks.length) return text;
  return marks.reduce((acc, mark) => {
    const type = mark?.type;
    if (type === "bold") return `<strong>${acc}</strong>`;
    if (type === "italic") return `<em>${acc}</em>`;
    if (type === "underline") return `<u>${acc}</u>`;
    if (type === "strike") return `<s>${acc}</s>`;
    if (type === "code") return `<code>${acc}</code>`;
    if (type === "link") {
      const href = mark?.attrs?.href || "";
      const safeHref = escapeHtml(href);
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${acc}</a>`;
    }
    return acc;
  }, text);
}

function renderTipTapNode(node) {
  if (!node) return "";

  const children = Array.isArray(node.content)
    ? node.content.map(renderTipTapNode).join("")
    : "";

  switch (node.type) {
    case "doc":
      return children;
    case "paragraph":
      return `<p>${children || "<br>"}</p>`;
    case "text": {
      const text = escapeHtml(node.text || "");
      return applyTextMarks(text, node.marks || []);
    }
    case "heading": {
      const level = Number(node?.attrs?.level) || 2;
      const safeLevel = Math.min(6, Math.max(1, level));
      return `<h${safeLevel}>${children}</h${safeLevel}>`;
    }
    case "bulletList":
      return `<ul>${children}</ul>`;
    case "orderedList":
      return `<ol>${children}</ol>`;
    case "listItem":
      return `<li>${children}</li>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    case "hardBreak":
      return "<br>";
    case "horizontalRule":
      return "<hr>";
    case "codeBlock":
      return `<pre><code>${children}</code></pre>`;
    case "table":
      return `<table>${children}</table>`;
    case "tableRow":
      return `<tr>${children}</tr>`;
    case "tableCell":
      return `<td>${children}</td>`;
    case "tableHeader":
      return `<th>${children}</th>`;
    case "image": {
      const src = escapeHtml(node?.attrs?.src || "");
      if (!src) return "";
      return `<p><img src="${src}" alt="" /></p>`;
    }
    default:
      return children;
  }
}

function renderQuillDelta(delta) {
  const ops = Array.isArray(delta?.ops) ? delta.ops : [];
  if (!ops.length) return "";

  let html = "";
  let line = "";

  const flushLine = () => {
    html += `<p>${line || "<br>"}</p>`;
    line = "";
  };

  for (const op of ops) {
    if (typeof op?.insert === "string") {
      const parts = op.insert.split("\n");
      for (let i = 0; i < parts.length; i += 1) {
        const text = applyTextMarks(escapeHtml(parts[i]), []);
        line += text;
        if (i < parts.length - 1) flushLine();
      }
    } else if (op?.insert && typeof op.insert === "object") {
      if (op.insert.image) {
        flushLine();
        const src = escapeHtml(op.insert.image);
        html += `<p><img src="${src}" alt="" /></p>`;
      }
    }
  }

  if (line) flushLine();
  return html;
}

function convertTemplateJsonToHtml(contentJson) {
  if (!contentJson) return "";

  let parsed = contentJson;
  if (typeof contentJson === "string") {
    const raw = contentJson.trim();
    if (!raw) return "";
    if (raw.startsWith("<")) return raw;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return "";
    }
  }

  if (typeof parsed === "string") return parsed;
  if (parsed?.type === "doc") return renderTipTapNode(parsed);
  if (Array.isArray(parsed?.ops)) return renderQuillDelta(parsed);

  return "";
}

async function backfillTemplateHtmlFallback(pool, templates = []) {
  if (!Array.isArray(templates) || templates.length === 0) return templates;

  const updates = [];
  const hydrated = templates.map((template) => {
    const existingContent = String(template?.content || "").trim();
    if (existingContent) return template;

    const fallbackHtml = sanitizeRichHtml(convertTemplateJsonToHtml(template?.content_json));
    if (!fallbackHtml) return template;

    updates.push({ id: template.id, content: fallbackHtml });
    return { ...template, content: fallbackHtml };
  });

  for (const update of updates) {
    await pool.query(
      `UPDATE note_templates
          SET content = $1,
              updated_at = NOW()
        WHERE id = $2
          AND COALESCE(NULLIF(BTRIM(content), ''), '') = '';`,
      [update.content, update.id]
    );
  }

  return hydrated;
}

module.exports = {
  convertTemplateJsonToHtml,
  backfillTemplateHtmlFallback,
};
