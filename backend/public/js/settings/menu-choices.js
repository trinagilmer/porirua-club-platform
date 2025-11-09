document.addEventListener('DOMContentLoaded', () => {
  const data = window.menuChoiceData || {};

  const choicesContainer = document.getElementById('choicesContainer');
  const filterSelect = document.getElementById('choiceCategoryFilter');
  const createChoiceForm = document.getElementById('createChoiceForm');
  const createChoiceName = document.getElementById('createChoiceName');
  const createChoiceCategory = document.getElementById('createChoiceCategory');
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
  let categoryLookup = buildCategoryLookup();

  function buildUnitLookup() {
    const map = new Map();
    units.forEach((u) => {
      map.set(String(u.id), u);
    });
    return map;
  }

  function buildCategoryLookup() {
    const map = new Map();
    categories.forEach((cat) => {
      if (!cat) return;
      map.set(String(cat.id), cat);
      if (cat.name) {
        map.set(cat.name.trim().toLowerCase(), cat);
      }
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

    const base = {
      id: choice.id,
      name: choice.name || '',
      description: choice.description || '',
      options: parseArray(choice.options),
      categories: parseArray(choice.categories),
      menus: parseArray(choice.menus),
    };

    const resolvedCategory =
      choice.category && typeof choice.category === 'object'
        ? {
            id:
              choice.category.id ??
              choice.category_id ??
              choice.category?.category_id ??
              null,
            name:
              choice.category.name ||
              choice.category_name ||
              choice.category?.label ||
              'Unassigned',
          }
        : choice.category_id
        ? {
            id: choice.category_id,
            name:
              choice.category_name ||
              categoryLookup.get(String(choice.category_id))?.name ||
              'Unassigned',
          }
        : null;

    return { ...base, category: resolvedCategory };
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

  function buildCategoryOptions(selectedId = null, includeBlank = true) {
    const opts = [];
    if (includeBlank) {
      opts.push('<option value="">Unassigned</option>');
    }
    categories.forEach((cat) => {
      const sel =
        selectedId !== null && String(cat.id) === String(selectedId)
          ? ' selected'
          : '';
      opts.push(
        `<option value="${escapeHtml(cat.id)}"${sel}>${escapeHtml(
          cat.name
        )}</option>`
      );
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
    updateCreateCategoryOptions();
  }

  function updateCreateCategoryOptions() {
    if (!createChoiceCategory) return;
    const current = createChoiceCategory.value || '';
    const options = [
      '<option value="">Unassigned</option>',
      ...categories.map(
        (cat) =>
          `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</option>`
      ),
    ];
    createChoiceCategory.innerHTML = options.join('');
    if (
      current &&
      categories.some((cat) => String(cat.id) === String(current))
    ) {
      createChoiceCategory.value = current;
    } else {
      createChoiceCategory.value = '';
    }
  }

  function renderChoices() {
    choicesContainer.innerHTML = '';
    const filterValue = filterSelect ? filterSelect.value : 'all';

    const groups = new Map();

    choices.forEach((choice) => {
      const primaryCategory =
        choice.category && choice.category.id !== undefined
          ? choice.category
          : null;
      const fallbackCategories =
        choice.categories && choice.categories.length
          ? choice.categories.filter(
              (cat) => cat && (cat.id !== undefined || cat.name)
            )
          : [];
      const catList =
        primaryCategory && primaryCategory.id !== undefined
          ? [primaryCategory]
          : fallbackCategories.length
          ? fallbackCategories
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
    const categoryPill = document.createElement('span');
    categoryPill.className = 'choice-pill';
    categoryPill.textContent = choice.category?.name || 'Unassigned';
    metadata.appendChild(categoryPill);
    if (primary && primary.cogs_percent != null) {
      const cogsPill = document.createElement('span');
      cogsPill.className = 'choice-pill';
      cogsPill.title = 'COGS % = (Cost / Price) × 100';
      cogsPill.textContent = `COGS ${Number(primary.cogs_percent).toFixed(1)}%`;
      metadata.appendChild(cogsPill);
    }
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

    const categoryGroup = document.createElement('div');
    categoryGroup.className = 'mb-2';
    const categoryLabel = document.createElement('label');
    categoryLabel.className =
      'form-label small text-uppercase text-muted mb-1';
    categoryLabel.textContent = 'Sales Category';
    categoryGroup.appendChild(categoryLabel);
    const categorySelect = document.createElement('select');
    categorySelect.className = 'form-select form-select-sm choice-category';
    categorySelect.innerHTML = buildCategoryOptions(
      choice.category?.id ?? null
    );
    categoryGroup.appendChild(categorySelect);
    const categoryHelp = document.createElement('div');
    categoryHelp.className = 'form-text';
    categoryHelp.textContent = 'e.g. Catering';
    categoryGroup.appendChild(categoryHelp);
    body.appendChild(categoryGroup);

    categorySelect.addEventListener('change', () => {
      const selectedId = categorySelect.value;
      const matched =
        categoryLookup.get(selectedId) ||
        categoryLookup.get(selectedId?.trim()?.toLowerCase());
      categoryPill.textContent = matched?.name || 'Unassigned';
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'form-control form-control-sm choice-name mb-2';
    nameInput.value = choice.name || '';
    body.appendChild(nameInput);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'form-control form-control-sm choice-label mb-2';
    labelInput.placeholder = 'Option label';
    labelInput.value =
      primary && primary.name ? primary.name : choice.name || '';
    body.appendChild(labelInput);

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
        categorySelect,
        nameInput,
        labelInput,
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
    const {
      categorySelect,
      nameInput,
      labelInput,
      priceInput,
      costInput,
      unitSelect,
      descInput,
      saveButton,
      deleteButton,
    } = refs;
    const name = nameInput.value.trim();
    if (!name) {
      alert('Please provide a choice name.');
      nameInput.focus();
      return;
    }
    const optionLabel =
      labelInput && labelInput.value.trim()
        ? labelInput.value.trim()
        : name;

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
    let categoryId = null;
    if (categorySelect && categorySelect.value !== '') {
      categoryId = Number(categorySelect.value);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        alert('Select a valid sales category.');
        categorySelect.focus();
        return;
      }
    }

    saveButton.disabled = true;
    deleteButton.disabled = true;

    try {
      const res = await fetch(`/settings/menus/choices/api/${choiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, category_id: categoryId }),
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
        name: optionLabel,
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
        choiceRecord.category =
          categoryId && categoryLookup.get(String(categoryId))
            ? {
                id: categoryId,
                name: categoryLookup.get(String(categoryId)).name,
              }
            : null;
        if (choiceRecord.options && choiceRecord.options.length) {
          choiceRecord.options[0].name = optionLabel;
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
          categoryLookup = buildCategoryLookup();
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
    if (!createOptionName) return;
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
    const categoryId = createChoiceCategory?.value
      ? Number(createChoiceCategory.value)
      : null;
    if (
      createChoiceCategory &&
      createChoiceCategory.hasAttribute('data-required') &&
      !categoryId
    ) {
      alert('Select a sales category for this choice.');
      createChoiceCategory.focus();
      return;
    }
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
      category_id: categoryId,
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
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length);
    let success = 0;
    let failed = 0;

    for (const rawLine of lines) {
      const normalizedParts = normalizeBulkLine(rawLine);
      while (normalizedParts.length < 6) {
        normalizedParts.push('');
      }
      let [categoryToken, name, description, costText, priceText, unitToken] =
        normalizedParts;
      let categoryId = resolveCategoryId(categoryToken);
      if (!categoryId && name === '' && categoryToken) {
        name = categoryToken;
        categoryToken = '';
      }
      if (!name) {
        failed++;
        continue;
      }
      const priceValue = parseCurrencyValue(priceText);
      const costValue = parseCurrencyValue(costText);
      if (categoryToken && !categoryId) {
        console.warn(
          'Unknown category for bulk import line:',
          categoryToken,
          rawLine
        );
      }
      const resolvedUnit =
        resolveUnitId(unitToken) ??
        ((description || name).toLowerCase().includes('pp')
          ? findPerPersonUnit()
          : null);
        const payload = {
          name,
          description: description || null,
          category_id: categoryId,
          options: [
            {
              name,
              price: priceValue,
              cost: costValue,
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
    if (!normalized) return null;
    if (['pp', 'p/p', 'per person', 'per-person'].includes(normalized)) {
      return findPerPersonUnit();
    }
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

  function resolveCategoryId(token) {
    if (!token) return null;
    const normalized = token.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'unassigned') return null;
    const direct = categoryLookup.get(normalized);
    if (direct) return Number(direct.id);
    const byId = categoryLookup.get(String(Number(normalized)));
    if (byId) return Number(byId.id);
    return null;
  }

  function parseCurrencyValue(value) {
    if (!value) return null;
    const cleaned = value.replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  function normalizeBulkLine(line) {
    if (!line) return [];
    let parts = line.split(/\t|\|/).map((part) => part.trim());
    if (parts.length <= 1) {
      parts = line.split(/,/).map((part) => part.trim());
    }
    if (parts.length <= 1) {
      parts = line.split(/\s{2,}/).map((part) => part.trim());
    }
    return parts.filter((part, idx) => part !== '' || idx < 6);
  }
});
