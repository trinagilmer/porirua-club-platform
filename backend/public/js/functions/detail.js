/* =========================================================
   🧩 FUNCTION DETAIL CONTROLLER (CLEANED & UPDATED)
   Handles modals, edit panels, contacts, and notes.
   Sidebar menus & time modals are now in sidebar.js
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  console.log("🧠 Function Detail Controller initialized.");

  const fnId = window.fnContext?.id || document.body.dataset.fnId || null;
  const overlay = document.getElementById("contactOverlay");

  /* =========================================================
     🧭 Toast Notification (Shared Utility)
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
     👁️ VIEW CONTACT MODAL
  ========================================================== */
  const viewModal = document.getElementById("viewContactModal");
  const modalBody = document.getElementById("contactModalBody");
  const closeViewModal = document.getElementById("closeViewModal");

  const openModal = (html) => {
    modalBody.innerHTML = html;
    viewModal.classList.remove("hidden");
  };
  const closeModal = () => viewModal.classList.add("hidden");

  closeViewModal?.addEventListener("click", closeModal);
  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("contact-modal")) closeModal();
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
     ✏️ EDIT CONTACT PANEL
  ========================================================== */
  const editPanel = document.getElementById("editContactPanel");
  const editForm = document.getElementById("editContactForm");
  const closeEditPanelBtn = document.getElementById("closeEditPanel");
  const cancelEditBtn = document.getElementById("cancelEdit");

  // 🟢 Open edit panel
  document.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("edit-btn")) return;
    const id = e.target.dataset.id;

    try {
      const res = await fetch(`/functions/${fnId}/contacts/${id}`);
      if (!res.ok) throw new Error("Failed to fetch contact");
      const contact = await res.json();

      // Populate fields
      document.getElementById("editContactId").value = contact.id;
      document.getElementById("editContactName").value = contact.name || "";
      document.getElementById("editContactEmail").value = contact.email || "";
      document.getElementById("editContactPhone").value = contact.phone || "";
      document.getElementById("editContactCompany").value = contact.company || "";

      editPanel.classList.remove("hidden");
      editPanel.classList.add("panel-open");
      overlay?.classList.add("panel-open"); // ✅ fixed (was .active)
    } catch (err) {
      console.error("⚠️ Edit Panel Error:", err);
      showToast("⚠️ Could not load contact");
    }
  });

  // 🟡 Close edit panel
  const closeEdit = () => {
    editPanel.classList.remove("panel-open");
    overlay?.classList.remove("panel-open");
    setTimeout(() => editPanel.classList.add("hidden"), 350);
  };
  [closeEditPanelBtn, cancelEditBtn].forEach((btn) =>
    btn?.addEventListener("click", closeEdit)
  );

  // 💾 Save edits
  editForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("editContactId").value;
    const body = {
      name: document.getElementById("editContactName").value.trim(),
      email: document.getElementById("editContactEmail").value.trim(),
      phone: document.getElementById("editContactPhone").value.trim(),
      company: document.getElementById("editContactCompany").value.trim(),
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
        closeEdit();
        setTimeout(() => location.reload(), 400);
      } else showToast("⚠️ Update failed");
    } catch (err) {
      console.error("⚠️ Update Error:", err);
      showToast("⚠️ Update failed");
    }
  });

  /* =========================================================
     ➕ ADD / LINK CONTACT PANEL
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

  // 🟢 Open Add Panel
  openAddBtn?.addEventListener("click", () => {
    addPanel.classList.remove("hidden");
    addPanel.classList.add("panel-open");
    overlay.classList.add("panel-open"); // ✅ fixed
  });

  // 🔴 Close Add Panel
  closeAddPanel?.addEventListener("click", () => {
    addPanel.classList.remove("panel-open");
    overlay.classList.remove("panel-open");
    setTimeout(() => addPanel.classList.add("hidden"), 350);
  });

  // ⚫ Close by clicking overlay
  overlay?.addEventListener("click", () => {
    document.querySelectorAll(".contact-panel.panel-open").forEach(panel => {
      panel.classList.remove("panel-open");
      setTimeout(() => panel.classList.add("hidden"), 350);
    });
    overlay.classList.remove("panel-open");
  });

  // 🔹 Tabs
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

  // 🔍 Filter dropdown
  searchInput?.addEventListener("input", () => {
    const term = searchInput.value.toLowerCase();
    Array.from(selectDropdown.options).forEach((opt) => {
      opt.style.display = opt.textContent.toLowerCase().includes(term) ? "" : "none";
    });
  });

  // 🆕 Add new contact
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
      addPanel.classList.remove("panel-open");
      overlay.classList.remove("panel-open");
      setTimeout(() => addPanel.classList.add("hidden"), 350);
      location.reload();
    }
  });

  // 🔗 Link existing contact
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
      addPanel.classList.remove("panel-open");
      overlay.classList.remove("panel-open");
      setTimeout(() => addPanel.classList.add("hidden"), 350);
      location.reload();
    }
  });

  /* =========================================================
     ⌨️ ESCAPE KEY CLOSE (All Panels)
  ========================================================== */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".contact-panel.panel-open").forEach((panel) => {
        panel.classList.remove("panel-open");
        setTimeout(() => panel.classList.add("hidden"), 350);
      });
      overlay?.classList.remove("panel-open");
    }
  });
});
