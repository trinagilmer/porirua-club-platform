/* =========================================================
   🔹 FUNCTION DETAIL CONTROLLER
   Handles contacts, modals, edit panel, and dropdown menus
========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  console.log("🧠 UI Controller initialized.");

  const fnId = window.fnContext?.id;

  /* =========================================================
     🧭 Toast Notification
  ========================================================== */
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /* =========================================================
     ⋮ Three-dot Menu
  ========================================================== */
  document.addEventListener("click", (e) => {
    // Close all dropdowns first
    document.querySelectorAll(".menu-dropdown").forEach((d) => d.classList.add("hidden"));

    // Toggle if menu button clicked
    if (e.target.classList.contains("menu-btn")) {
      e.stopPropagation();
      const menu = document.getElementById(`menu-${e.target.dataset.id}`);
      if (menu) menu.classList.toggle("hidden");
    }
  });

  // Keep menu open when clicking inside dropdown
  document.addEventListener("click", (e) => {
    if (e.target.closest(".menu-dropdown")) e.stopPropagation();
  });

  /* =========================================================
     👁️ View Contact Modal
  ========================================================== */
  const viewModal = document.getElementById("viewContactModal");
  const modalBody = document.getElementById("contactModalBody");
  const closeViewModal = document.getElementById("closeViewModal");

  const openModal = (html) => {
    modalBody.innerHTML = html;
    viewModal.classList.add("show");
  };
  const closeModal = () => viewModal.classList.remove("show");

  closeViewModal?.addEventListener("click", closeModal);
  window.addEventListener("click", (e) => {
    if (e.target === viewModal) closeModal();
  });

  document.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("view-btn")) return;
    const id = e.target.dataset.id;

    try {
      const contactRes = await fetch(`/functions/${fnId}/contacts/${id}`);
      if (!contactRes.ok) throw new Error("Failed to load contact");
      const contact = await contactRes.json();

      const commsRes = await fetch(`/functions/${fnId}/contacts/${id}/communications`);
      const comms = commsRes.ok ? await commsRes.json() : [];

      let commsHTML = "<h4>Recent Communications</h4>";
      if (Array.isArray(comms) && comms.length > 0) {
        commsHTML +=
          "<ul>" +
          comms
            .map((c) => {
              const text = c.subject || c.body || "[No content]";
              return `<li><strong>${c.entry_type}:</strong> ${text}</li>`;
            })
            .join("") +
          "</ul>";
      } else {
        commsHTML += "<p>No communications yet.</p>";
      }

      openModal(`
        <h2>${contact.name}</h2>
        <p><strong>Email:</strong> ${contact.email || "—"}</p>
        <p><strong>Phone:</strong> ${contact.phone || "—"}</p>
        <p><strong>Company:</strong> ${contact.company || "—"}</p>
        <hr>${commsHTML}
      `);
    } catch (err) {
      console.error("❌ View contact error:", err);
      openModal("<p>Failed to load contact details.</p>");
    }
  });

  /* =========================================================
     ✏️ Edit Contact Panel
  ========================================================== */
  const editPanel = document.getElementById("editContactPanel");
  const editForm = document.getElementById("editContactForm");

  document.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("edit-btn")) return;
    const id = e.target.dataset.id;

    try {
      const res = await fetch(`/functions/${fnId}/contacts/${id}`);
      if (!res.ok) throw new Error("Failed to fetch contact");
      const contact = await res.json();

      document.getElementById("editContactId").value = contact.id;
      document.getElementById("editContactName").value = contact.name;
      document.getElementById("editContactEmail").value = contact.email;
      document.getElementById("editContactPhone").value = contact.phone;
      document.getElementById("editContactCompany").value = contact.company;
      editPanel.classList.add("show");
    } catch (err) {
      console.error(err);
      showToast("⚠️ Could not load contact");
    }
  });

  document.getElementById("closeEditPanel")?.addEventListener("click", () =>
    editPanel.classList.remove("show")
  );
  document.getElementById("cancelEdit")?.addEventListener("click", () =>
    editPanel.classList.remove("show")
  );

  editForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("editContactId").value;
    const body = {
      name: document.getElementById("editContactName").value,
      email: document.getElementById("editContactEmail").value,
      phone: document.getElementById("editContactPhone").value,
      company: document.getElementById("editContactCompany").value,
    };
    try {
      const res = await fetch(`/functions/contacts/${id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        showToast("✅ Contact updated");
        editPanel.classList.remove("show");
        location.reload();
      }
    } catch {
      showToast("⚠️ Update failed");
    }
  });

  /* =========================================================
     ❌ Remove / Delete / Primary Contact
  ========================================================== */
  document.addEventListener("click", async (e) => {
    const id = e.target.dataset.id;

    if (e.target.classList.contains("remove-btn")) {
      if (!confirm("Remove this contact?")) return;
      await fetch(`/functions/${fnId}/remove-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: id }),
      });
      showToast("Contact removed");
      location.reload();
    }

    if (e.target.classList.contains("delete-btn")) {
      if (!confirm("Delete this contact permanently?")) return;
      await fetch(`/functions/contacts/${id}/delete`, { method: "DELETE" });
      showToast("Contact deleted");
      location.reload();
    }

    if (e.target.classList.contains("primary-btn")) {
      await fetch(`/functions/${fnId}/set-primary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: id }),
      });
      showToast("⭐ Primary contact set");
      location.reload();
    }
  });

  /* =========================================================
     ➕ Add / Link Contact Panel
  ========================================================== */
  const addPanel = document.getElementById("addContactPanel");
  const openAddBtn = document.getElementById("openAddPanelBtn");
  const closeAddPanel = document.getElementById("closeAddPanel");
  const tabNew = document.getElementById("tabNew");
  const tabExisting = document.getElementById("tabExisting");
  const newForm = document.getElementById("newContactForm");
  const existingSection = document.getElementById("existingContactSection");
  const searchInput = document.getElementById("searchContact");
  const selectDropdown = document.getElementById("existingSelect");
  const linkExistingBtn = document.getElementById("linkExisting");

  openAddBtn?.addEventListener("click", () => addPanel.classList.add("show"));
  closeAddPanel?.addEventListener("click", () => addPanel.classList.remove("show"));

  tabNew?.addEventListener("click", () => {
    tabNew.classList.add("active");
    tabExisting.classList.remove("active");
    newForm.classList.remove("hidden");
    existingSection.classList.add("hidden");
  });

  tabExisting?.addEventListener("click", async () => {
    tabExisting.classList.add("active");
    tabNew.classList.remove("active");
    newForm.classList.add("hidden");
    existingSection.classList.remove("hidden");
    await loadContacts();
  });

  async function loadContacts() {
    const res = await fetch("/functions/api/contacts");
    const contacts = await res.json();
    selectDropdown.innerHTML = contacts
      .map((c) => `<option value="${c.id}">${c.name} (${c.email || "no email"})</option>`)
      .join("");
  }

  searchInput?.addEventListener("input", () => {
    const term = searchInput.value.toLowerCase();
    Array.from(selectDropdown.options).forEach((opt) => {
      opt.style.display = opt.textContent.toLowerCase().includes(term) ? "" : "none";
    });
  });

  newForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      name: document.getElementById("newName").value,
      email: document.getElementById("newEmail").value,
      phone: document.getElementById("newPhone").value,
      company: document.getElementById("newCompany").value,
    };
    const res = await fetch(`/functions/${fnId}/new-contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      showToast("✅ Contact added");
      addPanel.classList.remove("show");
      location.reload();
    }
  });

  linkExistingBtn?.addEventListener("click", async () => {
    const contactId = selectDropdown.value;
    if (!contactId) return alert("Please select a contact.");
    const res = await fetch(`/functions/${fnId}/link-contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contactId }),
    });
    const data = await res.json();
    if (data.success) {
      showToast("🔗 Contact linked");
      addPanel.classList.remove("show");
      location.reload();
    }
  });
  /* =========================================================
   🗒️ Quick Add Note (inline form with auto-resize)
========================================================= */
const quickForm = document.getElementById("quickNoteForm");
const quickInput = document.getElementById("quickNoteInput");

if (quickForm && quickInput) {
  // Auto-resize as user types
  quickInput.addEventListener("input", () => {
    quickInput.style.height = "auto";
    quickInput.style.height = quickInput.scrollHeight + "px";
  });

  quickForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = quickInput.value.trim();
    if (!content) return alert("Please write a note first.");

    const res = await fetch(`/functions/${fnId}/notes/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    const data = await res.json();
    if (data.success) {
      showToast("📝 Note added");
      location.reload();
    } else {
      showToast("⚠️ Failed to add note");
    }
  });
}

/* =========================================================
   🗒️ Edit & Delete Notes (inline on detail page)
========================================================= */
document.querySelectorAll(".edit-note").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    const body = li.querySelector(".note-snippet");
    const saveBtn = li.querySelector(".save-note");

    body.contentEditable = true;
    body.focus();
    btn.classList.add("hidden");
    saveBtn.classList.remove("hidden");
  });
});

document.querySelectorAll(".save-note").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    const id = li.dataset.noteId;
    const body = li.querySelector(".note-snippet").innerText;

    const res = await fetch(`/functions/notes/${id}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body }),
    });

    const data = await res.json();
    if (data.success) {
      showToast("✅ Note updated");
      location.reload();
    } else {
      showToast("⚠️ Failed to update note");
    }
  });
});
/* =========================================================
   🧩 Show More / Show Less Notes
========================================================= */
const toggleBtn = document.getElementById("toggleNotesBtn");
if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    const extraNotes = document.querySelectorAll(".extra-note");
    const isHidden = extraNotes[0].classList.contains("hidden");
    extraNotes.forEach((n) => n.classList.toggle("hidden", !isHidden));
    toggleBtn.textContent = isHidden ? "Show less" : "Show more";
  });
}

document.querySelectorAll(".delete-note").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const li = e.target.closest("li");
    const id = li.dataset.noteId;
    if (!confirm("Delete this note?")) return;

    const res = await fetch(`/functions/notes/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      showToast("🗑️ Note deleted");
      li.remove();
    } else {
      showToast("⚠️ Failed to delete note");
    }
  });
});

});
