// backend/public/js/functions/notes-delete.js
// Adds a Delete button to each .note-item and handles DELETE /functions/notes/:id

(function () {
  const qs  = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  function toast(msg, type = "info") {
    console[type === "error" ? "error" : "log"](`[Notes] ${msg}`);
  }

  function injectDeleteButton(noteEl) {
    if (!noteEl || qs(".note-btn-delete", noteEl)) return;

    // Button UI
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Delete";
    btn.className = "note-btn-delete";
    btn.style.cssText = `
      margin-top:.4rem; align-self:flex-end;
      background:#fff; border:1px solid #dc3545; color:#dc3545;
      border-radius:.35rem; padding:.25rem .5rem; font-size:.85rem; cursor:pointer;
    `;

    // Place it after the note HTML
    const htmlEl = qs(".note-html", noteEl) || noteEl;
    htmlEl.insertAdjacentElement("afterend", btn);

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const noteId = noteEl.getAttribute("data-note-id");
      if (!noteId) return toast("Missing note id", "error");

      if (!confirm("Delete this note? This cannot be undone.")) return;

      try {
        const res = await fetch(`/functions/notes/${encodeURIComponent(noteId)}`, {
          method: "DELETE",
          headers: { "Accept": "application/json" },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
          throw new Error(data.message || `Server error (${res.status})`);
        }

        // Remove note from DOM and update column badge counts
        const col = noteEl.closest(".notes-card");
        noteEl.remove();
        updateBadgeCounts(col?.parentElement || document);
        toast("Note deleted");
      } catch (err) {
        console.error(err);
        toast(`Delete error: ${err.message}`, "error");
      }
    });
  }

  function updateBadgeCounts(root) {
    qsa(".notes-card", root).forEach(card => {
      const count = qsa(".note-item", card).length;
      const badge = qs(".badge", card);
      if (badge) badge.textContent = String(count);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    qsa(".note-item").forEach(injectDeleteButton);
    updateBadgeCounts(document);
  });
})();
