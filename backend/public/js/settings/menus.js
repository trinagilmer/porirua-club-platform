// backend/public/js/settings/menus.js
// Minimal page enhancements for the menus settings screen. Core CRUD is handled
// by menuDrawer.js so this file just wires a few UX touches.

document.addEventListener('DOMContentLoaded', () => {
  const page = document.querySelector('main.menus-page');
  if (!page) return;

  // Async-loaded context for the drawer script.
  window.menuBuilderData = window.menuBuilderData || {};

  // Highlight a category card when clicked so the drawer behaviour feels scoped.
  page.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('.delete-menu-btn');
    if (deleteBtn) {
      event.preventDefault();
      const menuId = Number(deleteBtn.dataset.id || 0);
      const menuName = String(deleteBtn.dataset.name || 'this menu').trim();
      if (!Number.isInteger(menuId) || menuId <= 0) return;

      const confirmed = window.confirm(`Delete menu "${menuName}"? This cannot be undone.`);
      if (!confirmed) return;

      deleteBtn.disabled = true;
      fetch(`/settings/menus/menu/${menuId}`, { method: 'DELETE' })
        .then(async (res) => {
          const payload = await res.json().catch(() => ({}));
          if (!res.ok || payload.success === false) {
            throw new Error(payload.error || 'Failed to delete menu.');
          }
          window.location.reload();
        })
        .catch((err) => {
          console.error('Delete menu error:', err);
          window.alert(err.message || 'Failed to delete menu.');
          deleteBtn.disabled = false;
        });
      return;
    }

    const block = event.target.closest('.menu-category-block');
    if (!block) return;

    page.querySelectorAll('.menu-category-block.active').forEach((node) => {
      node.classList.remove('active');
    });
    block.classList.add('active');
  });
});

