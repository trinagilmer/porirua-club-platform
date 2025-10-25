/* =========================================================
   🌐 Shared Settings UI Helpers (Bootstrap-Ready)
========================================================= */

/**
 * Displays a temporary toast notification message
 * @param {string} message - The message text
 * @param {"success" | "error" | "warning" | "info"} type - Type of toast
 */
export function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer") || createToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast-message ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Automatically fade out after 3.5s
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 600);
  }, 3500);
}

/** Helper: Creates a reusable toast container */
function createToastContainer() {
  const container = document.createElement("div");
  container.id = "toastContainer";
  container.style.position = "fixed";
  container.style.top = "1rem";
  container.style.right = "1rem";
  container.style.zIndex = "9999";
  document.body.appendChild(container);
  return container;
}

/* =========================================================
   💡 Utility idea: optional Bootstrap helpers
========================================================= */

/**
 * Optionally create a helper to easily open a Bootstrap modal in JS.
 * Example: openModal("#settingsRoomAddModal")
 */
export function openModal(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  const modal = new bootstrap.Modal(el);
  modal.show();
}

/**
 * Optionally hide a Bootstrap modal in JS.
 * Example: closeModal("#settingsRoomAddModal")
 */
export function closeModal(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  const modal = bootstrap.Modal.getInstance(el);
  modal?.hide();
}
