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
  const categoryChoiceSection = document.getElementById("categoryChoiceSection");
  const categoryChoiceLabel = document.getElementById("categoryChoiceLabel");
  const categoryChoiceList = document.getElementById("categoryChoiceList");
  const categoryChoiceRefreshBtn = document.getElementById("categoryChoiceRefresh");
  const categoryChoiceSelectAll = document.getElementById("categoryChoiceSelectAll");
  const categoryChoiceClearBtn = document.getElementById("categoryChoiceClear");
  const categoryChoiceStatus = document.getElementById("categoryChoiceStatus");
  const categoryBulkLinkBtn = document.getElementById("categoryBulkLinkBtn");
  const bulkChoiceTextarea = document.getElementById("bulkChoiceTextarea");
  const bulkChoiceAddBtn = document.getElementById("bulkChoiceAddBtn");
  const bulkChoiceClearBtn = document.getElementById("bulkChoiceClearBtn");
  const bulkChoiceStatus = document.getElementById("bulkChoiceStatus");

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
  const menuCategories =
    (window.menuBuilderData && window.menuBuilderData.categories) || [];

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
  let editingChoiceLocalId = null;
  let editingChoiceOptionId = null;
  let editingChoiceDescription = "";
  let linkedAddons = [];
  let stagedAddons = window.__stagedAddons || [];
  window.__stagedAddons = stagedAddons;
  let addonModalMode = "create";
  let editingAddonId = null;
  let editingAddonStaged = false;
  let currentMenuCategoryId = null;
  let currentMenuCategoryName = "";
  let categoryChoiceRows = [];
  const categoryChoiceSelection = new Set();
  let categoryChoicesLoading = false;
  let bulkChoiceInFlight = false;

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
  const formCategoryField = form?.querySelector('[name="category_id"]');
  formCategoryField?.addEventListener("change", (event) => {
    setCurrentMenuCategory(event.target.value || null);
  });

  function getCategoryNameById(categoryId) {
    if (!Number.isFinite(categoryId)) return "";
    const match = menuCategories.find(
      (cat) => Number(cat.id) === Number(categoryId)
    );
    return match ? match.name : "";
  }

  function setCurrentMenuCategory(categoryId) {
    if (categoryId === undefined || categoryId === null || categoryId === "") {
      currentMenuCategoryId = null;
      currentMenuCategoryName = "";
    } else {
      const numeric = Number(categoryId);
      if (Number.isFinite(numeric) && numeric > 0) {
        currentMenuCategoryId = numeric;
        currentMenuCategoryName = getCategoryNameById(numeric) || "";
      } else {
        currentMenuCategoryId = null;
        currentMenuCategoryName = "";
      }
    }
    updateCategoryChoiceLabel();
  }

  function updateCategoryChoiceLabel() {
    if (!categoryChoiceLabel) return;
    if (!editMenuId) {
      categoryChoiceLabel.textContent = "this menu";
      return;
    }
    categoryChoiceLabel.textContent =
      currentMenuCategoryName || "this category";
  }

  function setCategoryChoiceStatus(message = "", tone = "muted") {
    if (!categoryChoiceStatus) return;
    const baseClass = "small mt-2";
    categoryChoiceStatus.className = `${baseClass} text-${tone}`;
    categoryChoiceStatus.textContent = message;
  }

  function setBulkChoiceAvailability(enabled) {
    const disabled = !enabled;
    if (bulkChoiceTextarea) {
      bulkChoiceTextarea.disabled = disabled;
      if (disabled) bulkChoiceTextarea.value = "";
    }
    if (bulkChoiceAddBtn) bulkChoiceAddBtn.disabled = disabled;
    if (bulkChoiceClearBtn) bulkChoiceClearBtn.disabled = disabled;
    setBulkChoiceStatus(
      disabled ? "Save the menu before bulk adding choices." : "",
      "muted"
    );
  }

  function setBulkChoiceStatus(message = "", tone = "muted") {
    if (!bulkChoiceStatus) return;
    const base = "small mt-2";
    const toneClass = tone ? `text-${tone}` : "text-muted";
    bulkChoiceStatus.className = `${base} ${toneClass}`;
    bulkChoiceStatus.textContent = message;
  }

  function resetCategoryChoiceState() {
    categoryChoiceRows = [];
    categoryChoiceSelection.clear();
    renderCategoryChoiceList("Load category choices to start.");
    setCategoryChoiceStatus("");
    if (categoryBulkLinkBtn) categoryBulkLinkBtn.disabled = true;
    updateCategoryChoiceSelectAllState();
  }

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
      setCurrentMenuCategory(value);
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
    resetCategoryChoiceState();
  }

  function openMenuForCreate({ categoryId = null } = {}) {
    currentMode = "create";
    editMenuId = null;
    form?.reset();
    resetStagedData();
    if (categoryId != null) {
      const categoryField = form?.querySelector('[name="category_id"]');
      if (categoryField) categoryField.value = String(categoryId);
      setCurrentMenuCategory(categoryId);
    } else {
      setCurrentMenuCategory(null);
    }
    setBulkChoiceAvailability(false);
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
    setCurrentMenuCategory(menu.category_id ?? null);
    resetCategoryChoiceState();
    setBulkChoiceAvailability(true);
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

  function renderCategoryChoiceList(messageOverride = null) {
    if (!categoryChoiceList) return;
    categoryChoiceList.innerHTML = "";

    if (!editMenuId) {
      categoryChoiceList.innerHTML =
        '<div class="list-group-item text-muted fst-italic">Save the menu before linking multiple choices.</div>';
      if (categoryBulkLinkBtn) categoryBulkLinkBtn.disabled = true;
      updateCategoryChoiceSelectAllState();
      return;
    }

    if (messageOverride) {
      categoryChoiceList.innerHTML = `<div class="list-group-item text-muted fst-italic">${messageOverride}</div>`;
      if (categoryBulkLinkBtn) categoryBulkLinkBtn.disabled = true;
      updateCategoryChoiceSelectAllState();
      return;
    }

    if (!categoryChoiceRows.length) {
      categoryChoiceList.innerHTML =
        '<div class="list-group-item text-muted fst-italic">No additional choices available for this category.</div>';
      if (categoryBulkLinkBtn) categoryBulkLinkBtn.disabled = true;
      updateCategoryChoiceSelectAllState();
      return;
    }

    categoryChoiceRows.forEach((row) => {
      const wrapper = document.createElement("label");
      wrapper.className =
        "list-group-item list-group-item-action d-flex align-items-center gap-3";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "form-check-input flex-shrink-0 category-choice-checkbox";
      checkbox.value = row.choice_id;
      checkbox.checked = categoryChoiceSelection.has(row.choice_id);
      checkbox.dataset.choiceId = row.choice_id;
      wrapper.appendChild(checkbox);

      const body = document.createElement("div");
      body.className = "flex-grow-1";
      const title = document.createElement("div");
      title.className = "fw-semibold";
      title.textContent = row.choice_name || `Choice #${row.choice_id || ""}`;
      body.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "text-muted small";
      const bits = [];
      if (row.option_price != null) {
        bits.push(`Price $${Number(row.option_price).toFixed(2)}`);
      }
      if (row.option_cost != null) {
        bits.push(`Cost $${Number(row.option_cost).toFixed(2)}`);
      }
      if (row.option_cogs_percent != null) {
        bits.push(`COGS ${Number(row.option_cogs_percent).toFixed(1)}%`);
      }
      if (row.unit_name) {
        bits.push(row.unit_name);
      }
      meta.textContent = bits.length ? bits.join(" • ") : "No pricing yet.";
      body.appendChild(meta);
      wrapper.appendChild(body);
      categoryChoiceList.appendChild(wrapper);
    });

    updateCategoryChoiceSelectAllState();
    if (categoryBulkLinkBtn) {
      categoryBulkLinkBtn.disabled = categoryChoiceSelection.size === 0;
    }
  }

  function updateCategoryChoiceSelectAllState() {
    if (!categoryChoiceSelectAll) return;
    const total = categoryChoiceRows.length;
    const selected = categoryChoiceSelection.size;
    categoryChoiceSelectAll.indeterminate = false;

    if (!total) {
      categoryChoiceSelectAll.checked = false;
      categoryChoiceSelectAll.disabled = true;
      return;
    }

    categoryChoiceSelectAll.disabled = false;
    categoryChoiceSelectAll.checked = selected === total;
    categoryChoiceSelectAll.indeterminate =
      selected > 0 && selected < total;
  }

  async function loadCategoryChoices(forceReload = false) {
    if (!categoryChoiceList || !editMenuId) {
      renderCategoryChoiceList("Save the menu before linking choices.");
      return;
    }
    if (categoryChoicesLoading && !forceReload) return;
    categoryChoicesLoading = true;
    categoryChoiceSelection.clear();
    renderCategoryChoiceList("Loading choices...");
    setCategoryChoiceStatus("");
    if (categoryBulkLinkBtn) categoryBulkLinkBtn.disabled = true;
    try {
      const res = await fetch(
        `/menus/builder/choices/unlinked?menu_id=${editMenuId}`
      );
      const payload = await res.json();
      if (!payload.success) {
        throw new Error(payload.error || "Failed to load choices.");
      }
      categoryChoiceRows = Array.isArray(payload.data) ? payload.data : [];
      if (!categoryChoiceRows.length) {
        renderCategoryChoiceList(
          "No additional choices available for this category."
        );
        setCategoryChoiceStatus(
          "All available choices are already linked to this menu.",
          "muted"
        );
      } else {
        renderCategoryChoiceList();
        setCategoryChoiceStatus(
          `Showing ${categoryChoiceRows.length} unlinked choice${
            categoryChoiceRows.length === 1 ? "" : "s"
          }.`,
          "muted"
        );
      }
    } catch (err) {
      console.error("loadCategoryChoices error:", err);
      renderCategoryChoiceList("Failed to load choices.");
      setCategoryChoiceStatus(
        err.message || "Error loading choices.",
        "danger"
      );
    } finally {
      categoryChoicesLoading = false;
      updateCategoryChoiceSelectAllState();
    }
  }

  function normalizeBulkChoiceLine(line) {
    if (!line) return [];
    let parts = line.split(/\t|\|/).map((part) => part.trim());
    if (parts.length <= 1) {
      parts = line.split(/,/).map((part) => part.trim());
    }
    if (parts.length <= 1) {
      parts = line.split(/\s{2,}/).map((part) => part.trim());
    }
    while (parts.length < 6) {
      parts.push("");
    }
    return parts.slice(0, 6);
  }

  function parseCurrencyValue(value) {
    if (!value) return null;
    const cleaned = value.replace(/[^\d.-]/g, "");
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  function resolveBulkUnitId(token) {
    if (!token) return null;
    const normalized = token.trim().toLowerCase();
    if (!normalized) return null;
    if (["pp", "p/p", "per person", "per-person", "per attendee"].includes(normalized)) {
      return findPerPersonUnitId();
    }
    let match = null;
    unitLookup.forEach((unit) => {
      if (
        String(unit.id) === normalized ||
        (unit.name && unit.name.toLowerCase() === normalized) ||
        (unit.type && unit.type.toLowerCase() === normalized)
      ) {
        match = Number(unit.id);
      }
    });
    return match;
  }

  function findPerPersonUnitId() {
    let match = null;
    unitLookup.forEach((unit) => {
      const type = (unit.type || "").toLowerCase();
      const name = (unit.name || "").toLowerCase();
      if (type.includes("per") || name.includes("pp")) {
        match = Number(unit.id);
      }
    });
    return match;
  }

  function resolveCategoryIdByToken(token) {
    if (!token) return null;
    const normalized = token.trim().toLowerCase();
    if (!normalized) return null;
    const numeric = Number(normalized);
    if (Number.isInteger(numeric) && numeric > 0) {
      const exists = menuCategories.some(
        (cat) => Number(cat.id) === Number(numeric)
      );
      if (exists) return numeric;
    }
    const match = menuCategories.find(
      (cat) => cat.name && cat.name.toLowerCase() === normalized
    );
    return match ? Number(match.id) : null;
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
    editingChoiceLocalId = null;
    editingChoiceOptionId = null;
    editingChoiceDescription = "";
    renderChoiceList();
    renderAddonList();
    setCurrentMenuCategory(null);
    resetCategoryChoiceState();
    setBulkChoiceAvailability(false);
    setBulkChoiceStatus("", "muted");
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
    if (optionNameInput) optionNameInput.value = "";
    optionPriceInput.value = "";
    optionUnitSelect.value = "";
    if (optionCostInput) optionCostInput.value = "";
    choiceModalMode = "create";
    editingChoiceId = null;
    editingChoiceLocalId = null;
    editingChoiceOptionId = null;
    editingChoiceDescription = "";
    createChoiceModal.show();
    setTimeout(() => choiceNameInput?.focus(), 150);
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
    editingChoiceLocalId = null;
    editingChoiceOptionId = null;
    editingChoiceDescription = "";
    if (optionNameInput) optionNameInput.value = "";
    if (optionUnitSelect) optionUnitSelect.value = "";
    if (optionCostInput) optionCostInput.value = "";
    if (optionPriceInput) optionPriceInput.value = "";
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

    const optionLabel =
      optionNameInput && optionNameInput.value.trim()
        ? optionNameInput.value.trim()
        : name;
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
    linkResultsEl.innerHTML = '<div class="list-group-item text-muted fst-italic">Start typing to find choices.</div>';
    linkChoiceModal.show();
    setTimeout(() => linkSearchInput?.focus(), 150);
    updateCategoryChoiceLabel();
    if (!categoryChoiceRows.length) {
      loadCategoryChoices();
    } else {
      renderCategoryChoiceList();
    }
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

  categoryChoiceRefreshBtn?.addEventListener("click", () =>
    loadCategoryChoices(true)
  );

  categoryChoiceClearBtn?.addEventListener("click", () => {
    categoryChoiceSelection.clear();
    renderCategoryChoiceList();
    if (categoryBulkLinkBtn) categoryBulkLinkBtn.disabled = true;
    setCategoryChoiceStatus("Selection cleared.", "muted");
  });

  categoryChoiceSelectAll?.addEventListener("change", (event) => {
    if (!categoryChoiceRows.length) return;
    const shouldSelect = Boolean(event.target.checked);
    categoryChoiceRows.forEach((row) => {
      if (shouldSelect) {
        categoryChoiceSelection.add(row.choice_id);
      } else {
        categoryChoiceSelection.delete(row.choice_id);
      }
    });
    renderCategoryChoiceList();
  });

  categoryChoiceList?.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".category-choice-checkbox");
    if (!checkbox) return;
    const choiceId = Number(checkbox.dataset.choiceId || checkbox.value);
    if (!Number.isInteger(choiceId) || choiceId <= 0) return;
    if (checkbox.checked) {
      categoryChoiceSelection.add(choiceId);
    } else {
      categoryChoiceSelection.delete(choiceId);
    }
    if (categoryBulkLinkBtn) {
      categoryBulkLinkBtn.disabled = categoryChoiceSelection.size === 0;
    }
    updateCategoryChoiceSelectAllState();
  });

  categoryBulkLinkBtn?.addEventListener("click", async () => {
    if (!editMenuId || !categoryChoiceSelection.size) return;
    const choiceIds = Array.from(categoryChoiceSelection);
    categoryBulkLinkBtn.disabled = true;
    setCategoryChoiceStatus("Linking selected choices...", "muted");
    try {
      const res = await fetch(
        `/menus/builder/menus/${editMenuId}/link/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choice_ids: choiceIds }),
        }
      );
      const payload = await res.json();
      if (!payload.success) {
        throw new Error(payload.error || "Failed to link choices.");
      }
      const linked = Array.isArray(payload.data)
        ? payload.data.map((item) => normalizeLinkedChoice(item))
        : [];
      categoryChoiceSelection.clear();
      if (linked.length) {
        linked.forEach((choice) => {
          linkedChoices = linkedChoices.filter(
            (existing) => existing.choice_id !== choice.choice_id
          );
          linkedChoices.push(choice);
        });
        renderChoiceList();
        await reloadLinkedChoices();
        await loadCategoryChoices(true);
        setCategoryChoiceStatus(
          `Linked ${linked.length} choice${
            linked.length === 1 ? "" : "s"
          } to this menu.`,
          "success"
        );
      } else {
        await loadCategoryChoices(true);
        setCategoryChoiceStatus(
          "No new choices were linked (they may already be attached).",
          "warning"
        );
      }
    } catch (err) {
      console.error("? Bulk link error:", err);
      setCategoryChoiceStatus(
        err.message || "Failed to link choices.",
        "danger"
      );
    } finally {
      categoryBulkLinkBtn.disabled = categoryChoiceSelection.size === 0;
    }
  });

  async function handleBulkChoiceImport() {
    if (!editMenuId) {
      alert("Save the menu before bulk adding choices.");
      return;
    }
    if (!bulkChoiceTextarea) return;
    if (bulkChoiceInFlight) return;

    const text = (bulkChoiceTextarea.value || "").trim();
    if (!text) {
      alert("Paste one or more lines to import.");
      bulkChoiceTextarea.focus();
      return;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length);
    if (!lines.length) {
      alert("Nothing to import. Check the format and try again.");
      return;
    }

    bulkChoiceInFlight = true;
    if (bulkChoiceAddBtn) bulkChoiceAddBtn.disabled = true;
    setBulkChoiceStatus("Creating choices...", "muted");

    const createdChoiceIds = [];
    const errors = [];
    let created = 0;
    let failed = 0;

    for (let idx = 0; idx < lines.length; idx += 1) {
      const rawLine = lines[idx];
      const parts = normalizeBulkChoiceLine(rawLine);
      if (!parts.length) continue;
      let [categoryToken, name, description, costText, priceText, unitToken] =
        parts;
      name = (name || "").trim();
      description = (description || "").trim();
      if (!name) {
        failed += 1;
        errors.push(`Line ${idx + 1}: Missing choice name.`);
        continue;
      }
      let categoryId = resolveCategoryIdByToken(categoryToken);
      if (!categoryId && currentMenuCategoryId) {
        categoryId = currentMenuCategoryId;
      }
      if (!categoryId) {
        failed += 1;
        errors.push(
          `Line ${idx + 1}: No category specified and menu category is unset.`
        );
        continue;
      }
      const cost = parseCurrencyValue(costText);
      const price = parseCurrencyValue(priceText);
      let unitId = resolveBulkUnitId(unitToken);
      if (!unitId) {
        const haystack = `${unitToken || ""} ${name} ${description}`.toLowerCase();
        if (haystack.includes("pp") || haystack.includes("per person")) {
          unitId = findPerPersonUnitId();
        }
      }

      const payload = {
        name,
        description: description || null,
        category_id: categoryId,
        options: [
          {
            name,
            price,
            cost,
            unit_id: unitId,
          },
        ],
      };

      try {
        const res = await fetch("/settings/menus/choices/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success || !data.data?.id) {
          throw new Error(data.error || "Failed to create choice.");
        }
        createdChoiceIds.push(data.data.id);
        created += 1;
      } catch (err) {
        failed += 1;
        errors.push(
          `Line ${idx + 1}: ${err.message || "Failed to create choice."}`
        );
      }
    }

    let linked = 0;
    if (createdChoiceIds.length) {
      try {
        const res = await fetch(
          `/menus/builder/menus/${editMenuId}/link/bulk`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ choice_ids: createdChoiceIds }),
          }
        );
        const payload = await res.json();
        if (!payload.success) {
          throw new Error(payload.error || "Failed to link choices.");
        }
        linked = Array.isArray(payload.data) ? payload.data.length : 0;
        await reloadLinkedChoices();
        await loadCategoryChoices(true);
      } catch (err) {
        errors.push(err.message || "Failed to link new choices.");
      }
    }

    if (createdChoiceIds.length && bulkChoiceTextarea) {
      bulkChoiceTextarea.value = "";
    }

    const summary = [];
    if (created) summary.push(`${created} created`);
    if (linked) summary.push(`${linked} linked`);
    if (failed) summary.push(`${failed} failed`);
    const tone = failed ? "warning" : created ? "success" : "muted";
    setBulkChoiceStatus(summary.join(" • ") || "No rows processed.", tone);
    if (errors.length) {
      console.warn("Bulk choice import issues:", errors);
    }

    bulkChoiceInFlight = false;
    if (bulkChoiceAddBtn) bulkChoiceAddBtn.disabled = false;
  }

  bulkChoiceClearBtn?.addEventListener("click", () => {
    if (bulkChoiceTextarea) bulkChoiceTextarea.value = "";
    setBulkChoiceStatus("Cleared.", "muted");
  });

  bulkChoiceAddBtn?.addEventListener("click", handleBulkChoiceImport);

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
