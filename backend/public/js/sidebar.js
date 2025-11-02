/* =========================================================
   🧭 SIDEBAR CONTROLLER — UUID Safe, Stable Overlay/Burger
========================================================= */

console.log("🧭 Sidebar script loaded");

(function initSidebar() {
  const sidebar = document.querySelector(".function-sidebar");
  if (!sidebar) return console.warn("⚠️ Sidebar not found — skipping init");

  const overlay = document.getElementById("contactOverlay");
  const editPanel = document.getElementById("editContactPanel");

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
   ⋮ BURGER MENU — Stable toggle (no flicker, portal-safe)
========================================================= */
document.addEventListener("click", (e) => {
  const isMenuButton = e.target.classList.contains("menu-btn");
  const isMenuDropdown = e.target.closest(".menu-dropdown");

  // Ignore clicks inside an open menu
  if (isMenuDropdown) return;

  // Handle burger menu toggle
  if (isMenuButton) {
    e.stopPropagation();
    const id = e.target.dataset.id;
    const menu = document.getElementById(`menu-${id}`);
    if (!menu) return;

    // Close all other menus
    document.querySelectorAll(".menu-dropdown").forEach(m => m.classList.add("hidden"));

    // Toggle this one
    menu.classList.toggle("hidden");

    return;
  }

  // Click anywhere else closes all menus
  document.querySelectorAll(".menu-dropdown").forEach(m => m.classList.add("hidden"));
});

 /* =========================================================
   ✏️ EDIT CONTACT PANEL (MATCHING ADD PANEL BEHAVIOR)
========================================================= */
document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("edit-btn")) return;

  e.stopPropagation(); // prevent global click from closing menu

  const contactId = e.target.dataset.id;
  const fnId = window.fnContext?.id;
  const editPanel = document.getElementById("editContactPanel");
  const overlay = document.getElementById("contactOverlay");

  if (!contactId || !fnId) {
    console.warn("⚠️ Missing contactId or fnId for edit");
    return;
  }

  try {
    // Fetch the contact data (UUID-safe)
    const res = await fetch(`/api/contacts/${contactId}`);
    if (!res.ok) throw new Error("Failed to load contact details");
    const contact = await res.json();

    // Populate the form fields
    document.getElementById("editContactId").value = contact.id_uuid || contact.id || "";
    document.getElementById("editContactFnId").value = fnId;
    document.getElementById("editContactName").value = contact.name || "";
    document.getElementById("editContactEmail").value = contact.email || "";
    document.getElementById("editContactPhone").value = contact.phone || "";
    document.getElementById("editContactCompany").value = contact.company || "";

    // --- open panel (same as add contact pattern) ---
    editPanel.classList.remove("hidden");
    overlay.classList.remove("hidden");
    void editPanel.offsetWidth; // force reflow for transition
    editPanel.classList.add("panel-open");

  } catch (err) {
    console.error("❌ Error loading contact for edit:", err);
    alert("❌ Failed to load contact details");
  }
});
/* =========================================================
   💾 SAVE EDITED CONTACT (UUID SAFE)
========================================================= */
document.getElementById("editContactForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const contactId =
    document.getElementById("editContactId").value?.trim() ||
    document.getElementById("editContactId").dataset.id;
  const fnUUID = window.fnContext?.id;

  const body = {
    name: document.getElementById("editContactName").value.trim(),
    email: document.getElementById("editContactEmail").value.trim(),
    phone: document.getElementById("editContactPhone").value.trim(),
    company: document.getElementById("editContactCompany").value.trim(),
  };

  if (!contactId) {
    alert("❌ Missing contact ID — cannot save");
    return;
  }

  try {
    console.log("🛰️ Saving contact update:", { contactId, body });

    // Try the UUID route first (if your backend groups contacts under a function)
    const res = await fetch(`/api/contacts/${fnUUID}/contacts/${contactId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // If that 404s or fails, fall back to the simple route
    if (!res.ok) {
      console.warn("First route failed, trying flat /api/contacts/:id...");
      const res2 = await fetch(`/api/contacts/${contactId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res2.ok) throw new Error(`Update failed: ${res2.status}`);
      const data = await res2.json();
      if (data.success) {
        alert("✅ Contact updated successfully");
        setTimeout(() => location.reload(), 400);
        return;
      }
    }

    const data = await res.json();
    console.log("✅ Contact update response:", data);

    if (data.success) {
      alert("✅ Contact updated successfully");
      setTimeout(() => location.reload(), 400);
    } else {
      alert(data.message || "⚠️ Contact update failed on server");
    }
  } catch (err) {
    console.error("❌ Edit contact save error:", err);
    alert("❌ Failed to update contact — see console for details");
  }
});

/* =========================================================
   🔐 CLOSE EDIT PANEL (same pattern as add)
========================================================= */
const closeEditPanel = () => {
  const editPanel = document.getElementById("editContactPanel");
  const overlay = document.getElementById("contactOverlay");
  if (!editPanel) return;

  editPanel.classList.remove("panel-open");
  overlay.classList.remove("panel-open");
  setTimeout(() => {
    editPanel.classList.add("hidden");
    overlay.classList.add("hidden");
  }, 350); // match CSS transition
};

// ✖️ Button + Overlay close triggers
document.getElementById("closeEditPanel")?.addEventListener("click", closeEditPanel);
document.getElementById("cancelEdit")?.addEventListener("click", closeEditPanel);
document.getElementById("contactOverlay")?.addEventListener("click", (e) => {
  const editPanel = document.getElementById("editContactPanel");
  if (editPanel.classList.contains("panel-open")) closeEditPanel();
});

  /* =========================================================
     🕒 TIME MODAL
  ========================================================== */
  const modal = document.getElementById("timeModalContainer");
  const title = document.getElementById("timeModalTitle");
  const input = document.getElementById("timeInputField");
  const save = document.getElementById("saveTimeBtn");
  const cancel = document.getElementById("cancelTimeBtn");
  const closeBtn = document.getElementById("closeTimeModal");
  const fnId = window.fnContext?.id;
  let currentField = null;

  sidebar.querySelectorAll(".time-modal-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      currentField = e.currentTarget.dataset.field;
      title.textContent = currentField === "start_time" ? "Set Start Time" : "Set End Time";
      const currentValue = e.currentTarget.textContent.trim();
      input.value = currentValue.includes(":") ? currentValue.slice(0, 5) : "";
      modal.classList.remove("hidden");
      document.body.style.overflow = "hidden";
    })
  );

  const closeTimeModal = () => {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
    currentField = null;
  };

  [cancel, closeBtn].forEach((b) => b?.addEventListener("click", closeTimeModal));
  window.addEventListener("click", (e) => {
    if (e.target === modal) closeTimeModal();
  });

  save?.addEventListener("click", async () => {
    if (!fnId || !currentField) return showToast("⚠️ Invalid time field");
    const val = input.value;
    if (!val) return showToast("⚠️ Please select a time");
    try {
      const res = await fetch(`/functions/${fnId}/update-field`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: currentField, value: `${val}:00` }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("🕒 Time updated");
        closeTimeModal();
        setTimeout(() => location.reload(), 400);
      } else showToast("⚠️ Update failed");
    } catch (err) {
      console.error("❌ Time modal error:", err);
      showToast("❌ Error saving time");
    }
  });
})();
