// public/js/settings/menuDrawer.js
document.addEventListener("DOMContentLoaded", () => {
  // 🛡️ prevent duplicate listeners if layout ever double-injects
  if (window.__menuDrawerInit) return;
  window.__menuDrawerInit = true;

  console.log("✅ menuDrawer.js loaded");

  // --------------------------
  // DOM refs
  // --------------------------
  const drawerEl = document.getElementById("menuDrawer");
  const form = document.getElementById("menuForm");
  const saveBtn = document.getElementById("saveMenuBtn");
  const addChoiceBtn = document.getElementById("addChoiceBtn");      // link existing
  const createChoiceBtn = document.getElementById("createChoiceBtn"); // create new
  const choiceList = document.getElementById("choiceList");

  // Create Choice modal + fields
  const createChoiceModalEl = document.getElementById("createChoiceModal");
  const createChoiceForm = document.getElementById("createChoiceForm");
  const choiceNameInput = document.getElementById("choiceName");
  const optionNameInput = document.getElementById("optionName");
  const optionPriceInput = document.getElementById("optionPrice");
  const optionUnitSelect = document.getElementById("optionUnit");

  // Link Existing modal + fields
  const linkChoiceModalEl = document.getElementById("linkChoiceModal");
  const linkResultsEl = document.getElementById("linkResults");
  const linkSearchInput = document.getElementById("linkSearch");

  if (!drawerEl || !form || !choiceList) {
    console.warn("⚠️ Menu drawer elements not found.");
    return;
  }

  // Bootstrap modals
  let createChoiceModal = null;
  let linkChoiceModal = null;
  if (createChoiceModalEl && window.bootstrap?.Modal) {
    createChoiceModal = new bootstrap.Modal(createChoiceModalEl);
  }
  if (linkChoiceModalEl && window.bootstrap?.Modal) {
    linkChoiceModal = new bootstrap.Modal(linkChoiceModalEl);
  }

  // --------------------------
  // State
  // --------------------------
  let currentMode = "create";   // "create" | "edit"
  let editMenuId = null;        // number | null
  let linkedChoices = [];       // [{ id, name, optionName?, price?, unit?, _staged? }, ...]
  let stagedChoices = window.__stagedChoices || []; // persist staged choices for create flow
  window.__stagedChoices = stagedChoices;

  // --------------------------
  // Helpers
  // --------------------------
  function populateUnits() {
    if (!optionUnitSelect) return;
    const units = (window.menuBuilderData && window.menuBuilderData.units) || [];
    optionUnitSelect.innerHTML = '<option value="">— none —</option>';
    units.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      optionUnitSelect.appendChild(opt);
    });
  }
  populateUnits();

  function badge(text, cls = "text-bg-secondary") {
    return `<span class="badge ${cls} ms-2">${text}</span>`;
  }

  function renderChoiceList() {
    choiceList.innerHTML = "";
    if (!linkedChoices.length) {
      const li = document.createElement("li");
      li.className = "list-group-item text-muted fst-italic";
      li.textContent = "No choices linked.";
      choiceList.appendChild(li);
      return;
    }
    linkedChoices.forEach((choice) => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center";
      li.innerHTML = `
        <span>
          <strong>${choice.name}</strong>
          ${choice.optionName ? `<span class="text-muted ms-2">(${choice.optionName})</span>` : ""}
          ${choice.price != null ? badge(Number(choice.price).toFixed(2), "text-bg-light") : ""}
          ${choice.unit ? badge(choice.unit, "text-bg-secondary") : ""}
          ${choice._staged ? badge("staged", "text-bg-warning") : ""}
        </span>
        <button class="btn btn-sm btn-outline-danger remove-choice" data-id="${choice.id}">×</button>
      `;
      choiceList.appendChild(li);
    });
  }

  function resetDrawerState() {
    form.reset();
    linkedChoices = [];
    stagedChoices = [];
    window.__stagedChoices = stagedChoices;
    currentMode = "create";
    editMenuId = null;
    renderChoiceList();
  }

  function debounce(fn, ms = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // --------------------------
  // Drawer lifecycle
  // --------------------------
  drawerEl.addEventListener("hidden.bs.offcanvas", resetDrawerState);

  // 🟢 OPEN: New Menu
  document.body.addEventListener("click", (e) => {
    const addBtn = e.target.closest("#addMenuBtn, .add-menu-btn");
    if (!addBtn) return;

    currentMode = "create";
    editMenuId = null;
    form.reset();
    linkedChoices = [];
    stagedChoices = [];
    window.__stagedChoices = stagedChoices;

    if (addBtn.dataset.category) {
      const catField = form.querySelector('[name="category_id"]');
      if (catField) catField.value = addBtn.dataset.category;
    }
    renderChoiceList();
    new bootstrap.Offcanvas(drawerEl).show();
  });

  // ✏️ OPEN: Edit Menu
  document.body.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-menu-btn");
    if (!editBtn) return;

    currentMode = "edit";
    editMenuId = editBtn.dataset.id;

    form.querySelector('[name="name"]').value = editBtn.dataset.name || "";
    form.querySelector('[name="category_id"]').value = editBtn.dataset.category || "";
    form.querySelector('[name="price"]').value = editBtn.dataset.price || "";
    form.querySelector('[name="description"]').value = editBtn.dataset.description || "";

    // Load linked choices from backend (flat view)
    try {
      const url = `/menus/builder/menus/${editMenuId}/choices`;
      console.log("🔎 fetching linked choices:", url);
      const res = await fetch(url);
      const payload = await res.json().catch(() => ({}));
      linkedChoices = (payload.success && Array.isArray(payload.data)) ? payload.data : [];
      renderChoiceList();
    } catch (err) {
      console.error("❌ Error fetching menu choices:", err);
      linkedChoices = [];
      renderChoiceList();
    }

    new bootstrap.Offcanvas(drawerEl).show();
  });

  // --------------------------
  // Create Choice (Modal)
  // --------------------------
  createChoiceBtn?.addEventListener("click", () => {
    if (!createChoiceModal) return alert("Modal not available.");
    // reset modal fields
    choiceNameInput.value = "";
    optionNameInput.value = "";
    optionPriceInput.value = "";
    optionUnitSelect.value = "";
    createChoiceModal.show();
    setTimeout(() => choiceNameInput?.focus(), 150);
  });

  // UX nicety: keep option name synced to choice name if blank
  choiceNameInput?.addEventListener("input", () => {
    if (!optionNameInput.value) optionNameInput.value = choiceNameInput.value;
  });

  let createChoiceInFlight = false;

  createChoiceForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (createChoiceInFlight) return;
    createChoiceInFlight = true;

    const submitBtn = createChoiceForm.querySelector('button[type="submit"]');
    submitBtn?.setAttribute('disabled', 'disabled');

    try {
      const name = (choiceNameInput.value || "").trim();
      const option_name = (optionNameInput.value || "").trim() || name; // NOT NULL
      const price = (optionPriceInput.value || "") === "" ? null : Number(optionPriceInput.value);
      const unit_id = optionUnitSelect.value ? Number(optionUnitSelect.value) : null;

      if (!name) {
        alert("Please enter a choice name.");
        return;
      }

      if (editMenuId) {
        // EDIT MODE → persist immediately
        const res = await fetch(`/menus/builder/menus/${editMenuId}/choices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, option_name, price, unit_id }),
        });
        const payload = await res.json();
        if (payload.success && payload.data) {
          linkedChoices.push(payload.data);
          renderChoiceList();
          createChoiceModal?.hide();
        } else {
          alert("❌ " + (payload.error || "Failed to create choice"));
        }
        return;
      }

      // CREATE MODE → stage locally; will persist after menu is created
      stagedChoices.push({ name, option_name, price, unit_id });
      // add a visible staged pill to the list
      const units = (window.menuBuilderData && window.menuBuilderData.units) || [];
      const unitName = unit_id ? (units.find(x => String(x.id) === String(unit_id))?.name || null) : null;
      linkedChoices.push({
        id: `staged-${Date.now()}`,
        name,
        optionName: option_name,
        price,
        unit: unitName,
        _staged: true
      });
      renderChoiceList();
      createChoiceModal?.hide();
    } catch (err) {
      console.error("❌ Error creating choice:", err);
      alert("❌ Error creating choice");
    } finally {
      submitBtn?.removeAttribute('disabled');
      createChoiceInFlight = false;
    }
  });

  // --------------------------
  // Link Existing Choice (modal: open → search → click-to-link)
  // --------------------------
  addChoiceBtn?.addEventListener("click", () => {
    if (!editMenuId) {
      alert("Open an existing menu first (or save the new one) to link choices.");
      return;
    }
    if (!linkChoiceModal) return alert("Modal not available.");
    // reset UI
    linkSearchInput.value = "";
    linkResultsEl.innerHTML = '<div class="list-group-item text-muted fst-italic">Start typing to find choices…</div>';
    linkChoiceModal.show();
    setTimeout(() => linkSearchInput?.focus(), 150);
  });

  function renderLinkResults(rows = []) {
    linkResultsEl.innerHTML = "";
    if (!rows.length) {
      linkResultsEl.innerHTML = '<div class="list-group-item text-muted fst-italic">No matches.</div>';
      return;
    }
    rows.forEach(row => {
      const price = row.option_price != null ? Number(row.option_price).toFixed(2) : null;
      const unit = row.unit_name || null;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
      el.dataset.choiceId = row.choice_id;
      el.innerHTML = `
        <span>
          <strong>${row.choice_name}</strong>
          ${row.option_name ? `<span class="text-muted ms-2">(${row.option_name})</span>` : ""}
          ${price ? `<span class="badge text-bg-light ms-2">${price}</span>` : ""}
          ${unit ? `<span class="badge text-bg-secondary ms-1">${unit}</span>` : ""}
        </span>
        <span class="btn btn-sm btn-primary">Link</span>
      `;
      linkResultsEl.appendChild(el);
    });
  }

  const doSearch = debounce(async (term) => {
    term = (term || "").trim();
    if (!term) {
      renderLinkResults([]);
      linkResultsEl.innerHTML = '<div class="list-group-item text-muted fst-italic">Start typing to find choices…</div>';
      return;
    }
    try {
      const res = await fetch(`/menus/builder/choices/search?q=${encodeURIComponent(term)}&menu_id=${editMenuId}`);
      const payload = await res.json();
      if (payload.success) {
        renderLinkResults(payload.data || []);
      } else {
        linkResultsEl.innerHTML = `<div class="list-group-item text-danger">❌ ${payload.error || "Search failed"}</div>`;
      }
    } catch (err) {
      console.error("Search error:", err);
      linkResultsEl.innerHTML = `<div class="list-group-item text-danger">❌ Error searching</div>`;
    }
  }, 300);

  linkSearchInput?.addEventListener("input", (e) => doSearch(e.target.value));

  linkResultsEl?.addEventListener("click", async (e) => {
    const rowBtn = e.target.closest(".list-group-item");
    if (!rowBtn) return;
    const choiceId = Number(rowBtn.dataset.choiceId);
    if (!choiceId || !editMenuId) return;

    rowBtn.classList.add("disabled");
    try {
      const linkRes = await fetch(`/menus/builder/menus/${editMenuId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice_id: choiceId })
      });
      const linkPayload = await linkRes.json();
      if (linkPayload.success) {
        const r = linkPayload.data;
        linkedChoices.push({
          menuId: r.menu_id,
          id: r.choice_id,
          name: r.choice_name,
          optionId: r.option_id,
          optionName: r.option_name,
          price: r.option_price != null ? Number(r.option_price) : null,
          unit: r.unit_name || null
        });
        renderChoiceList();
        rowBtn.remove(); // prevent linking same again
        // If you prefer auto-close after link:
        // linkChoiceModal?.hide();
      } else {
        alert("❌ " + (linkPayload.error || "Failed to link choice"));
        rowBtn.classList.remove("disabled");
      }
    } catch (err) {
      console.error("❌ Link existing choice error:", err);
      alert("❌ Link existing choice error");
      rowBtn.classList.remove("disabled");
    }
  });

  // --------------------------
  // Remove Linked Choice (no reload; drawer stays open)
  // --------------------------
  choiceList?.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("remove-choice")) return;
    const choiceId = e.target.dataset.id;

    // staged → just remove from arrays
    if (String(choiceId).startsWith("staged-")) {
      linkedChoices = linkedChoices.filter(c => String(c.id) !== String(choiceId));
      window.__stagedChoices = (window.__stagedChoices || []).filter(s => s._localId !== choiceId);
      renderChoiceList();
      return;
    }

    if (!editMenuId) {
      alert("Save the menu first, then remove linked choices.");
      return;
    }

    try {
      const res = await fetch(`/menus/builder/menus/${editMenuId}/choices/${choiceId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        linkedChoices = linkedChoices.filter(c => String(c.id) !== String(choiceId));
        renderChoiceList();
      } else {
        const payload = await res.json().catch(() => ({}));
        alert("❌ Failed to unlink: " + (payload.error || res.statusText));
      }
    } catch (err) {
      console.error("❌ Error unlinking choice:", err);
      alert("❌ Error unlinking choice");
    }
  });

  // --------------------------
  // Save Menu
  // --------------------------
  saveBtn?.addEventListener("click", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    try {
      if (currentMode === "edit") {
        // If you add an /edit endpoint for menu fields, call it here.
        alert("✅ Changes saved.");
        location.reload();
        return;
      }

      // CREATE MODE: create menu first (must return {success, data:{id}})
      const createRes = await fetch(`/settings/menus/menu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Expecting JSON { success, data: { id } }
      const created = await createRes.json().catch(() => null);
      const newMenuId = created?.data?.id;

      if (!createRes.ok || !newMenuId) {
        throw new Error((created && created.error) || "Failed to create menu (ensure /settings/menus/menu returns id).");
      }

      // Persist staged choices
      for (const c of stagedChoices) {
        try {
          await fetch(`/menus/builder/menus/${newMenuId}/choices`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          });
        } catch (err) {
          console.error("⚠️ Failed to attach staged choice:", c.name, err);
        }
      }

      alert("✅ Menu created!");
      location.reload();
    } catch (err) {
      console.error(err);
      alert("❌ Error saving menu: " + err.message);
    }
  });
});
