document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("quickNoteForm");
  const input = document.getElementById("quickNoteInput");
  const typeSelect = document.getElementById("noteType");
  const notesList = document.getElementById("notesList");
  const fnId = window.location.pathname.split("/")[2]; // /functions/:id/notes

  /* -----------------------------
     🆕 CREATE NEW NOTE
  ----------------------------- */
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    const note_type = typeSelect.value;
    if (!content) return alert("Please enter note content.");

    const res = await fetch(`/functions/${fnId}/notes/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, note_type }),
    });

    const data = await res.json();
    if (data.success) {
      input.value = "";
      await loadNotes();
    } else {
      alert("Failed to create note");
    }
  });

  /* -----------------------------
     ✏️ EDIT / SAVE / DELETE NOTE
  ----------------------------- */
  notesList?.addEventListener("click", async (e) => {
    const card = e.target.closest(".note-card");
    if (!card) return;
    const noteId = card.dataset.id;
    const bodyDiv = card.querySelector(".note-body");
    const editBtn = card.querySelector(".edit-note");
    const saveBtn = card.querySelector(".save-note");

    // 🖊️ Edit
    if (e.target.classList.contains("edit-note")) {
      bodyDiv.contentEditable = "true";
      bodyDiv.focus();
      bodyDiv.classList.add("editing");
      editBtn.classList.add("d-none");
      saveBtn.classList.remove("d-none");

      // add dropdown for type
      if (!card.querySelector(".note-type-edit")) {
        const typeSpan = card.querySelector(".note-type-badge");
        const typeEdit = document.createElement("select");
        typeEdit.className = "note-type-edit form-select form-select-sm mt-1";
        ["general", "followup", "internal", "client"].forEach((t) => {
          const opt = document.createElement("option");
          opt.value = t;
          opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
          if (typeSpan.classList.contains(`note-type-${t}`)) opt.selected = true;
          typeEdit.appendChild(opt);
        });
        typeSpan.after(typeEdit);
      }
    }

    // 💾 Save
    if (e.target.classList.contains("save-note")) {
      const newContent = bodyDiv.innerText.trim();
      const typeEdit = card.querySelector(".note-type-edit");
      const newType = typeEdit ? typeEdit.value : "general";

      const res = await fetch(`/functions/notes/${noteId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent, note_type: newType }),
      });

      const data = await res.json();
      if (data.success) {
        bodyDiv.contentEditable = "false";
        bodyDiv.classList.remove("editing");
        editBtn.classList.remove("d-none");
        saveBtn.classList.add("d-none");

        // update badge
        const badge = card.querySelector(".note-type-badge");
        badge.className = `badge me-2 note-type-badge note-type-${newType}`;
        badge.textContent =
          newType.charAt(0).toUpperCase() + newType.slice(1);

        if (typeEdit) typeEdit.remove();

        // flash green
        card.classList.add("saved-flash");
        setTimeout(() => card.classList.remove("saved-flash"), 800);
      } else {
        alert("Failed to save note");
      }
    }

    // 🗑️ Delete
    if (e.target.classList.contains("delete-note")) {
      if (!confirm("Delete this note?")) return;
      const res = await fetch(`/functions/notes/${noteId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) card.remove();
    }

    // 🖨️ Print
    if (e.target.classList.contains("print-note")) {
      const printWindow = window.open("", "_blank");
      printWindow.document.write(`
        <html><head><title>Print Note</title></head>
        <body>
          <h3>Note</h3>
          <p>${bodyDiv.innerText}</p>
          <p><small>Printed ${new Date().toLocaleString()}</small></p>
        </body></html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  });

  /* -----------------------------
     🔄 Load notes list (AJAX)
  ----------------------------- */
  async function loadNotes() {
    const res = await fetch(`/functions/${fnId}/notes.json`);
    const data = await res.json();
    if (!data.success) return;
    const html = data.notes
      .map(
        (n) => `
        <div class="note-card" data-id="${n.entry_id}">
          <div class="note-meta">
            <span class="badge me-2 note-type-badge note-type-${n.note_type || "general"}">
              ${(n.note_type || "General").charAt(0).toUpperCase() + (n.note_type || "General").slice(1)}
            </span>
            <strong>${n.author || "Unknown"}</strong> •
            ${new Date(n.entry_date).toLocaleString("en-NZ")}
          </div>
          <div class="note-body" contenteditable="false">${n.body || ""}</div>
          <div class="note-actions">
            <button class="btn small edit-note btn-outline-secondary">Edit</button>
            <button class="btn small save-note btn-success d-none">Save</button>
            <button class="btn small delete-note btn-outline-danger">Delete</button>
            <button class="btn small print-note btn-outline-secondary">🖨️ Print</button>
          </div>
        </div>`
      )
      .join("");
    notesList.innerHTML = html || "<p class='text-muted'>No notes yet.</p>";
  }
});

