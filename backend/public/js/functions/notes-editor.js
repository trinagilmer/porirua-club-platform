// backend/public/js/functions/notes-editor.js
// Edit-in-editor flow: click a note -> load into editor -> preview/save (create or update)

(function () {
  // ---- Helpers ----
  const qs  = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const editorEl     = qs("#noteEditor");
  const tplSelectEl  = qs("#templateSelect");
  const previewPane  = qs("#previewPane");
  const saveBtn      = qs("#saveNote");
  const previewBtn   = qs("#previewNote");

  function toast(msg, type = "info") {
    // Replace with your toast system if you have one
    console[type === "error" ? "error" : "log"](`[Notes] ${msg}`);
  }
  function getFnId() {
    return window.fnContext?.id || window.functionId || null;
  }
  function getStatusRadio() {
    return (qs('input[name="note_status"]:checked') || {}).value || "general";
  }
  function setStatusRadio(val) {
    const v = (val || "general").toLowerCase();
    const input = qs(`input[name="note_status"][value="${v}"]`);
    if (input) input.checked = true;
  }
  function getStatusFromColumn(noteEl) {
    const label = (noteEl.closest(".notes-card")?.querySelector("header span")?.textContent || "").toLowerCase();
    if (label.includes("proposal")) return "proposal";
    if (label.includes("internal")) return "internal";
    return "general";
  }

  // Track which note (if any) we’re editing
  let currentNoteId = null;

  // ---- Editor base setup ----
  if (!editorEl) {
    console.warn("⚠️ notes-editor.js: #noteEditor not found");
    return;
  }
  editorEl.setAttribute("contenteditable", "true");
  editorEl.setAttribute("spellcheck", "true");

  // Basic formatting toolbar via execCommand (already in the page)
  qsa("[data-cmd]").forEach(btn => {
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd;
      const value = btn.dataset.value || null;
      document.execCommand(cmd, false, value);
      editorEl.focus();
    });
  });

  // Link helper is in the EJS; nothing to do here.

  // ---- Token insertion ----
  qsa(".token-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      if (!key) return;
      insertHtmlAtCursor(`{{${key}}}`);
      editorEl.focus();
    });
  });

  function insertHtmlAtCursor(html) {
    editorEl.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      editorEl.innerHTML += html;
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();

    const temp = document.createElement("div");
    temp.innerHTML = html;
    const frag = document.createDocumentFragment();
    let node, lastNode;
    while ((node = temp.firstChild)) lastNode = frag.appendChild(node);
    range.insertNode(frag);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // ---- Template loading ----
  if (tplSelectEl) {
    tplSelectEl.addEventListener("change", () => {
      const id = tplSelectEl.value;
      const tpl = (window.fnContext?.templates || []).find(t => String(t.id) === String(id));
      if (!tpl) return;

      // Clear currentNoteId when loading a template (new note)
      currentNoteId = null;

      if (tpl.content) {
        editorEl.innerHTML = tpl.content;
      } else if (tpl.content_json) {
        editorEl.innerHTML = `
          <p><em>This template only has JSON content (TipTap) and no HTML fallback yet.</em></p>
          <p><em>Paste content here, or update the template in Settings with an HTML fallback.</em></p>
        `;
        toast("Template is JSON-only; add an HTML fallback in Settings to auto-load.", "info");
      } else {
        editorEl.innerHTML = "";
      }
      editorEl.scrollIntoView({ behavior: "smooth", block: "center" });
      editorEl.focus();
    });
  }

  // ---- Quick table buttons (optional) ----
  qsa("[data-insert-table]").forEach(btn => {
    btn.addEventListener("click", () => {
      const rows = parseInt(btn.dataset.rows || "2", 10);
      const cols = parseInt(btn.dataset.cols || "2", 10);
      insertHtmlAtCursor(makeHtmlTable(rows, cols));
      editorEl.focus();
    });
  });
  function makeHtmlTable(rows = 2, cols = 2) {
    let html = '<table style="width:100%;border-collapse:collapse" border="1">';
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) {
        html += "<td style='padding:6px'>Cell</td>";
      }
      html += "</tr>";
    }
    html += "</table>";
    return html;
  }

  // ---- NOTE: Click to edit in the main editor ----
  qsa(".note-item").forEach(item => {
    item.addEventListener("click", (e) => {
      // Avoid clicks on controls if any exist
      if (e.target.closest("button, a, input, select, textarea")) return;

      const id = item.getAttribute("data-note-id");
      const html = qs(".note-html", item)?.innerHTML || "";
      const status = getStatusFromColumn(item);

      currentNoteId = id || null;
      setStatusRadio(status);
      editorEl.innerHTML = html;
      editorEl.scrollIntoView({ behavior: "smooth", block: "center" });
      editorEl.focus();

      // Also clear template select because we’re editing an existing note
      if (tplSelectEl) tplSelectEl.value = "";
    });
  });

  // ---- Save (Create or Update) ----
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const fnId = getFnId();
      if (!fnId) return toast("Missing function ID", "error");

      const rendered_html = editorEl.innerHTML.trim();
      if (!rendered_html) return toast("Nothing to save — the editor is empty", "error");

      const payload = {
        rendered_html,
        content_json: null,  // reserved for future TipTap JSON
        note_type: getStatusRadio(),
      };

      try {
        let endpoint, method = "POST";
        if (currentNoteId) {
          // Update existing
          endpoint = `/functions/notes/${encodeURIComponent(currentNoteId)}/update`;
        } else {
          // Create new
          endpoint = `/functions/${encodeURIComponent(fnId)}/notes/new`;
        }

        const res = await fetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Save failed");

        toast(currentNoteId ? "Note updated" : "Note created");
        // Reset editor to encourage explicit edits
        currentNoteId = null;
        editorEl.innerHTML = "";
        // Reload to refresh the grouped lists
        window.location.reload();
      } catch (err) {
        console.error(err);
        toast(`Save error: ${err.message}`, "error");
      }
    });
  }

  // ---- Preview (server merge) ----
  if (previewBtn && previewPane) {
    previewBtn.addEventListener("click", async () => {
      const fnId = getFnId();
      if (!fnId) return toast("Missing function ID", "error");

      const raw_html = editorEl.innerHTML.trim();
      if (!raw_html) return toast("Nothing to preview", "error");

      try {
        const res = await fetch(`/functions/${encodeURIComponent(fnId)}/notes/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw_html }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Preview failed");
        previewPane.innerHTML = data.merged || "";
        previewPane.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (err) {
        console.error(err);
        toast(`Preview error: ${err.message}`, "error");
      }
    });
  }

  // ---- Paste cleanup (optional) ----
  editorEl.addEventListener("paste", (e) => {
    // Paste as plain text to avoid messy Word markup; keep line breaks
    if (!e.clipboardData) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      insertHtmlAtCursor(text.replace(/\n/g, "<br>"));
    }
  });
})();

