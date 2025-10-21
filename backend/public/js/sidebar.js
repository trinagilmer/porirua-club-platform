/* =========================================================
   🧭 SIDEBAR CONTROLLER — Universal Init (post-load safe)
========================================================= */

console.log("🧭 Sidebar script loaded");

// add leading semicolon to protect against concatenation/ASI issues
;(function initSidebar() {
  // Safe start: run whether DOM already loaded or not
  const start = () => {
    const sidebar = document.querySelector(".function-sidebar");
    if (!sidebar) {
      console.warn("⚠️ Sidebar not found — skipping init");
      return;
    }

    console.log("✅ Sidebar found — initializing sidebar controller...");
    initializeSidebar(sidebar);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  /* =========================================================
     MAIN INITIALIZER
  ========================================================== */
  function initializeSidebar(sidebar) {
    console.log("🧩 Sidebar Controller loaded ✅");

    // Shared elements
    const overlay = document.getElementById("contactOverlay");
    const addPanel = document.getElementById("addContactPanel");
    const editPanel = document.getElementById("editContactPanel");
    const addBtn = document.getElementById("openAddPanelBtn");

    /* =========================================================
       🔔 Toast Utility
    ========================================================== */
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

    /* Duplicate simple menu handler removed in favor of the portal-safe handler below */

// =========================================================
// ⋮ CONTACT MENU (Fixed Toggle + Portal-safe)
// =========================================================
document.addEventListener("click", (e) => {
  const isMenuBtn = e.target.classList.contains("menu-btn");
  const isDropdown = e.target.closest(".menu-dropdown");

  // Click outside → close all menus
  if (!isMenuBtn && !isDropdown) {
    document.querySelectorAll(".menu-dropdown").forEach((m) => m.classList.add("hidden"));
    return;
  }

  // Toggle active dropdown
  if (isMenuBtn) {
    e.stopPropagation();
    const id = e.target.dataset.id;
    const menu = document.getElementById(`menu-${id}`);
    if (!menu) return;

    // Re-parent menu to body (portalize)
    if (!menu.dataset.portalized) {
      document.body.appendChild(menu);
      menu.dataset.portalized = "true";
      menu.style.position = "fixed";
    }

    // Close other menus
    document.querySelectorAll(".menu-dropdown").forEach((m) => {
      if (m !== menu) m.classList.add("hidden");
    });

    // Toggle visibility
    menu.classList.toggle("hidden");

    // Recalculate position relative to the burger button
    if (!menu.classList.contains("hidden")) {
      const rect = e.target.getBoundingClientRect();
      const menuWidth = menu.offsetWidth || 180;
      const top = rect.bottom + 6; // a little gap below the button
      const left = rect.right - menuWidth;
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.zIndex = "99999";
    }
  }
});


    /* =========================================================
       🧩 CONTACT PANELS — Add/Edit
    ========================================================== */
    const openPanel = (panel) => {
      panel.classList.remove("hidden");
      overlay.classList.remove("hidden");
      document.body.classList.add("no-scroll");
    };

    const closePanels = () => {
      [addPanel, editPanel].forEach((p) => p?.classList.add("hidden"));
      overlay.classList.add("hidden");
      document.body.classList.remove("no-scroll");
    };

    addBtn?.addEventListener("click", () => openPanel(addPanel));
    overlay?.addEventListener("click", closePanels);

    document.addEventListener("click", (e) => {
      if (["closeAddPanel", "closeEditPanel", "cancelEdit"].includes(e.target.id)) {
        closePanels();
      }
    });

    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("edit-btn")) {
        e.preventDefault();
        openPanel(editPanel);
      }
    });
// =========================================================
// 👤 CONTACT ACTIONS — Make Primary / Remove
// =========================================================
document.addEventListener("click", async (e) => {
  const fnId = window.fnContext?.id || document.body.dataset.fnId;

  // 🟢 Make Primary
  if (e.target.classList.contains("primary-btn")) {
    e.preventDefault();
    const contactId = e.target.dataset.id;
    try {
      const res = await fetch(`/functions/${fnId}/set-primary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("✅ Primary contact updated");
        setTimeout(() => location.reload(), 400);
      } else {
        showToast("⚠️ Failed to update primary");
      }
    } catch (err) {
      console.error("❌ Primary contact error:", err);
      showToast("❌ Error updating primary");
    }
  }

  // 🔴 Remove Contact
  if (e.target.classList.contains("remove-btn")) {
    e.preventDefault();
    const contactId = e.target.dataset.id;
    if (!confirm("Are you sure you want to remove this contact?")) return;

    try {
      const res = await fetch(`/functions/${fnId}/remove-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("🗑️ Contact removed");
        setTimeout(() => location.reload(), 400);
      } else {
        showToast("⚠️ Failed to remove contact");
      }
    } catch (err) {
      console.error("❌ Remove contact error:", err);
      showToast("❌ Error removing contact");
    }
  }
});

    /* =========================================================
       🕒 TIME MODAL CONTROLS
    ========================================================== */
    const modal = document.getElementById("timeModalContainer");
    const title = document.getElementById("timeModalTitle");
    const input = document.getElementById("timeInputField");
    const save = document.getElementById("saveTimeBtn");
    const cancel = document.getElementById("cancelTimeBtn");
    const closeBtn = document.getElementById("closeTimeModal");
    const fnId = window.fnContext?.id || document.body.dataset.fnId;
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

    window.addEventListener("click", (e) => {
      if (e.target === modal) closeTimeModal();
    });
  } // end initializeSidebar

})(); // end self-invoking function