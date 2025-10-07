document.addEventListener("DOMContentLoaded", () => {
  const fnId = window.fnContext?.id;

  /* ==========================================================
     🔹 Toast helper
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

  /* ==========================================================
     🔹 3-dot Menu
  ========================================================== */
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".menu-dropdown").forEach((d) => d.classList.add("hidden"));
    if (e.target.classList.contains("menu-btn")) {
      e.stopPropagation();
      const menu = document.getElementById(`menu-${e.target.dataset.id}`);
      if (menu) menu.classList.toggle("hidden");
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".menu-dropdown")) e.stopPropagation();
  });

  /* ==========================================================
     🔹 View Contact Modal
  ========================================================== */
  const viewModal = document.getElementById("viewContactModal");
  const modalBody = document.getElementById("contactModalBody");
  const closeViewModal = document.getElementById("closeViewModal");

  const openModal = (html) => {
    modalBody.innerHTML = html;
    viewModal.classList.remove("hidden");
  };
  const closeModal = () => viewModal.classList.add("hidden");
  closeViewModal.addEventListener("click", closeModal);
  window.addEventListener("click", (e) => {
    if (e.target === viewModal) closeModal();
  });

  document.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("view-btn")) return;
    const id = e.target.dataset.id;
    try {
      const contact = await fetch(`/functions/contacts/${id}`).then((r) => r.json());
      const comms = await fetch(`/functions/contacts/${id}/communications`).then((r) => r.json());

      let commsHTML = "<h4>Recent Communications</h4>";
      if (Array.isArray(comms) && comms.length > 0) {
        commsHTML +=
          "<ul>" +
          comms
            .map((c) => `<li>${c.entry_type}: ${c.subject || c.body}</li>`)
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
    } catch {
      openModal("<p>Failed to load contact details.</p>");
    }
  });

  /* ==========================================================
     🔹 Edit Contact Panel
  ========================================================== */
  const editPanel = document.getElementById("editContactPanel");
  const editForm = document.getElementById("editContactForm");
  document.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("edit-btn")) return;
    const id = e.target.dataset.id;
    const contact = await fetch(`/functions/contacts/${id}`).then((r) => r.json());
    document.getElementById("editContactId").value = contact.id;
    document.getElementById("editContactName").value = contact.name;
    document.getElementById("editContactEmail").value = contact.email;
    document.getElementById("editContactPhone").value = contact.phone;
    document.getElementById("editContactCompany").value = contact.company;
    editPanel.classList.add("show");
  });
  document.getElementById("closeEditPanel").addEventListener("click", () => editPanel.classList.remove("show"));
  document.getElementById("cancelEdit").addEventListener("click", () => editPanel.classList.remove("show"));
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("editContactId").value;
    const body = {
      name: document.getElementById("editContactName").value,
      email: document.getElementById("editContactEmail").value,
      phone: document.getElementById("editContactPhone").value,
      company: document.getElementById("editContactCompany").value,
    };
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
  });

  /* ==========================================================
     🔹 Remove / Delete / Primary Contact
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

  /* ==========================================================
     🔹 Add / Link Contact Panel
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

  if (openAddBtn) openAddBtn.addEventListener("click", () => addPanel.classList.add("show"));
  if (closeAddPanel) closeAddPanel.addEventListener("click", () => addPanel.classList.remove("show"));

  tabNew.addEventListener("click", () => {
    tabNew.classList.add("active");
    tabExisting.classList.remove("active");
    newForm.classList.remove("hidden");
    existingSection.classList.add("hidden");
  });

  tabExisting.addEventListener("click", async () => {
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

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.toLowerCase();
      Array.from(selectDropdown.options).forEach((opt) => {
        opt.style.display = opt.textContent.toLowerCase().includes(term) ? "" : "none";
      });
    });
  }

  newForm.addEventListener("submit", async (e) => {
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

  if (linkExistingBtn) {
    linkExistingBtn.addEventListener("click", async () => {
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
  }
});

