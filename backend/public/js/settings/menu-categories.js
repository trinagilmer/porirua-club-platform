// public/js/settings/menu-categories.js
document.addEventListener('DOMContentLoaded', () => {
  // Prevent double init
  if (window.__menuCategoriesInit) return;
  window.__menuCategoriesInit = true;

  const listEl = document.getElementById('categoryList');
  const addBtn = document.getElementById('addCategoryBtn');
  const nameInput = document.getElementById('newCategoryName');

  if (!listEl || !addBtn || !nameInput) return;

  // --------------------------------------------------
  // 🔹 Fetch & render categories
  // --------------------------------------------------
  const fetchCategories = async () => {
    try {
      const res = await fetch('/settings/menus/categories/api');
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.error || 'Failed');
      render(payload.data || []);
    } catch (err) {
      console.error('❌ Load categories error:', err);
      listEl.innerHTML = `<li class="list-group-item text-danger">❌ Error loading categories</li>`;
    }
  };

  // --------------------------------------------------
  // 🔹 Render category list
  // --------------------------------------------------
  const render = (rows) => {
    listEl.innerHTML = '';
    if (!rows.length) {
      listEl.innerHTML = `<li class="list-group-item text-muted fst-italic">No categories yet.</li>`;
      return;
    }

    rows.forEach(row => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex align-items-center justify-content-between gap-2';
      li.dataset.id = row.id;

      li.innerHTML = `
        <div class="d-flex align-items-center gap-2 flex-grow-1">
          <input type="text" class="form-control form-control-sm cat-name-input" value="${row.name.replace(/"/g, '&quot;')}">
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-primary cat-save">Rename</button>
          <button class="btn btn-sm btn-outline-danger cat-delete">Delete</button>
        </div>
      `;

      listEl.appendChild(li);
    });
  };

  // --------------------------------------------------
  // 🔹 Add category
  // --------------------------------------------------
  addBtn.addEventListener('click', async () => {
    const name = (nameInput.value || '').trim();
    if (!name) return alert('Please enter a category name.');

    addBtn.disabled = true;
    try {
      const res = await fetch('/settings/menus/categories/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const payload = await res.json();
      if (!payload.success) {
        alert('❌ ' + (payload.error || 'Failed to add category'));
      } else {
        nameInput.value = '';
        await fetchCategories();
      }
    } catch (err) {
      console.error('Add category error:', err);
      alert('❌ Error adding category');
    } finally {
      addBtn.disabled = false;
    }
  });

  // --------------------------------------------------
  // 🔹 Handle rename and delete
  // --------------------------------------------------
  listEl.addEventListener('click', async (e) => {
    const li = e.target.closest('li.list-group-item');
    if (!li) return;
    const id = Number(li.dataset.id);
    if (!id) return;

    // ✅ Rename
    if (e.target.classList.contains('cat-save')) {
      const input = li.querySelector('.cat-name-input');
      const name = (input.value || '').trim();
      if (!name) return alert('Please enter a category name.');
      e.target.disabled = true;

      try {
        const res = await fetch(`/settings/menus/categories/api/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const payload = await res.json();
        if (!payload.success) {
          alert('❌ ' + (payload.error || 'Failed to rename'));
        } else {
          e.target.textContent = '✅ Saved';
          setTimeout(() => (e.target.textContent = 'Rename'), 1200);
        }
      } catch (err) {
        console.error('Rename error:', err);
        alert('❌ Error renaming');
      } finally {
        e.target.disabled = false;
      }
    }

    // ✅ Delete
    if (e.target.classList.contains('cat-delete')) {
      if (!confirm('Are you sure you want to delete this category?')) return;

      e.target.disabled = true;
      try {
        const res = await fetch(`/settings/menus/categories/api/${id}`, { method: 'DELETE' });
        const payload = await res.json();
        if (!payload.success) {
          alert('❌ ' + (payload.error || 'Failed to delete'));
        } else {
          li.remove();
          if (!listEl.querySelector('li')) {
            listEl.innerHTML = `<li class="list-group-item text-muted fst-italic">No categories yet.</li>`;
          }
        }
      } catch (err) {
        console.error('Delete error:', err);
        alert('❌ Error deleting category');
      } finally {
        e.target.disabled = false;
      }
    }
  });

  // --------------------------------------------------
  // 🔹 Initial load
  // --------------------------------------------------
  fetchCategories();
});
