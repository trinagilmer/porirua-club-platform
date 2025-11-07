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
    const block = event.target.closest('.menu-category-block');
    if (!block) return;

    page.querySelectorAll('.menu-category-block.active').forEach((node) => {
      node.classList.remove('active');
    });
    block.classList.add('active');
  });
});

