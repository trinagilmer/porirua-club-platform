/* =========================================================
   🧭 SIDEBAR CONTROLLER
   Handles sidebar-specific UI: menus, toasts, and time modals
   Loaded only on pages with .function-sidebar
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.querySelector(".function-sidebar");
  if (!sidebar) return;

  console.log("🧩 Sidebar Controller loaded");

  /* =========================================================
     🔔 Toast Notification Utility
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
   ⋮ Three-dot Contact Menu
========================================================= */
document.addEventListener("click", (e) => {
  // Hide all open dropdowns
  document.querySelectorAll(".menu-dropdown").forEach((menu) =>
    menu.classList.add("hidden")
  );

  // Toggle specific menu if its button clicked
  if (e.target.classList.contains("menu-btn")) {
    e.stopPropagation();
    const menu = document.getElementById(`menu-${e.target.dataset.id}`);
    if (menu) menu.classList.toggle("hidden");
  }
});

// Prevent closing when clicking inside menu
document.addEventListener("click", (e) => {
  if (e.target.closest(".menu-dropdown")) e.stopPropagation();
});

 /* =========================================================
     🧩 CONTACT PANELS — Add / Edit Slide-in
  ========================================================== */
  const addPanel = document.getElementById("addContactPanel");
  const editPanel = document.getElementById("editContactPanel");
  const overlay = document.getElementById("contactOverlay");
  const openAddBtn = document.getElementById("openAddPanelBtn");

  // 🟢 Open "Add Contact" panel
  if (openAddBtn && addPanel && overlay) {
    openAddBtn.addEventListener("click", () => {
      addPanel.classList.remove("hidden");
      overlay.classList.remove("hidden");
      document.body.classList.add("no-scroll");
    });
  }

  // 🟡 Open "Edit Contact" panel
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("edit-btn")) {
      e.preventDefault();
      if (editPanel && overlay) {
        editPanel.classList.remove("hidden");
        overlay.classList.remove("hidden");
        document.body.classList.add("no-scroll");
      }
    }
  });

  // 🔴 Close panels when clicking close buttons or overlay
  document.addEventListener("click", (e) => {
    if (
      ["closeAddPanel", "closeEditPanel", "cancelEdit", "contactOverlay"].includes(e.target.id)
    ) {
      [addPanel, editPanel].forEach((panel) => panel.classList.add("hidden"));
      overlay.classList.add("hidden");
      document.body.classList.remove("no-scroll");
    }
  });


  /* =========================================================
     🕒 TIME MODAL — Start / End Time Controls
  ========================================================== */
  const timeModal = document.getElementById("timeModalContainer");
  const closeTimeModal = document.getElementById("closeTimeModal");
  const cancelTimeBtn = document.getElementById("cancelTimeBtn");
  const saveTimeBtn = document.getElementById("saveTimeBtn");
  const timeInputField = document.getElementById("timeInputField");
  const timeModalTitle = document.getElementById("timeModalTitle");

  const fnId = window.fnContext?.id || document.body.dataset.fnId || null;
  let currentTimeField = null;

  // Open modal when a sidebar time button is clicked
  sidebar.querySelectorAll(".time-modal-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      currentTimeField = e.currentTarget.dataset.field;
      timeModalTitle.textContent =
        currentTimeField === "start_time" ? "Set Start Time" : "Set End Time";

      const currentValue = e.currentTarget.textContent.trim();
      timeInputField.value =
        currentValue && currentValue !== "Set Time"
          ? currentValue.replace(/[^\d:]/g, "").slice(0, 5)
          : "";

      timeModal.classList.remove("hidden");
      document.body.style.overflow = "hidden";
    });
  });

  // Close modal
  [closeTimeModal, cancelTimeBtn].forEach((btn) =>
    btn?.addEventListener("click", closeTimeModalFn)
  );

  function closeTimeModalFn() {
    timeModal.classList.add("hidden");
    document.body.style.overflow = "";
    currentTimeField = null;
  }

  // Save time and update server
  saveTimeBtn?.addEventListener("click", async () => {
    if (!currentTimeField) return showToast("⚠️ No field selected");
    const newTime = timeInputField.value;
    if (!newTime) return showToast("⚠️ Please select a time");

    try {
      const formatted = newTime.length === 5 ? `${newTime}:00` : newTime;
      const res = await fetch(`/functions/${fnId}/update-field`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: currentTimeField, value: formatted }),
      });

      const data = await res.json();
      if (data.success) {
        showToast("🕒 Time updated");
        closeTimeModalFn();
        setTimeout(() => location.reload(), 400);
      } else {
        showToast("⚠️ Failed to update time");
      }
    } catch (err) {
      console.error("❌ Time update error:", err);
      showToast("❌ Error saving time");
    }
  });

  // Click outside closes modal
  window.addEventListener("click", (e) => {
    if (e.target === timeModal) closeTimeModalFn();
  });

});
