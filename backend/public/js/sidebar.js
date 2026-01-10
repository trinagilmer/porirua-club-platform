/* =========================================================
   ?? SIDEBAR CONTROLLER - UUID Safe, Stable Overlay/Burger
========================================================= */

console.log("?? Sidebar script loaded");

(function initSidebar() {
  const sidebar = document.querySelector(".function-sidebar");
  const fnId = window.fnContext?.id || null;

  if (!sidebar) {
    console.warn("?? Sidebar not found - skipping init");
    return;
  }

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

  const commitFieldUpdate = async (el, rawValue) => {
    if (!fnId) return;
    const field = el.dataset.field;
    if (!field) return;

    const normalized = rawValue == null ? "" : String(rawValue).trim();
    const previous = el.dataset.lastValue ?? "";
    if (normalized === previous) return;

    el.dataset.lastValue = normalized;

    try {
      const res = await fetch(`/functions/${fnId}/update-field`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: normalized }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Update failed");
      showToast("? Saved");
    } catch (err) {
      console.error("? Sidebar update error:", err);
      showToast("? Failed to save");
    }
  };

  const bindEditableFields = () => {
    sidebar.querySelectorAll(".editable").forEach((el) => {
      if (!el.dataset.field) return;

      if (el.hasAttribute("contenteditable")) {
        el.dataset.lastValue = el.textContent.trim();
        el.addEventListener("blur", () => commitFieldUpdate(el, el.textContent));
        return;
      }

      if (el.tagName === "SELECT") {
        el.dataset.lastValue = el.value;
        el.addEventListener("change", () => commitFieldUpdate(el, el.value));
        return;
      }

      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.dataset.lastValue = el.value;
        el.addEventListener("blur", () => commitFieldUpdate(el, el.value));
      }
    });
  };

  bindEditableFields();

  const closeSidebar = () => {
    sidebar.classList.remove("is-open");
    document.getElementById("sidebarOverlay")?.classList.remove("active");
    document.body.classList.remove("sidebar-open");
    const contactOverlay = document.getElementById("contactOverlay");
    if (contactOverlay) {
      contactOverlay.style.display = "";
      contactOverlay.style.pointerEvents = "";
      contactOverlay.style.opacity = "";
      contactOverlay.style.visibility = "";
    }
  };

  const openSidebar = () => {
    sidebar.classList.add("is-open");
    document.getElementById("sidebarOverlay")?.classList.add("active");
    document.body.classList.add("sidebar-open");
    const contactOverlay = document.getElementById("contactOverlay");
    if (contactOverlay) {
      contactOverlay.classList.remove("panel-open");
      contactOverlay.classList.add("hidden");
      contactOverlay.style.display = "none";
      contactOverlay.style.pointerEvents = "none";
      contactOverlay.style.opacity = "0";
      contactOverlay.style.visibility = "hidden";
    }
    document.body.classList.remove("contact-panel-open");
  };

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest(".sidebar-toggle");
    if (toggle) {
      event.preventDefault();
      if (sidebar.classList.contains("is-open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
      return;
    }

    const close = event.target.closest(".sidebar-close");
    if (close) {
      event.preventDefault();
      closeSidebar();
      return;
    }

    if (event.target.id === "sidebarOverlay") {
      closeSidebar();
    }
  });

  document.addEventListener("change", (event) => {
    const select = event.target.closest(".tabs-select");
    if (!select) return;
    const next = select.value;
    if (next) window.location.href = next;
  });

  const hideTabs = () => {
    const tabsBar = document.querySelector(".tabs-bar");
    if (tabsBar) tabsBar.style.display = "none";
  };

  const showTabs = () => {
    const tabsBar = document.querySelector(".tabs-bar");
    if (tabsBar) tabsBar.style.display = "";
  };

  const syncMobileTabs = () => {
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const tabsBar = document.querySelector(".tabs-bar");
    if (!tabsBar) return;
    tabsBar.querySelectorAll("a").forEach((link) => {
      link.style.display = isMobile ? "none" : "";
    });
    const select = tabsBar.querySelector(".tabs-select");
    if (select) select.style.display = isMobile ? "block" : "";
  };

  const syncContactPanelState = () => {
    const addPanel = document.getElementById("addContactPanel");
    const editPanel = document.getElementById("editContactPanel");
    const contactOverlay = document.getElementById("contactOverlay");
    const isOpen =
      addPanel?.classList.contains("panel-open") ||
      editPanel?.classList.contains("panel-open");

    if (isOpen) {
      closeSidebar();
      hideTabs();
      document.body.classList.add("contact-panel-open");
      if (contactOverlay) {
        contactOverlay.style.display = "";
        contactOverlay.style.pointerEvents = "";
        contactOverlay.style.opacity = "";
        contactOverlay.style.visibility = "";
      }
    } else {
      showTabs();
      document.body.classList.remove("contact-panel-open");
      if (contactOverlay) {
        contactOverlay.style.display = "";
        contactOverlay.style.pointerEvents = "";
        contactOverlay.style.opacity = "";
        contactOverlay.style.visibility = "";
      }
    }
  };

  const addPanelEl = document.getElementById("addContactPanel");
  const editPanelEl = document.getElementById("editContactPanel");
  if (addPanelEl || editPanelEl) {
    const observer = new MutationObserver(() => {
      syncContactPanelState();
    });
    if (addPanelEl) observer.observe(addPanelEl, { attributes: true, attributeFilter: ["class"] });
    if (editPanelEl) observer.observe(editPanelEl, { attributes: true, attributeFilter: ["class"] });
    syncContactPanelState();
  }

  syncMobileTabs();
  window.addEventListener("resize", syncMobileTabs);

  document.addEventListener("click", (event) => {
    const openAdd = event.target.closest("#openAddPanelBtn");
    if (openAdd) {
      closeSidebar();
      hideTabs();
      document.body.classList.add("contact-panel-open");
    }

    const closeAdd = event.target.closest("#closeAddPanel, #cancelEdit");
    if (closeAdd) {
      showTabs();
      document.body.classList.remove("contact-panel-open");
    }
  });

  document.getElementById("contactOverlay")?.addEventListener("click", () => {
    showTabs();
    document.body.classList.remove("contact-panel-open");
  });

  /* =========================================================
     ? BURGER MENU - Stable toggle (no flicker, portal-safe)
  ========================================================= */
  document.addEventListener("click", (e) => {
    const menuButton = e.target.closest?.(".menu-btn");
    const dropdown = e.target.closest?.(".menu-dropdown");

    if (dropdown) return;

    if (menuButton) {
      e.stopPropagation();
      const { id } = menuButton.dataset;
      const menu = id ? document.getElementById(`menu-${id}`) : null;
      if (!menu) return;

      document.querySelectorAll(".menu-dropdown").forEach((m) => m.classList.add("hidden"));
      menu.classList.toggle("hidden");
      return;
    }

    document.querySelectorAll(".menu-dropdown").forEach((m) => m.classList.add("hidden"));
  });

  /* =========================================================
     ?? EDIT CONTACT PANEL (MATCHING ADD PANEL BEHAVIOR)
  ========================================================= */
  document.addEventListener("click", async (e) => {
    const editBtn = e.target.closest?.(".edit-btn");
    if (!editBtn) return;

    e.stopPropagation();

    const contactId = editBtn.dataset.id;
    if (!contactId || !fnId) {
      console.warn("?? Missing contactId or fnId for edit");
      return;
    }

    const editPanel = document.getElementById("editContactPanel");
    const overlay = document.getElementById("contactOverlay");
    if (!editPanel || !overlay) return;

    try {
      const res = await fetch(`/api/contacts/${contactId}`);
      if (!res.ok) throw new Error("Failed to load contact details");
      const contact = await res.json();

      document.getElementById("editContactId").value = contact.id_uuid || contact.id || "";
      document.getElementById("editContactFnId").value = fnId;
      document.getElementById("editContactName").value = contact.name || "";
      document.getElementById("editContactEmail").value = contact.email || "";
      document.getElementById("editContactPhone").value = contact.phone || "";
      document.getElementById("editContactCompany").value = contact.company || "";

      editPanel.classList.remove("hidden");
      overlay.classList.remove("hidden");
      void editPanel.offsetWidth;
      editPanel.classList.add("panel-open");
      overlay.classList.add("panel-open");
      document.body.classList.add("contact-panel-open");
      const tabsBar = document.querySelector(".tabs-bar");
      if (tabsBar) tabsBar.style.display = "none";
    } catch (err) {
      console.error("? Error loading contact for edit:", err);
      alert("? Failed to load contact details");
    }
  });

  /* =========================================================
     ?? SAVE EDITED CONTACT (UUID SAFE)
  ========================================================= */
  document.getElementById("editContactForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const idInput = document.getElementById("editContactId");
    const contactId = idInput.value?.trim() || idInput.dataset.id;
    const fnUUID = window.fnContext?.id;

    const body = {
      name: document.getElementById("editContactName").value.trim(),
      email: document.getElementById("editContactEmail").value.trim(),
      phone: document.getElementById("editContactPhone").value.trim(),
      company: document.getElementById("editContactCompany").value.trim(),
    };

    if (!contactId) {
      alert("? Missing contact ID - cannot save");
      return;
    }

    try {
      const res = await fetch(`/api/contacts/${fnUUID}/contacts/${contactId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.warn("First route failed, trying flat /api/contacts/:id...");
        const res2 = await fetch(`/api/contacts/${contactId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res2.ok) throw new Error(`Update failed: ${res2.status}`);
        const data2 = await res2.json();
        if (data2.success) {
          alert("? Contact updated successfully");
          setTimeout(() => location.reload(), 400);
          return;
        }
      }

      const data = await res.json();
      if (data.success) {
        alert("? Contact updated successfully");
        setTimeout(() => location.reload(), 400);
      } else {
        alert(data.message || "?? Contact update failed on server");
      }
    } catch (err) {
      console.error("? Edit contact save error:", err);
      alert("? Failed to update contact - see console for details");
    }
  });

  /* =========================================================
     ?? CLOSE EDIT PANEL (same pattern as add)
  ========================================================= */
  const closeEditPanel = () => {
    const editPanel = document.getElementById("editContactPanel");
    const overlay = document.getElementById("contactOverlay");
    if (!editPanel || !overlay) return;

    editPanel.classList.remove("panel-open");
    overlay.classList.remove("panel-open");
    document.body.classList.remove("contact-panel-open");
    const tabsBar = document.querySelector(".tabs-bar");
    if (tabsBar) tabsBar.style.display = "";
    setTimeout(() => {
      editPanel.classList.add("hidden");
      overlay.classList.add("hidden");
    }, 350);
  };

  document.getElementById("closeEditPanel")?.addEventListener("click", closeEditPanel);
  document.getElementById("cancelEdit")?.addEventListener("click", closeEditPanel);
  document.getElementById("contactOverlay")?.addEventListener("click", () => {
    const editPanel = document.getElementById("editContactPanel");
    if (editPanel?.classList.contains("panel-open")) closeEditPanel();
  });

  /* =========================================================
     ?? TIME MODAL
  ========================================================= */
  const modal = document.getElementById("timeModalContainer");
  if (!modal) return;

  const title = document.getElementById("timeModalTitle");
  const input = document.getElementById("timeInputField");
  const save = document.getElementById("saveTimeBtn");
  const cancel = document.getElementById("cancelTimeBtn");
  const closeBtn = document.getElementById("closeTimeModal");
  let currentField = null;

  sidebar.querySelectorAll(".time-modal-btn").forEach((btn) =>
    btn.addEventListener("click", (event) => {
      currentField = event.currentTarget?.dataset.field;
      title.textContent = currentField === "start_time" ? "Set Start Time" : "Set End Time";
      const currentValue = event.currentTarget.textContent.trim();
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

  [cancel, closeBtn].forEach((btn) => btn?.addEventListener("click", closeTimeModal));
  window.addEventListener("click", (event) => {
    if (event.target === modal) closeTimeModal();
  });

  save?.addEventListener("click", async () => {
    if (!fnId || !currentField) return showToast("?? Invalid time field");
    const val = input.value;
    if (!val) return showToast("?? Please select a time");

    try {
      const res = await fetch(`/functions/${fnId}/update-field`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: currentField, value: `${val}:00` }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("?? Time updated");
        closeTimeModal();
        setTimeout(() => location.reload(), 400);
      } else {
        showToast("?? Update failed");
      }
    } catch (err) {
      console.error("? Time modal error:", err);
      showToast("? Error saving time");
    }
  });
})();
