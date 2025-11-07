document.addEventListener('DOMContentLoaded', () => {
  const data = window.menuChoiceData || {};

  const choicesContainer = document.getElementById('choicesContainer');
  const filterSelect = document.getElementById('choiceCategoryFilter');
  const createChoiceForm = document.getElementById('createChoiceForm');
  const createChoiceName = document.getElementById('createChoiceName');
  const createOptionName = document.getElementById('createChoiceOptionName');
  const createOptionPrice = document.getElementById('createChoiceOptionPrice');
  const createOptionCost = document.getElementById('createChoiceOptionCost');
  const createOptionUnit = document.getElementById('createChoiceOptionUnit');
  const createDescription = document.getElementById('createChoiceDescription');

  if (!choicesContainer) {
    console.warn('menu-choices.js: #choicesContainer missing');
    return;
  }

  let categories = Array.isArray(data.categories) ? data.categories : [];
  let units = Array.isArray(data.units) ? data.units : [];
  let choices = Array.isArray(data.choices)
    ? data.choices.map(normalizeChoice)
    : [];

  let unitLookup = buildUnitLookup();

  function buildUnitLookup() {
    const map = new Map();
    units.forEach((u) => {
      map.set(String(u.id), u);
    });
    return map;
  }

  function normalizeChoice(choice = {}) {
    const parseArray = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch (err) {
          console.warn('menu-choices.js: failed to parse array', err);
          return [];
        }
      }
      return [];
    };

    return {
      id: choice.id,
      name: choice.name || '',
      description: choice.description || '',
      options: parseArray(choice.options),
      categories: parseArray(choice.categories),
      menus: parseArray(choice.menus),
    };
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildUnitOptions(selectedId = null) {
    const opts = ['<option value="">No unit</option>'];
    units.forEach((u) => {
      const sel =
        selectedId !== null && String(u.id) === String(selectedId)
          ? ' selected'
          : '';
      const label = `${escapeHtml(u.name)}${
        u.type ? ` (${escapeHtml(u.type)})` : ''
      }`;
      opts.push(`<option value="${escapeHtml(u.id)}"${sel}>${label}</option>`);
    });
    return opts.join('');
  }

  function updateCategorySelect() {
    if (!filterSelect) return;
    const current = filterSelect.value || 'all';
    const options = [
      '<option value="all">All categories</option>',
      '<option value="unassigned">Unassigned</option>',
      ...categories.map(
        (cat) =>
          `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</option>`
      ),
    ];
    filterSelect.innerHTML = options.join('');
    if (
      current === 'all' ||
      current === 'unassigned' ||
      categories.some((cat) => String(cat.id) === current)
    ) {
      filterSelect.value = current;
    }
  }

  function renderChoices() {
    choicesContainer.innerHTML = '';
    const filterValue = filterSelect ? filterSelect.value : 'all';

    const groups = new Map();

    choices.forEach((choice) => {
      const catList =
        choice.categories && choice.categories.length
          ? choice.categories
          : [{ id: null, name: 'Unassigned' }];

      const matchesFilter =
        filterValue === 'all' ||
        (filterValue === 'unassigned' &&
          catList.every((cat) => cat.id === null || cat.id === undefined)) ||
        catList.some((cat) => String(cat.id) === filterValue);

      if (!matchesFilter) return;

      const displayCategories =
        filterValue === 'all'
          ? catList
          : filterValue === 'unassigned'
          ? [{ id: null, name: 'Unassigned' }]
          : catList.filter((cat) => String(cat.id) === filterValue);

      const targetCategories =
        displayCategories.length > 0
          ? displayCategories
          : [{ id: null, name: 'Unassigned' }];

      targetCategories.forEach((cat) => {
        const key = cat && cat.id != null ? String(cat.id) : 'unassigned';
        const label = cat && cat.name ? cat.name : 'Unassigned';
        if (!groups.has(key)) {
          groups.set(key, {
            id: cat?.id ?? null,
            name: label,
            choices: [],
            ids: new Set(),
          });
        }
        const group = groups.get(key);
        if (!group.ids.has(choice.id)) {
          group.ids.add(choice.id);
          group.choices.push(choice);
        }
      });
    });

    if (!groups.size) {
      const emptyState = document.createElement('div');
      emptyState.className = 'alert alert-secondary mb-0';
      emptyState.textContent =
        filterValue === 'all'
          ? 'No menu choices found.'
          : 'No menu choices match the selected category.';
      choicesContainer.appendChild(emptyState);
      return;
    }

    const orderedGroups = Array.from(groups.values()).sort((a, b) => {
      if (a.name === 'Unassigned') return 1;
      if (b.name === 'Unassigned') return -1;
      return a.name.localeCompare(b.name);
    });

    orderedGroups.forEach((group) => {
      const section = document.createElement('section');
      section.className = 'category-block';
      const header = document.createElement('div');
      header.className =
        'd-flex justify-content-between align-items-center mb-2';
      header.innerHTML = `
        <h5 class="mb-0">${escapeHtml(group.name)}</h5>
        <span class="badge bg-light text-dark">${group.choices.length}</span>
      `;
      section.appendChild(header);

      const stack = document.createElement('div');
      stack.className = 'vstack gap-3';
      group.choices
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((choice) => {
          stack.appendChild(createChoiceCard(choice));
        });

      section.appendChild(stack);
      choicesContainer.appendChild(section);
    });
  }

  function createChoiceCard(choice) {
    const hasOptions = choice.options && choice.options.length;
    const primary = hasOptions ? choice.options[0] : {};
    const row = document.createElement('div');
    row.className = 'choice-row';
    row.dataset.choiceId = choice.id;

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'choice-row-header';
    header.innerHTML = `
      <div class="d-flex flex-column align-items-start">
        <span>${escapeHtml(choice.name || '')}</span>
        <span class="text-muted small">
          ${choice.menus && choice.menus.length ? `${choice.menus.length} menu${choice.menus.length === 1 ? '' : 's'}` : 'Not linked'}
        </span>
      </div>
      <span class="d-flex align-items-center gap-2">
        ${primary && primary.price != null ? `<span class="choice-pill">$${Number(primary.price).toFixed(2)}</span>` : ''}
        <span class="chevron bi bi-chevron-right"></span>
      </span>
    `;
    row.appendChild(header);

    const body = document.createElement('div');
    body.className = 'choice-row-body';

    const metadata = document.createElement('div');
    metadata.className = 'choice-metadata';
    const catList =
      choice.categories && choice.categories.length
        ? choice.categories
        : [{ id: null, name: 'Unassigned' }];
    catList.forEach((cat) => {
      const pill = document.createElement('span');
      pill.className = 'choice-pill';
      pill.textContent = cat?.name || 'Unassigned';
      metadata.appendChild(pill);
    });
    if (choice.menus && choice.menus.length) {
      choice.menus.slice(0, 3).forEach((menu) => {
        const pill = document.createElement('span');
        pill.className = 'choice-pill';
        pill.textContent = menu.name || `Menu #${menu.id}`;
        metadata.appendChild(pill);
      });
      if (choice.menus.length > 3) {
        const pill = document.createElement('span');
        pill.className = 'choice-pill';
        pill.textContent = `+${choice.menus.length - 3}`;
        metadata.appendChild(pill);
      }
    }
    body.appendChild(metadata);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'form-control form-control-sm choice-name mb-2';
    nameInput.value = choice.name || '';
    body.appendChild(nameInput);

    const priceRow = document.createElement('div');
    priceRow.className = 'row g-2';

    const priceCol = document.createElement('div');
    priceCol.className = 'col-6 col-md-4';
    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.step = '0.01';
    priceInput.className = 'form-control form-control-sm choice-price';
    priceInput.placeholder = 'Price';
    priceInput.value =
      primary && primary.price != null ? Number(primary.price).toFixed(2) : '';
    priceCol.appendChild(priceInput);
    priceRow.appendChild(priceCol);

    const costCol = document.createElement('div');
    costCol.className = 'col-6 col-md-4';
    const costInput = document.createElement('input');
    costInput.type = 'number';
    costInput.step = '0.01';
    costInput.className = 'form-control form-control-sm choice-cost';
    costInput.placeholder = 'Cost';
    costInput.value =
      primary && primary.cost != null ? Number(primary.cost).toFixed(2) : '';
    costCol.appendChild(costInput);
    priceRow.appendChild(costCol);

    const unitCol = document.createElement('div');
    unitCol.className = 'col-12 col-md-4';
    const unitSelect = document.createElement('select');
    unitSelect.className = 'form-select form-select-sm choice-unit';
    const unitId =
      primary && primary.unit_id != null ? primary.unit_id : null;
    unitSelect.innerHTML = buildUnitOptions(unitId);
    unitCol.appendChild(unitSelect);
    priceRow.appendChild(unitCol);

    body.appendChild(priceRow);

    const descInput = document.createElement('textarea');
    descInput.className = 'form-control form-control-sm choice-description mt-2';
    descInput.rows = 2;
    descInput.placeholder = 'Optional description...';
    descInput.value = choice.description || '';
    body.appendChild(descInput);

    const actions = document.createElement('div');
    actions.className = 'choice-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-sm btn-outline-primary choice-save';
    saveBtn.textContent = 'Save';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-sm btn-outline-danger choice-delete';
    deleteBtn.textContent = 'Delete';
    actions.appendChild(saveBtn);
    actions.appendChild(deleteBtn);
    body.appendChild(actions);

    row.appendChild(body);

    header.addEventListener('click', () => {
      row.classList.toggle('open');
    });

    saveBtn.addEventListener('click', async () => {
      await handleChoiceSave(choice.id, row, {
        nameInput,
        priceInput,
        unitSelect,
        costInput,
        descInput,
        saveButton: saveBtn,
        deleteButton: deleteBtn,
      });
    });

    deleteBtn.addEventListener('click', async () => {
      await handleChoiceDelete(choice.id);
    });

    return row;
  }

  async function handleChoiceSave(choiceId, card, refs) {
    const { nameInput, priceInput, costInput, unitSelect, descInput, saveButton, deleteButton } = refs;
    const name = nameInput.value.trim();
    if (!name) {
      alert('Please provide a choice name.');
      nameInput.focus();
      return;
    }

    const price =
      priceInput.value === '' ? null : Number(priceInput.value);
    if (priceInput.value !== '' && !Number.isFinite(price)) {
      alert('Price must be a valid number.');
      priceInput.focus();
      return;
    }
    const cost =
      costInput.value === '' ? null : Number(costInput.value);
    if (costInput.value !== '' && !Number.isFinite(cost)) {
      alert('Cost must be a valid number.');
      costInput.focus();
      return;
    }
    const unitId =
      unitSelect.value !== '' ? Number(unitSelect.value) : null;
    const description =
      (descInput.classList.contains('d-none') ? '' : descInput.value || '').trim();

    saveButton.disabled = true;
    deleteButton.disabled = true;

    try {
      const res = await fetch(`/settings/menus/choices/api/${choiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to update choice.');
      }

      const choiceRecord = choices.find((c) => c.id === choiceId);
      const primaryOption =
        choiceRecord && choiceRecord.options && choiceRecord.options.length
          ? choiceRecord.options[0]
          : null;
      const optionPayload = {
        name: primaryOption?.name || name,
        price,
        cost,
        unit_id: unitId,
      };

      if (primaryOption && primaryOption.id) {
        const optionRes = await fetch(
          `/settings/menus/choices/api/${choiceId}/options/${primaryOption.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(optionPayload),
          }
        );
        const optionData = await optionRes.json();
        if (!optionData.success) {
          throw new Error(optionData.error || 'Failed to update price/unit.');
        }
      } else if (price !== null || cost !== null || unitId !== null) {
        const optionRes = await fetch(
          `/settings/menus/choices/api/${choiceId}/options`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(optionPayload),
          }
        );
        const optionData = await optionRes.json();
        if (!optionData.success) {
          throw new Error(optionData.error || 'Failed to update price/unit.');
        }
      }

      if (choiceRecord) {
        choiceRecord.name = name;
        choiceRecord.description = description;
        if (choiceRecord.options && choiceRecord.options.length) {
          choiceRecord.options[0].price = price;
          choiceRecord.options[0].cost = cost;
          choiceRecord.options[0].unit_id = unitId;
          choiceRecord.options[0].unit_name = unitId
            ? unitLookup.get(String(unitId))?.name || null
            : null;
        }
      }

      await refreshChoices();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to save choice.');
    } finally {
      saveButton.disabled = false;
      deleteButton.disabled = false;
    }
  }

  async function handleChoiceDelete(choiceId) {
    if (!confirm('Delete this choice and all of its options?')) return;
    try {
      const res = await fetch(`/settings/menus/choices/api/${choiceId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to delete choice.');
      }
      await refreshChoices();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to delete choice.');
    }
  }

  async function refreshChoices() {
    try {
      const res = await fetch('/settings/menus/choices/api');
      const payload = await res.json();
      if (!payload.success) {
        throw new Error(payload.error || 'Failed to reload choices.');
      }
      const result = payload.data;
      let freshChoices = [];
      if (Array.isArray(result)) {
        freshChoices = result;
      } else if (result) {
        freshChoices = result.choices || [];
        if (result.categories) {
          categories = result.categories;
        }
        if (result.units) {
          units = result.units;
          unitLookup = buildUnitLookup();
        }
      }
      choices = freshChoices.map(normalizeChoice);
      updateCategorySelect();
      renderChoices();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to refresh menu choices.');
    }
  }

  filterSelect?.addEventListener('change', renderChoices);

  createChoiceName?.addEventListener('input', () => {
    if (!createOptionName.value) {
      createOptionName.value = createChoiceName.value;
    }
  });

  createChoiceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = (createChoiceName?.value || '').trim();
    if (!name) {
      alert('Please provide a choice name.');
      return;
    }
    const optionLabel = (createOptionName?.value || '').trim() || name;
    const price =
      createOptionPrice?.value === '' || createOptionPrice?.value == null
        ? null
        : Number(createOptionPrice.value);
    if (createOptionPrice?.value && !Number.isFinite(price)) {
      alert('Price must be a valid number.');
      createOptionPrice.focus();
      return;
    }
    const cost =
      createOptionCost?.value === '' || createOptionCost?.value == null
        ? null
        : Number(createOptionCost.value);
    if (createOptionCost?.value && !Number.isFinite(cost)) {
      alert('Cost must be a valid number.');
      createOptionCost.focus();
      return;
    }
    const unitId = createOptionUnit?.value
      ? Number(createOptionUnit.value)
      : null;
    const description =
      (createDescription?.value || '').trim() || null;

    const payload = {
      name,
      description,
      options: [
          {
            name: optionLabel,
            price,
            cost,
            unit_id: unitId,
          },
      ],
    };

    const submitBtn = createChoiceForm.querySelector(
      'button[type="submit"]'
    );
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/settings/menus/choices/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const dataResp = await res.json();
      if (!dataResp.success) {
        throw new Error(dataResp.error || 'Failed to create choice.');
      }
      createChoiceForm.reset();
      await refreshChoices();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create choice.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  updateCategorySelect();
  renderChoices();
});
  const bulkToggleBtn = document.getElementById('toggleBulkPanel');
  const bulkPanel = document.getElementById('bulkPanel');
  const bulkCloseBtn = document.getElementById('bulkPanelClose');
  const bulkTextarea = document.getElementById('bulkTextarea');
  const bulkImportBtn = document.getElementById('bulkImportBtn');
  const bulkStatus = document.getElementById('bulkImportStatus');
  function toggleBulkPanel(show) {
    if (!bulkPanel) return;
    const shouldShow =
      typeof show === 'boolean' ? show : !bulkPanel.classList.contains('show');
    bulkPanel.classList.toggle('show', shouldShow);
  }

  bulkToggleBtn?.addEventListener('click', () => toggleBulkPanel());
  bulkCloseBtn?.addEventListener('click', () => toggleBulkPanel(false));

  bulkImportBtn?.addEventListener('click', async () => {
    if (!bulkTextarea) return;
    const text = bulkTextarea.value.trim();
    if (!text) {
      alert('Paste some lines to import.');
      return;
    }
    bulkImportBtn.disabled = true;
    bulkStatus.textContent = 'Importing...';
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
    let success = 0;
    let failed = 0;

    for (const rawLine of lines) {
      const parts = rawLine.split('|').map((part) => part.trim());
      const [name, optionLabel, priceText, costText, unitToken] = parts;
      if (!name) {
        failed++;
        continue;
      }
      const resolvedUnit =
        resolveUnitId(unitToken) ??
        (optionLabel && optionLabel.toLowerCase().includes('pp')
          ? findPerPersonUnit()
          : null);
      const payload = {
        name,
        description: null,
        options: [
          {
            name: optionLabel || name,
            price:
              priceText && !Number.isNaN(Number(priceText))
                ? Number(priceText)
                : null,
            cost:
              costText && !Number.isNaN(Number(costText))
                ? Number(costText)
                : null,
            unit_id: resolvedUnit,
          },
        ],
      };
      try {
        const res = await fetch('/settings/menus/choices/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const dataResp = await res.json();
        if (!dataResp.success) {
          throw new Error(dataResp.error || 'Failed to create choice.');
        }
        success++;
      } catch (err) {
        console.error('Bulk import line failed:', rawLine, err);
        failed++;
      }
    }

    bulkStatus.textContent = `Imported ${success} choice(s)${
      failed ? `, ${failed} failed.` : '.'
    }`;
    bulkImportBtn.disabled = false;
    if (success) {
      bulkTextarea.value = '';
      // eslint-disable-next-line no-undef
      await refreshChoices();
    }
  });

  function resolveUnitId(token) {
    if (!token) return null;
    const normalized = token.trim().toLowerCase();
    let match = null;
    // eslint-disable-next-line no-undef
    unitLookup.forEach((unit, id) => {
      if (
        String(unit.id) === normalized ||
        unit.name.toLowerCase() === normalized ||
        (unit.type && unit.type.toLowerCase() === normalized)
      ) {
        match = Number(id);
      }
    });
    return match;
  }

  function findPerPersonUnit() {
    let match = null;
    // eslint-disable-next-line no-undef
    unitLookup.forEach((unit, id) => {
      if (
        (unit.type && unit.type.toLowerCase().includes('per')) ||
        (unit.name && unit.name.toLowerCase().includes('pp'))
      ) {
        match = Number(id);
      }
    });
    return match;
  }
