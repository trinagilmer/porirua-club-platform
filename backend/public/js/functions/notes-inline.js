// backend/public/js/functions/notes-inline.js
// Inline edit / status move / delete for .note-item elements on the notes page.

(function () {
  const qs  = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  function toast(msg, type = "info") {
    // Replace with your own toast UI if desired
    console[type === "error" ? "error" : "log"](`[Notes] ${msg}`);
  }

  function htmlToClean(html) {
    // Optional: light cleanup — keep as-is for now
    return String(html || "").trim();
  }

  function buildControls(noteEl, currentStatus) {
    // Controls container
    const bar = document.createElement("div");
    bar.className = "note-ctrls";
    bar.style.display = "flex";
    bar.style.gap = ".4rem";
    bar.style.marginTop = ".4rem";
    bar.style.alignItems = "center";

    // Status select
    const select = document.createElement("select");
    select.className = "note-status-select";
    ["proposal", "general", "internal"].forEach(s => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s[0].toUpperCase() + s.slice(1);
      if ((currentStatus || "general").toLowerCase() === s) opt.selected = true;
      select.appendChild(opt);
    });

    // Edit / Save / Cancel / Delete
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.className = "note-btn-edit";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    saveBtn.className = "note-btn-save";
    saveBtn.style.display = "none";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "note-btn-cancel";
    cancelBtn.style.display = "none";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "Delete";
    delBtn.className = "note-btn-delete";

    // Append all
    bar.appendChild(select);
    bar.appendChild(editBtn);
    bar.appendChild(saveBtn);
    bar.appendChild(cancelBtn);
    bar.appendChild(delBtn);

    // Wire up behaviour
    const htmlEl = qs(".note-html", noteEl);
    let originalHTML = "";

    function enterEdit() {
      originalHTML = htmlEl.innerHTML;
      htmlEl.contentEditable = "true";
      htmlEl.style.outline = "2px solid #c7d2fe";
      htmlEl.focus();
      editBtn.style.display = "none";
      saveBtn.style.display = "";
      cancelBtn.style.display = "";
    }

    async function saveEdit() {
      const noteId = noteEl.getAttribute("data-note-id");
      if (!noteId) return toast("Missing note id", "error");

      const rendered_html = htmlToClean(htmlEl.innerHTML);
      const note_type = select.value || "general";

      try {
        const res = await fetch(`/functions/notes/${encodeURIComponent(noteId)}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rendered_html, note_type }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Update failed");
        exitEdit(true);
        toast("Note updated");

        // If status changed, move the card to the new column
        moveNoteToStatusColumn(noteEl, note_type);
      } catch (err) {
        console.error(err);
        toast(`Save error: ${err.message}`, "error");
      }
    }

    function exitEdit(saved) {
      htmlEl.contentEditable = "false";
      htmlEl.style.outline = "none";
      if (!saved) htmlEl.innerHTML = originalHTML;
      editBtn.style.display = "";
      saveBtn.style.display = "none";
      cancelBtn.style.display = "none";
    }

    async function deleteNote() {
      const noteId = noteEl.getAttribute("data-note-id");
      if (!noteId) return toast("Missing note id", "error");
      if (!confirm("Delete this note? This cannot be undone.")) return;

      try {
        const res = await fetch(`/functions/notes/${encodeURIComponent(noteId)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Delete failed");
        // Remove node and update badge counters
        const card = noteEl.closest(".notes-card");
        noteEl.remove();
        toast("Note deleted");
        updateBadgeCounts(card?.parentElement || document);
      } catch (err) {
        console.error(err);
        toast(`Delete error: ${err.message}`, "error");
      }
    }

    // Attach handlers
    editBtn.addEventListener("click", enterEdit);
    saveBtn.addEventListener("click", saveEdit);
    cancelBtn.addEventListener("click", () => exitEdit(false));
    delBtn.addEventListener("click", deleteNote);

    // Status change: if user changes select while NOT editing, immediately update status
    select.addEventListener("change", async () => {
      // If currently editing, defer to Save button to persist HTML + status together
      if (saveBtn.style.display !== "none") return;
      const noteId = noteEl.getAttribute("data-note-id");
      if (!noteId) return toast("Missing note id", "error");
      try {
        const res = await fetch(`/functions/notes/${encodeURIComponent(noteId)}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note_type: select.value }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Update failed");
        moveNoteToStatusColumn(noteEl, select.value);
        toast("Status updated");
      } catch (err) {
        console.error(err);
        toast(`Status change error: ${err.message}`, "error");
      }
    });

    return bar;
  }

  function moveNoteToStatusColumn(noteEl, status) {
    const columns = qsa(".notes-card");
    const map = {};
    columns.forEach((col) => {
      const headerText = (qs("header span", col)?.textContent || "").trim().toLowerCase();
      if (headerText.includes("proposal")) map.proposal = col;
      else if (headerText.includes("general")) map.general = col;
      else if (headerText.includes("internal")) map.internal = col;
    });

    const targetCol = map[(status || "general").toLowerCase()] || map.general;
    const list = qs(".notes-list", targetCol);
    if (list && noteEl) {
      list.prepend(noteEl); // move visually
      updateBadgeCounts(document); // refresh counts
    }
  }

  function updateBadgeCounts(root) {
    qsa(".notes-card", root).forEach(card => {
      const count = qsa(".note-item", card).length;
      const badge = qs(".badge", card);
      if (badge) badge.textContent = String(count);
    });
  }

  // Enhance all .note-item blocks on load
  document.addEventListener("DOMContentLoaded", () => {
    qsa(".note-item").forEach(noteEl => {
      if (qs(".note-ctrls", noteEl)) return; // already enhanced
      const statusFromCol = (() => {
        const colHeader = (noteEl.closest(".notes-card")?.querySelector("header span")?.textContent || "").toLowerCase();
        if (colHeader.includes("proposal")) return "proposal";
        if (colHeader.includes("internal")) return "internal";
        return "general";
      })();
      const ctrl = buildControls(noteEl, statusFromCol);
      noteEl.appendChild(ctrl);
    });

    // ensure badges match initial DOM
    updateBadgeCounts(document);
  });
})();
