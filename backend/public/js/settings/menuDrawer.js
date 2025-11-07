// public/js/settings/menuDrawer.js
document.addEventListener("DOMContentLoaded", () => {
  // 🛡️ prevent duplicate listeners if layout ever double-injects
  const initKey = "__menuDrawerInit__";
  const currentPath = window.location.pathname;
  if (window[initKey] === currentPath) return;
  window[initKey] = currentPath;

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
  const addonList = document.getElementById("addonList");
  const addAddonBtn = document.getElementById("addAddonBtn");

  const drawerInstance =
    drawerEl && window.bootstrap?.Offcanvas
      ? bootstrap.Offcanvas.getOrCreateInstance(drawerEl)
      : null;

  // Create Choice modal + fields
  const createChoiceModalEl = document.getElementById("createChoiceModal");
  const createChoiceForm = document.getElementById("createChoiceForm");
  const choiceNameInput = document.getElementById("choiceName");
  const optionNameInput = document.getElementById("optionName");
  const optionPriceInput = document.getElementById("optionPrice");
  const optionUnitSelect = document.getElementById("optionUnit");
  const optionCostInput = document.getElementById("optionCost");

  // Link Existing modal + fields
  const linkChoiceModalEl = document.getElementById("linkChoiceModal");
  const linkResultsEl = document.getElementById("linkResults");
  const linkSearchInput = document.getElementById("linkSearch");

  // Add-on modal + fields
  const addonModalEl = document.getElementById("addonModal");
  const addonForm = document.getElementById("addonForm");
  const addonIdInput = document.getElementById("addonId");
  const addonNameInput = document.getElementById("addonName");
  const addonPriceInput = document.getElementById("addonPrice");
  const addonUnitSelect = document.getElementById("addonUnit");
  const addonEnableQty = document.getElementById("addonEnableQty");
  const addonDefaultQty = document.getElementById("addonDefaultQty");

  if (!drawerEl || !form || !choiceList) {
    console.warn("⚠️ Menu drawer elements not found.");
    return;
  }

  // Bootstrap modals
  let createChoiceModal = null;
  let linkChoiceModal = null;
  let addonModal = null;
  if (createChoiceModalEl && window.bootstrap?.Modal) {
    createChoiceModal = new bootstrap.Modal(createChoiceModalEl);
  }
  if (linkChoiceModalEl && window.bootstrap?.Modal) {
    linkChoiceModal = new bootstrap.Modal(linkChoiceModalEl);
  }
  if (addonModalEl && window.bootstrap?.Modal) {
    addonModal = new bootstrap.Modal(addonModalEl);
  }

  // --------------------------
  // State
  // --------------------------
  let currentMode = "create";   // "create" | "edit"
  let editMenuId = null;        // number | null
  let linkedChoices = [];       // [{ id, name, optionName?, price?, cost?, unit?, _staged?, _localId? }, ...]
  let stagedChoices = window.__stagedChoices || []; // persist staged choices for create flow
  window.__stagedChoices = stagedChoices;
  let choiceModalMode = "create";
  let editingChoiceId = null;
  let editingChoiceIsStaged = false;
  let editingChoiceLocalId = null;
  let editingChoiceOptionId = null;
  let editingChoiceDescription = "";
  let linkedAddons = [];
  let stagedAddons = window.__stagedAddons || [];
  window.__stagedAddons = stagedAddons;
  let addonModalMode = "create";
  let editingAddonId = null;
  let editingAddonStaged = false;

  // --------------------------
  // Helpers
  // --------------------------
  const unitLookup = new Map();

  function populateUnits() {
    const units = (window.menuBuilderData && window.menuBuilderData.units) || [];
    unitLookup.clear();
    units.forEach((u) => unitLookup.set(String(u.id), u));

    if (optionUnitSelect) {
      optionUnitSelect.innerHTML = '<option value="">— none —</option>';
      units.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = u.name;
        optionUnitSelect.appendChild(opt);
      });
    }

    if (addonUnitSelect) {
      addonUnitSelect.innerHTML = '<option value="">No unit</option>';
      units.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = `${u.name}`;
        addonUnitSelect.appendChild(opt);
      });
    }
  }
  populateUnits();
  renderAddonList();

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
      li.className =
        "list-group-item d-flex justify-content-between align-items-start gap-3";
      li.dataset.id = String(choice.id);
      if (choice._staged) li.dataset.staged = "true";
      if (choice._localId) li.dataset.localId = choice._localId;

      const detail = document.createElement("div");
      detail.innerHTML = `
        <div>
          <strong>${choice.name}</strong>
          ${choice.optionName ? `<span class="text-muted ms-2">(${choice.optionName})</span>` : ""}
          ${choice._staged ? badge("staged", "text-bg-warning") : ""}
        </div>
        <div class="small text-muted">
          ${choice.price != null ? `Price: ${formatCurrency(choice.price)}` : "Price: n/a"}
          ${choice.cost != null ? ` • Cost: ${formatCurrency(choice.cost)}` : ""}
          ${choice.unit ? ` • ${choice.unit}` : ""}
        </div>
      `;

      const actions = document.createElement("div");
      actions.className = "btn-group btn-group-sm";
      actions.innerHTML = `
        <button type="button" class="btn btn-outline-secondary edit-choice">Edit</button>
        <button type="button" class="btn btn-outline-danger remove-choice">Remove</button>
      `;

      li.appendChild(detail);
      li.appendChild(actions);
      choiceList.appendChild(li);
    });
  }

  function formatCurrency(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "$0.00";
    return `$${num.toFixed(2)}`;
  }

  async function loadAddonsForMenu(menuId) {
    if (!editMenuId) return;
    try {
      const addonUrl = `/settings/menus/addons/${menuId}`;
      const res = await fetch(addonUrl);
      const payload = await res.json().catch(() => ({}));
      linkedAddons =
        payload.success && Array.isArray(payload.data)
          ? payload.data.map((item) => normalizeAddon(item))
          : [];
    } catch (err) {
      console.error("❌ Error fetching menu add-ons:", err);
      linkedAddons = [];
    }
    renderAddonList();
  }

  function openDrawerInstance() {
    drawerInstance?.show();
  }

  function applyMenuFormValues(menu = {}) {
    if (!form) return;
    const nameField = form.querySelector('[name="name"]');
    const categoryField = form.querySelector('[name="category_id"]');
    const priceField = form.querySelector('[name="price"]');
    const descriptionField = form.querySelector('[name="description"]');

    if (nameField) nameField.value = menu.name || "";
    if (categoryField) {
      const value =
        menu.category_id !== undefined && menu.category_id !== null
          ? String(menu.category_id)
          : "";
      categoryField.value = value;
    }
    if (priceField) {
      priceField.value =
        menu.price !== undefined && menu.price !== null ? menu.price : "";
    }
    if (descriptionField) descriptionField.value = menu.description || "";
  }

  function resetStagedData() {
    linkedChoices = [];
    stagedChoices = [];
    window.__stagedChoices = stagedChoices;
    linkedAddons = [];
    stagedAddons = [];
    window.__stagedAddons = stagedAddons;
    renderChoiceList();
    renderAddonList();
  }

  function openMenuForCreate({ categoryId = null } = {}) {
    currentMode = "create";
    editMenuId = null;
    form?.reset();
    resetStagedData();
    if (categoryId != null) {
      const categoryField = form?.querySelector('[name="category_id"]');
      if (categoryField) categoryField.value = String(categoryId);
    }
    openDrawerInstance();
  }

  async function openMenuForEdit(menu = {}) {
    const menuId = Number(menu.id ?? menu.menu_id);
    if (!Number.isFinite(menuId) || menuId <= 0) {
      console.error("openMenuForEdit: invalid menu id", menu);
      return;
    }
    currentMode = "edit";
    editMenuId = menuId;
    form?.reset();
    applyMenuFormValues(menu);
    stagedChoices = [];
    window.__stagedChoices = stagedChoices;
    await reloadLinkedChoices();
    linkedAddons = [];
    renderAddonList();
    await loadAddonsForMenu(menuId);
    openDrawerInstance();
  }

  async function openMenuDrawerExternal(options = {}) {
    try {
      if (options.mode === "edit") {
        let menuData = options.menu || null;
        const menuId = Number(
          options.id ?? options.menu_id ?? menuData?.id ?? menuData?.menu_id
        );
        if (!menuData) {
          if (!Number.isFinite(menuId) || menuId <= 0) {
            throw new Error("Menu id is required to edit.");
          }
          const res = await fetch(`/settings/menus/api/${menuId}`);
          const payload = await res.json();
          if (!payload.success) {
            throw new Error(payload.error || "Failed to load menu.");
          }
          menuData = payload.data || {};
        }
        await openMenuForEdit(menuData);
      } else {
        openMenuForCreate({
          categoryId:
            options.categoryId ?? options.category_id ?? null,
        });
      }
    } catch (err) {
      console.error("menuDrawerApi.open error:", err);
      alert(err.message || "Failed to open menu drawer.");
    }
  }

  window.menuDrawerApi = window.menuDrawerApi || {};
  window.menuDrawerApi.open = openMenuDrawerExternal;
  window.menuDrawerApi.populateUnits = populateUnits;

function normalizeLinkedChoice(choice = {}) {
  const price =
    choice.price != null
      ? Number(choice.price)
      : choice.option_price != null
      ? Number(choice.option_price)
      : null;
  const cost =
    choice.cost != null
      ? Number(choice.cost)
      : choice.option_cost != null
      ? Number(choice.option_cost)
      : null;
  const choiceId = choice.id ?? choice.choice_id ?? null;
  return {
    menuId: choice.menuId ?? choice.menu_id ?? null,
    id: choiceId,
    choice_id: choiceId,
    name: choice.name ?? choice.choice_name ?? "",
    optionId: choice.optionId ?? choice.option_id ?? null,
    optionName: choice.optionName ?? choice.option_name ?? null,
    price,
    cost,
    unit: choice.unit ?? choice.unit_name ?? null,
    unitId: choice.unit_id ?? null,
    _staged: Boolean(choice._staged),
    _localId: choice._localId || null,
  };
}

async function reloadLinkedChoices() {
  if (!editMenuId) {
    linkedChoices = [];
    renderChoiceList();
    return;
  }
  try {
    const res = await fetch(`/menus/builder/menus/${editMenuId}/choices`);
    const payload = await res.json().catch(() => ({}));
    linkedChoices =
      payload.success && Array.isArray(payload.data)
        ? payload.data.map((item) => normalizeLinkedChoice(item))
        : [];
  } catch (err) {
    console.error("❌ Error fetching menu choices:", err);
    linkedChoices = [];
  }
  renderChoiceList();
}

function createLocalChoiceId() {
  return `staged-choice-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

stagedChoices = stagedChoices.map((choice) => {
  if (!choice) return choice;
  if (!choice._localId) {
    return { ...choice, _localId: createLocalChoiceId() };
  }
  return choice;
});
window.__stagedChoices = stagedChoices;
if (stagedChoices.length && !linkedChoices.length) {
  linkedChoices = stagedChoices.map((choice) =>
    normalizeLinkedChoice({
      choice_id: choice._localId,
      choice_name: choice.name,
      option_name: choice.option_name || choice.name,
      option_price: choice.price,
      option_cost: choice.cost,
      unit_name:
        choice.unit_id != null
          ? unitLookup.get(String(choice.unit_id))?.name || null
          : null,
      unit_id: choice.unit_id ?? null,
      _staged: true,
      _localId: choice._localId,
    })
  );
}

function normalizeAddon(addon = {}) {
    const unitId =
      addon.unit_id !== undefined && addon.unit_id !== null && addon.unit_id !== ""
        ? Number(addon.unit_id)
        : null;
    const unitRecord = unitId != null ? unitLookup.get(String(unitId)) || null : null;
    const enableQuantity =
      addon.enable_quantity === true ||
      addon.enable_quantity === "true" ||
      addon.enable_quantity === 1;
    return {
      id: addon.id ?? null,
      menu_id: addon.menu_id ?? null,
      name: addon.name || "",
      price:
        addon.price !== undefined && addon.price !== null && addon.price !== ""
          ? Number(addon.price)
          : null,
      optional_cost:
        addon.optional_cost !== undefined &&
        addon.optional_cost !== null &&
        addon.optional_cost !== ""
          ? Number(addon.optional_cost)
          : null,
      unit_id: unitId,
      unit_name: addon.unit_name || unitRecord?.name || null,
      unit_type: addon.unit_type || unitRecord?.type || null,
      enable_quantity: enableQuantity,
      default_quantity:
        addon.default_quantity !== undefined &&
        addon.default_quantity !== null &&
        addon.default_quantity !== ""
          ? Number(addon.default_quantity)
          : enableQuantity
          ? 1
          : null,
      _staged: Boolean(addon._staged),
      _localId: addon._localId || null,
    };
  }

  function createLocalAddonId() {
    return `staged-addon-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  function describeAddon(addon) {
    const bits = [];
    if (addon.price != null) bits.push(formatCurrency(addon.price));
    if (addon.unit_name) bits.push(addon.unit_name);
    if (addon.enable_quantity) {
      const qty = addon.default_quantity && addon.default_quantity > 0 ? addon.default_quantity : 1;
      bits.push(`Qty default ${qty}`);
    } else if (
      addon.unit_type &&
      ["per_person", "per-person", "per person"].includes(String(addon.unit_type).toLowerCase())
    ) {
      bits.push("Per attendee");
    }
    return bits.length ? bits.join(" • ") : "No pricing details set.";
  }

  function renderAddonList() {
    if (!addonList) return;
    addonList.innerHTML = "";
    const items = [...linkedAddons, ...stagedAddons];
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "list-group-item text-muted fst-italic";
      li.textContent = "No add-ons configured.";
      addonList.appendChild(li);
      return;
    }
    items.forEach((addon) => {
      const normalized = normalizeAddon(addon);
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-start gap-3 addon-row";
      const key = normalized._staged ? normalized._localId : normalized.id;
      li.dataset.id = key != null ? String(key) : "";
      li.dataset.staged = normalized._staged ? "true" : "false";
      li.innerHTML = `
        <div>
          <div class="fw-semibold">
            ${normalized.name || "Untitled add-on"}
            ${normalized._staged ? badge("staged", "text-bg-warning") : ""}
          </div>
          <div class="small text-muted">${describeAddon(normalized)}</div>
        </div>
        <div class="btn-group btn-group-sm">
          <button type="button" class="btn btn-outline-secondary addon-edit">Edit</button>
          <button type="button" class="btn btn-outline-danger addon-delete">Delete</button>
        </div>
      `;
      addonList.appendChild(li);
    });
  }

  function toggleAddonQtyState(enabled) {
    if (!addonEnableQty || !addonDefaultQty) return;
    addonEnableQty.checked = enabled;
    addonDefaultQty.disabled = !enabled;
    if (!enabled) {
      addonDefaultQty.value = "";
    } else if (!addonDefaultQty.value) {
      addonDefaultQty.value = "1";
    }
  }

  function openAddonModal(mode = "create", addon = null) {
    addonModalMode = mode;
    editingAddonId = addon && addon.id ? addon.id : addon?._localId || null;
    editingAddonStaged = Boolean(addon?._staged);

    if (addonIdInput) addonIdInput.value = editingAddonId != null ? editingAddonId : "";
    if (addonNameInput) addonNameInput.value = addon?.name || "";
    if (addonPriceInput)
      addonPriceInput.value =
        addon?.price != null && Number.isFinite(Number(addon.price))
          ? Number(addon.price).toFixed(2)
          : "";
    if (addonUnitSelect)
      addonUnitSelect.value =
        addon?.unit_id != null && !Number.isNaN(Number(addon.unit_id))
          ? String(Number(addon.unit_id))
          : "";
    toggleAddonQtyState(addon?.enable_quantity || false);
    if (addon?.enable_quantity && addonDefaultQty) {
      const qty = addon.default_quantity && addon.default_quantity > 0 ? addon.default_quantity : 1;
      addonDefaultQty.value = String(qty);
    }
    if (addonModal) {
      const title = document.getElementById("addonModalTitle");
      if (title) title.textContent = mode === "edit" ? "Edit Add-on" : "Add Add-on";
      addonModal.show();
    }
  }

  function resetDrawerState() {
    form.reset();
    addonForm?.reset();
    toggleAddonQtyState(false);
    linkedChoices = [];
    stagedChoices = [];
    window.__stagedChoices = stagedChoices;
    linkedAddons = [];
    stagedAddons = [];
    window.__stagedAddons = stagedAddons;
    currentMode = "create";
    editMenuId = null;
    addonModalMode = "create";
    editingAddonId = null;
    editingAddonStaged = false;
    choiceModalMode = "create";
    editingChoiceId = null;
    editingChoiceIsStaged = false;
    editingChoiceLocalId = null;
    editingChoiceOptionId = null;
    editingChoiceDescription = "";
    renderChoiceList();
    renderAddonList();
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
    const categoryId = addBtn.dataset.category
      ? Number(addBtn.dataset.category)
      : null;
    openMenuForCreate({ categoryId });
  });

  // ✏️ OPEN: Edit Menu
  document.body.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-menu-btn");
    if (!editBtn) return;
    const menuData = {
      id: editBtn.dataset.id ? Number(editBtn.dataset.id) : null,
      name: editBtn.dataset.name || "",
      category_id:
        editBtn.dataset.category !== undefined
          ? editBtn.dataset.category
          : "",
      price:
        editBtn.dataset.price !== undefined ? editBtn.dataset.price : "",
      description: editBtn.dataset.description || "",
    };
    await openMenuForEdit(menuData);
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
    if (optionCostInput) optionCostInput.value = "";
    choiceModalMode = "create";
    editingChoiceId = null;
    editingChoiceIsStaged = false;
    editingChoiceLocalId = null;
    editingChoiceOptionId = null;
    editingChoiceDescription = "";
    createChoiceModal.show();
    setTimeout(() => choiceNameInput?.focus(), 150);
  });

  // UX nicety: keep option name synced to choice name if blank
  choiceNameInput?.addEventListener("input", () => {
    if (!optionNameInput.value) optionNameInput.value = choiceNameInput.value;
  });

  addonList?.addEventListener("click", async (event) => {
    const row = event.target.closest(".addon-row");
    if (!row) return;
    const id = row.dataset.id;
    const isStaged = row.dataset.staged === "true";

    if (event.target.closest(".addon-edit")) {
      const pool = isStaged ? stagedAddons : linkedAddons;
      const match = pool.find((item) =>
        isStaged ? item._localId === id : String(item.id) === String(id)
      );
      if (!match) return;
      openAddonModal("edit", { ...match, _staged: isStaged });
      setTimeout(() => addonNameInput?.focus(), 150);
      return;
    }

    if (event.target.closest(".addon-delete")) {
      if (isStaged) {
        stagedAddons = stagedAddons.filter((item) => item._localId !== id);
        window.__stagedAddons = stagedAddons;
        renderAddonList();
        return;
      }
      if (!confirm("Delete this add-on?")) return;
      try {
        const res = await fetch(`/settings/menus/addons/${id}`, { method: "DELETE" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || payload.success === false) {
          throw new Error(payload.error || "Failed to delete add-on.");
        }
        linkedAddons = linkedAddons.filter((item) => String(item.id) !== String(id));
        renderAddonList();
      } catch (err) {
        console.error("❌ Add-on delete error:", err);
        alert(err.message || "Failed to delete add-on.");
      }
    }
  });

  addonModalEl?.addEventListener("hidden.bs.modal", () => {
    addonForm?.reset();
    toggleAddonQtyState(false);
    addonModalMode = "create";
    editingAddonId = null;
    editingAddonStaged = false;
    addonFormInFlight = false;
  });

  addonEnableQty?.addEventListener("change", (event) => {
    toggleAddonQtyState(event.target.checked);
  });

  addAddonBtn?.addEventListener("click", () => {
    openAddonModal("create");
    setTimeout(() => addonNameInput?.focus(), 150);
  });

  let createChoiceInFlight = false;
  let addonFormInFlight = false;

  createChoiceModalEl?.addEventListener("hidden.bs.modal", () => {
    createChoiceForm?.reset();
    choiceModalMode = "create";
    editingChoiceId = null;
    editingChoiceIsStaged = false;
    editingChoiceLocalId = null;
    editingChoiceOptionId = null;
    editingChoiceDescription = "";
    if (optionUnitSelect) optionUnitSelect.value = "";
    if (optionCostInput) optionCostInput.value = "";
    if (optionPriceInput) optionPriceInput.value = "";
    if (optionNameInput) optionNameInput.value = "";
    if (choiceNameInput) choiceNameInput.value = "";
  });

  createChoiceForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (createChoiceInFlight) return;
    createChoiceInFlight = true;

    const submitBtn = createChoiceForm.querySelector('button[type="submit"]');
    submitBtn?.setAttribute("disabled", "disabled");

    const name = (choiceNameInput?.value || "").trim();
    if (!name) {
      alert("Please enter a choice name.");
      submitBtn?.removeAttribute("disabled");
      createChoiceInFlight = false;
      return;
    }

    const optionLabel = (optionNameInput?.value || "").trim() || name;
    const price =
      optionPriceInput?.value === "" || optionPriceInput?.value == null
        ? null
        : Number(optionPriceInput.value);
    if (optionPriceInput?.value && !Number.isFinite(price)) {
      alert("Price must be a valid number.");
      submitBtn?.removeAttribute("disabled");
      createChoiceInFlight = false;
      optionPriceInput?.focus();
      return;
    }
    const cost =
      optionCostInput?.value === "" || optionCostInput?.value == null
        ? null
        : Number(optionCostInput.value);
    if (optionCostInput?.value && !Number.isFinite(cost)) {
      alert("Cost must be a valid number.");
      submitBtn?.removeAttribute("disabled");
      createChoiceInFlight = false;
      optionCostInput?.focus();
      return;
    }
    const unitId = optionUnitSelect?.value
      ? Number(optionUnitSelect.value)
      : null;
    const unitName =
      unitId != null
        ? unitLookup.get(String(unitId))?.name || null
        : null;

    try {
      if (choiceModalMode === "edit-staged" && editingChoiceLocalId) {
        stagedChoices = stagedChoices.map((item) =>
          item._localId === editingChoiceLocalId
            ? {
                ...item,
                name,
                option_name: optionLabel,
                price,
                cost,
                unit_id: unitId,
              }
            : item
        );
        window.__stagedChoices = stagedChoices;
        linkedChoices = linkedChoices.map((item) =>
          item._localId === editingChoiceLocalId
            ? {
                ...item,
                name,
                optionName: optionLabel,
                price,
                cost,
                unit: unitName,
                unitId,
                _staged: true,
                _localId: editingChoiceLocalId,
              }
            : item
        );
        renderChoiceList();
        choiceModalMode = "create";
        editingChoiceId = null;
        editingChoiceIsStaged = false;
        editingChoiceLocalId = null;
        editingChoiceOptionId = null;
        editingChoiceDescription = "";
        createChoiceModal?.hide();
        return;
      }

      if (choiceModalMode === "edit-existing" && editingChoiceId) {
        const res = await fetch(
          `/settings/menus/choices/api/${editingChoiceId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              description: editingChoiceDescription || null,
            }),
          }
        );
        const basePayload = await res.json();
        if (!basePayload.success) {
          throw new Error(basePayload.error || "Failed to update choice.");
        }

        const optionPayload = {
          name: optionLabel,
          price,
          cost,
          unit_id: unitId,
        };

        if (editingChoiceOptionId) {
          const optionRes = await fetch(
            `/settings/menus/choices/api/${editingChoiceId}/options/${editingChoiceOptionId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(optionPayload),
            }
          );
          const optionData = await optionRes.json();
          if (!optionData.success) {
            throw new Error(optionData.error || "Failed to update price/unit.");
          }
        } else {
          const optionRes = await fetch(
            `/settings/menus/choices/api/${editingChoiceId}/options`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(optionPayload),
            }
          );
          const optionData = await optionRes.json();
          if (!optionData.success) {
            throw new Error(optionData.error || "Failed to update price/unit.");
          }
        }

        await reloadLinkedChoices();
        choiceModalMode = "create";
        editingChoiceId = null;
        editingChoiceIsStaged = false;
        editingChoiceLocalId = null;
        editingChoiceOptionId = null;
        editingChoiceDescription = "";
        createChoiceModal?.hide();
        return;
      }

      if (currentMode === "edit" && editMenuId) {
        const res = await fetch(`/menus/builder/menus/${editMenuId}/choices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            option_name: optionLabel,
            price,
            cost,
            unit_id: unitId,
          }),
        });
        const payload = await res.json();
        if (!payload.success || !payload.data) {
          throw new Error(payload.error || "Failed to create choice.");
        }
        linkedChoices.push(normalizeLinkedChoice(payload.data));
        renderChoiceList();
        choiceModalMode = "create";
        createChoiceModal?.hide();
        return;
      }

      const localId = createLocalChoiceId();
      const stagedRecord = {
        _localId: localId,
        name,
        option_name: optionLabel,
        price,
        cost,
        unit_id: unitId,
      };
      stagedChoices.push(stagedRecord);
      window.__stagedChoices = stagedChoices;
      linkedChoices.push({
        id: localId,
        name,
        optionName: optionLabel,
        price,
        cost,
        unit: unitName,
        unitId,
        _staged: true,
        _localId: localId,
      });
      renderChoiceList();
      choiceModalMode = "create";
      createChoiceModal?.hide();
    } catch (err) {
      console.error("❌ Error saving choice:", err);
      alert(err.message || "Failed to save choice.");
    } finally {
      submitBtn?.removeAttribute("disabled");
      createChoiceInFlight = false;
    }
  });

  addonForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (addonFormInFlight) return;
    const name = (addonNameInput?.value || "").trim();
    if (!name) {
      alert("Please provide an add-on name.");
      addonNameInput?.focus();
      return;
    }
    const priceRaw = addonPriceInput?.value ?? "";
    const price =
      priceRaw === "" || priceRaw === null ? null : Number(priceRaw);
    if (priceRaw !== "" && !Number.isFinite(price)) {
      alert("Price must be a valid number.");
      addonPriceInput?.focus();
      return;
    }
    const unitVal =
      addonUnitSelect && addonUnitSelect.value
        ? Number(addonUnitSelect.value)
        : null;
    const enableQty = addonEnableQty?.checked || false;
    let defaultQty =
      enableQty && addonDefaultQty && addonDefaultQty.value !== ""
        ? Number(addonDefaultQty.value)
        : enableQty
        ? 1
        : null;
    if (enableQty && (!Number.isFinite(defaultQty) || defaultQty <= 0)) {
      alert("Default quantity must be a positive number.");
      addonDefaultQty?.focus();
      return;
    }

    const submitBtn = addonForm.querySelector('button[type="submit"]');
    addonFormInFlight = true;
    submitBtn?.setAttribute("disabled", "disabled");

    const basePayload = {
      name,
      price,
      optional_cost: null,
      unit_id: unitVal,
      enable_quantity: enableQty,
      default_quantity: enableQty ? defaultQty : null,
    };

    try {
      if (currentMode === "create") {
        const localId =
          addonModalMode === "edit" && editingAddonId
            ? editingAddonId
            : createLocalAddonId();
        const stagedRecord = normalizeAddon({
          ...basePayload,
          _staged: true,
          _localId: localId,
        });
        if (addonModalMode === "edit" && editingAddonId) {
          stagedAddons = stagedAddons.map((item) =>
            item._localId === editingAddonId ? stagedRecord : item
          );
        } else {
          stagedAddons.push(stagedRecord);
        }
        window.__stagedAddons = stagedAddons;
        renderAddonList();
        addonModal?.hide();
        return;
      }

      if (addonModalMode === "edit" && editingAddonStaged && editingAddonId) {
        const stagedRecord = normalizeAddon({
          ...basePayload,
          _staged: true,
          _localId: editingAddonId,
        });
        stagedAddons = stagedAddons.map((item) =>
          item._localId === editingAddonId ? stagedRecord : item
        );
        window.__stagedAddons = stagedAddons;
        renderAddonList();
        addonModal?.hide();
        return;
      }

      if (!editMenuId) {
        throw new Error("Menu ID missing. Save the menu first.");
      }

      const isEditExisting = addonModalMode === "edit" && editingAddonId;
      const endpoint = isEditExisting
        ? {
            url: `/settings/menus/addons/${editingAddonId}`,
            method: "PATCH",
            body: basePayload,
          }
        : {
            url: "/settings/menus/addons",
            method: "POST",
            body: { ...basePayload, menu_id: Number(editMenuId) },
          };

      const res = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(endpoint.body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        throw new Error(payload.error || "Failed to save add-on.");
      }
      const record = normalizeAddon(payload.data);
      if (isEditExisting) {
        linkedAddons = linkedAddons.map((item) =>
          String(item.id) === String(record.id) ? record : item
        );
      } else {
        linkedAddons.push(record);
      }
      renderAddonList();
      addonModalMode = "create";
      editingAddonId = null;
      editingAddonStaged = false;
      addonModal?.hide();
    } catch (err) {
      console.error("❌ Add-on save error:", err);
      alert(err.message || "Failed to save add-on.");
    } finally {
      addonFormInFlight = false;
      submitBtn?.removeAttribute("disabled");
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
      const cost = row.option_cost != null ? Number(row.option_cost).toFixed(2) : null;
      const unit = row.unit_name || null;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
      el.dataset.choiceId = row.choice_id;
      el.innerHTML = `
        <span>
          <strong>${row.choice_name}</strong>
          ${row.option_name ? `<span class="text-muted ms-2">(${row.option_name})</span>` : ""}
           ${price ? `<span class="badge text-bg-light ms-2">Price ${price}</span>` : ""}
           ${cost ? `<span class="badge text-bg-secondary ms-1">Cost ${cost}</span>` : ""}
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
        const normalized = normalizeLinkedChoice(linkPayload.data || {});
        linkedChoices.push(normalized);
        renderChoiceList();
        rowBtn.remove(); // prevent linking same again
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
  choiceList?.addEventListener("click", async (event) => {
    const row = event.target.closest("li");
    if (!row) return;
    const choiceId = row.dataset.id;
    const isStaged = row.dataset.staged === "true";
    const localId = row.dataset.localId || choiceId;

    if (event.target.closest(".edit-choice")) {
      if (isStaged) {
        const stagedRecord = stagedChoices.find(
          (item) => item._localId === localId
        );
        if (!stagedRecord) return;
        choiceModalMode = "edit-staged";
        editingChoiceId = choiceId;
        editingChoiceIsStaged = true;
        editingChoiceLocalId = localId;
        editingChoiceOptionId = null;
        editingChoiceDescription = stagedRecord.description || "";
        if (choiceNameInput) choiceNameInput.value = stagedRecord.name || "";
        if (optionNameInput)
          optionNameInput.value =
            stagedRecord.option_name || stagedRecord.name || "";
        if (optionPriceInput)
          optionPriceInput.value =
            stagedRecord.price != null ? Number(stagedRecord.price).toFixed(2) : "";
        if (optionCostInput)
          optionCostInput.value =
            stagedRecord.cost != null ? Number(stagedRecord.cost).toFixed(2) : "";
        if (optionUnitSelect)
          optionUnitSelect.value =
            stagedRecord.unit_id != null ? String(stagedRecord.unit_id) : "";
        createChoiceModal?.show();
        setTimeout(() => choiceNameInput?.focus(), 150);
        return;
      }

      if (!choiceId) return;
      try {
        const res = await fetch(`/settings/menus/choices/api/${choiceId}`);
        const payload = await res.json();
        if (!payload.success) {
          throw new Error(payload.error || "Failed to load choice.");
        }
        const choice = payload.data || {};
        const primary =
          choice.options && choice.options.length ? choice.options[0] : {};
        choiceModalMode = "edit-existing";
        editingChoiceId = Number(choiceId);
        editingChoiceIsStaged = false;
        editingChoiceLocalId = null;
        editingChoiceOptionId = primary?.id ?? null;
        editingChoiceDescription = choice.description || "";
        if (choiceNameInput) choiceNameInput.value = choice.name || "";
        if (optionNameInput)
          optionNameInput.value =
            primary?.name || choice.name || "";
        if (optionPriceInput)
          optionPriceInput.value =
            primary?.price != null ? Number(primary.price).toFixed(2) : "";
        if (optionCostInput)
          optionCostInput.value =
            primary?.cost != null ? Number(primary.cost).toFixed(2) : "";
        if (optionUnitSelect)
          optionUnitSelect.value =
            primary?.unit_id != null ? String(primary.unit_id) : "";
        createChoiceModal?.show();
        setTimeout(() => choiceNameInput?.focus(), 150);
      } catch (err) {
        console.error("❌ Error loading choice for edit:", err);
        alert(err.message || "Failed to load choice.");
      }
      return;
    }

    if (!event.target.closest(".remove-choice")) return;

    if (isStaged) {
      linkedChoices = linkedChoices.filter(
        (item) => item._localId !== localId
      );
      stagedChoices = stagedChoices.filter(
        (item) => item._localId !== localId
      );
      window.__stagedChoices = stagedChoices;
      renderChoiceList();
      return;
    }

    if (!editMenuId) {
      alert("Save the menu first, then remove linked choices.");
      return;
    }

    try {
      const res = await fetch(`/menus/builder/menus/${editMenuId}/choices/${choiceId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        linkedChoices = linkedChoices.filter(
          (item) => String(item.id) !== String(choiceId)
        );
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
    const raw = Object.fromEntries(formData.entries());
    const payload = {
      category_id: raw.category_id ? Number(raw.category_id) : null,
      name: (raw.name || "").trim(),
      description: (raw.description || "").trim() || null,
      price:
        raw.price !== undefined && raw.price !== null && raw.price !== ""
          ? Number(raw.price)
          : null,
    };

    if (
      !Number.isInteger(payload.category_id) ||
      payload.category_id <= 0 ||
      !payload.name
    ) {
      alert("Please provide a menu name and select a sales category.");
      return;
    }
    if (payload.price !== null && !Number.isFinite(payload.price)) {
      alert("Menu price must be a valid number.");
      return;
    }

    try {
      if (currentMode === "edit" && editMenuId) {
        const updateRes = await fetch(`/settings/menus/menu/${editMenuId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const updatePayload = await updateRes.json().catch(() => ({}));
        if (!updateRes.ok || updatePayload.success === false) {
          throw new Error(
            updatePayload.error || "Failed to update menu details."
          );
        }
        alert("Menu updated.");
        location.reload();
        return;
      }

      const createRes = await fetch(`/settings/menus/menu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const created = await createRes.json().catch(() => null);
      const newMenuId = created?.data?.id;

      if (!createRes.ok || !newMenuId) {
        throw new Error(
          (created && created.error) ||
            "Failed to create menu (ensure /settings/menus/menu returns id)."
        );
      }

      for (const choice of stagedChoices) {
        const choicePayload = {
          name: choice.name,
          option_name: choice.option_name || choice.name,
          price:
            choice.price !== undefined && choice.price !== null
              ? Number(choice.price)
              : null,
          cost:
            choice.cost !== undefined && choice.cost !== null
              ? Number(choice.cost)
              : null,
          unit_id:
            choice.unit_id !== undefined && choice.unit_id !== null
              ? Number(choice.unit_id)
              : null,
        };
        try {
          await fetch(`/menus/builder/menus/${newMenuId}/choices`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(choicePayload),
          });
        } catch (err) {
          console.error(
            "⚠️ Failed to attach staged choice:",
            choice.name,
            err
          );
        }
      }

      for (const addon of stagedAddons) {
        const normalizedDefault =
          addon.default_quantity !== undefined &&
          addon.default_quantity !== null &&
          addon.default_quantity !== ""
            ? Number(addon.default_quantity)
            : null;
        const addonPayload = {
          menu_id: newMenuId,
          name: addon.name,
          price:
            addon.price !== undefined && addon.price !== null && addon.price !== ""
              ? Number(addon.price)
              : null,
          optional_cost:
            addon.optional_cost !== undefined &&
            addon.optional_cost !== null &&
            addon.optional_cost !== ""
              ? Number(addon.optional_cost)
              : null,
          unit_id:
            addon.unit_id !== undefined && addon.unit_id !== null && addon.unit_id !== ""
              ? Number(addon.unit_id)
              : null,
          enable_quantity: Boolean(addon.enable_quantity),
          default_quantity: addon.enable_quantity
            ? Number.isFinite(normalizedDefault) && normalizedDefault > 0
              ? normalizedDefault
              : 1
            : null,
        };
        try {
          await fetch(`/settings/menus/addons`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(addonPayload),
          });
        } catch (err) {
          console.error("⚠️ Failed to attach staged add-on:", addon.name, err);
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
