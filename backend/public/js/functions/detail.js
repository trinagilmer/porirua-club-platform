/* =========================================================
   🧠 FUNCTION DETAIL CONTROLLER — UUID Safe
   Handles Add/Link/View/Primary/Remove Contact
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  console.log("🧠 Function Detail Controller initialized");

  const fnUUID = window.fnContext?.id;
  const overlay = document.getElementById("contactOverlay");
  const addPanel = document.getElementById("addContactPanel");
  const openAddBtn = document.getElementById("openAddPanelBtn");
  const closeAddPanelBtn = document.getElementById("closeAddPanel");
  const tabNew = document.getElementById("tabNew");
  const tabExisting = document.getElementById("tabExisting");
  const newForm = document.getElementById("newContactForm");
  const existingSection = document.getElementById("existingContactSection");
  const searchInput = document.getElementById("searchContact");
  const selectDropdown = document.getElementById("existingSelect");
  const linkExistingBtn = document.getElementById("linkExisting");

  const showToast = (msg) => {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 2500);
  };

  /* =========================================================
     ➕ ADD CONTACT PANEL
  ========================================================== */
  const openPanel = () => {
    addPanel.classList.remove("hidden");
    overlay.classList.remove("hidden");
    addPanel.classList.add("panel-open");
  };
  const closePanel = () => {
    addPanel.classList.remove("panel-open");
    addPanel.classList.add("hidden");
    overlay.classList.add("hidden");
  };

  openAddBtn?.addEventListener("click", openPanel);
  closeAddPanelBtn?.addEventListener("click", closePanel);
  overlay?.addEventListener("click", () => {
    if (addPanel.classList.contains("panel-open")) closePanel();
  });

  /* =========================================================
     TABS + LOAD CONTACTS
  ========================================================== */
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
    try {
      const res = await fetch("/api/contacts");
      const data = await res.json();
      selectDropdown.innerHTML = "";
      if (!Array.isArray(data) || !data.length) {
        selectDropdown.innerHTML = `<option disabled>No contacts available</option>`;
        return;
      }
      data.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id_uuid || c.id;
        opt.textContent = `${c.name}${c.email ? " – " + c.email : ""}`;
        selectDropdown.appendChild(opt);
      });
    } catch (err) {
      console.error("❌ Load contacts error:", err);
      selectDropdown.innerHTML = `<option disabled>Error loading contacts</option>`;
    }
  }

  searchInput?.addEventListener("input", () => {
    const term = searchInput.value.toLowerCase();
    Array.from(selectDropdown.options).forEach((opt) => {
      opt.style.display = opt.textContent.toLowerCase().includes(term) ? "" : "none";
    });
  });

  /* =========================================================
     CREATE / LINK CONTACT
  ========================================================== */
  newForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      name: document.getElementById("newName").value.trim(),
      email: document.getElementById("newEmail").value.trim(),
      phone: document.getElementById("newPhone").value.trim(),
      company: document.getElementById("newCompany").value.trim(),
    };
    if (!body.name) return showToast("⚠️ Name required");

    try {
      const createRes = await fetch(`/api/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success || !createData.id) {
        throw new Error(createData.message || "Failed to create contact");
      }

      const linkRes = await fetch(`/api/contacts/link/${fnUUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: createData.id }),
      });
      const linkData = await linkRes.json();
      if (linkData.success) {
        showToast("✅ Contact added & linked");
        closePanel();
        setTimeout(() => location.reload(), 400);
      } else {
        throw new Error(linkData.message || "Failed to link contact");
      }
    } catch (err) {
      console.error("⚠️ Create contact error:", err);
      showToast("⚠️ Error creating contact");
    }
  });

  linkExistingBtn?.addEventListener("click", async () => {
    const contactId = selectDropdown.value;
    if (!contactId) return showToast("⚠️ Select a contact first");
    try {
      const res = await fetch(`/api/contacts/link/${fnUUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("🔗 Contact linked");
        closePanel();
        setTimeout(() => location.reload(), 400);
      } else showToast(data.message || "❌ Failed to link contact");
    } catch (err) {
      console.error("❌ Link contact error:", err);
      showToast("❌ Error linking contact");
    }
  });

  /* =========================================================
     REMOVE / MAKE PRIMARY
  ========================================================== */
  document.addEventListener("click", async (e) => {
    const contactId = e.target.dataset.id;
    if (e.target.classList.contains("remove-btn")) {
      if (!confirm("Remove this contact?")) return;
      try {
        const res = await fetch(`/api/contacts/${fnUUID}/remove-contact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_id: contactId }),
        });
        const data = await res.json();
        if (data.success) {
          showToast("🗑️ Contact removed");
          setTimeout(() => location.reload(), 400);
        } else showToast("❌ Remove failed");
      } catch (err) {
        console.error("❌ Remove error:", err);
        showToast("❌ Server error");
      }
    }

    if (e.target.classList.contains("primary-btn")) {
      try {
        const res = await fetch(`/api/contacts/${fnUUID}/set-primary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_id: contactId }),
        });
        const data = await res.json();
        if (data.success) {
          showToast("⭐ Primary contact updated");
          setTimeout(() => location.reload(), 400);
        } else showToast("⚠️ Update failed");
      } catch (err) {
        console.error("❌ Primary error:", err);
        showToast("❌ Server error");
      }
    }
  });
});


