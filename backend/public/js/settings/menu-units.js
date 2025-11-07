// public/js/settings/menu-units.js
document.addEventListener('DOMContentLoaded', () => {
  const listEl = document.getElementById('unitList');
  const addBtn = document.getElementById('addUnitBtn');
  const nameInput = document.getElementById('newUnitName');
  const typeSelect = document.getElementById('newUnitType');

  if (!listEl || !addBtn || !nameInput || !typeSelect) return;

  // ======================================================
  // 🔹 Fetch all units
  // ======================================================
  const fetchUnits = async () => {
    try {
      const res = await fetch('/settings/menus/units/api');
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.error || 'Failed');
      render(payload.data || []);
    } catch (err) {
      console.error('Load units error:', err);
      listEl.innerHTML = `<li class="list-group-item text-danger">❌ Error loading units</li>`;
    }
  };

  // ======================================================
  // 🔹 Render the unit list
  // ======================================================
  const render = (rows) => {
    listEl.innerHTML = '';
    if (!rows.length) {
      listEl.innerHTML = `<li class="list-group-item text-muted fst-italic">No units yet.</li>`;
      return;
    }

    const typeOptions = ['quantity', 'per_person', 'time', 'weight', 'volume', 'fixed'];

    rows.forEach(row => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex align-items-center justify-content-between gap-2 flex-wrap';
      li.dataset.id = row.id;

      li.innerHTML = `
        <div class="flex-grow-1">
          <input type="text" class="form-control form-control-sm unit-name-input" value="${row.name}">
        </div>
        <div>
          <select class="form-select form-select-sm unit-type-select">
            ${typeOptions
              .map(opt => `<option value="${opt}" ${row.type === opt ? 'selected' : ''}>${opt}</option>`)
              .join('')}
          </select>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-primary unit-save">Save</button>
          <button class="btn btn-sm btn-outline-danger unit-delete">Delete</button>
        </div>
      `;
      listEl.appendChild(li);
    });
  };

  // ======================================================
  // 🔸 Add new unit
  // ======================================================
  addBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const type = typeSelect.value;
    if (!name) return alert('Please enter a unit name.');

    addBtn.disabled = true;
    try {
      const res = await fetch('/settings/menus/units/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type })
      });
      const payload = await res.json();
      if (!payload.success) {
        alert('❌ ' + (payload.error || 'Failed to add unit'));
      } else {
        nameInput.value = '';
        typeSelect.value = 'quantity';
        await fetchUnits();
      }
    } catch (err) {
      console.error('Add unit error:', err);
      alert('❌ Error adding unit');
    } finally {
      addBtn.disabled = false;
    }
  });

  // ======================================================
  // 🔸 Inline edit / delete handlers
  // ======================================================
  listEl.addEventListener('click', async (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const id = li.dataset.id;

    // --- Save unit changes
    if (e.target.classList.contains('unit-save')) {
      const input = li.querySelector('.unit-name-input');
      const select = li.querySelector('.unit-type-select');
      const name = input.value.trim();
      const type = select.value;
      if (!name) return alert('Name required.');
      e.target.disabled = true;
      try {
        const res = await fetch(`/settings/menus/units/api/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, type })
        });
        const result = await res.json();
        if (!result.success) throw new Error(result.error);
        e.target.textContent = '✅ Saved';
        setTimeout(() => (e.target.textContent = 'Save'), 1000);
      } catch (err) {
        console.error('❌ Error saving unit:', err);
        alert('❌ Error saving unit');
      } finally {
        e.target.disabled = false;
      }
    }

    // --- Delete unit
    if (e.target.classList.contains('unit-delete')) {
      if (!confirm('Delete this unit?')) return;
      try {
        const res = await fetch(`/settings/menus/units/api/${id}`, { method: 'DELETE' });
        const result = await res.json();
        if (!result.success) throw new Error(result.error);
        li.remove();
      } catch (err) {
        console.error('❌ Error deleting unit:', err);
        alert('❌ Error deleting unit');
      }
    }
  });

  // ======================================================
  // 🔹 Initial load
  // ======================================================
  fetchUnits();
});
