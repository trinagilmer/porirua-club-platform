/* =========================================================
   🌙 Porirua Club Platform — UI Controller
   Handles: Dark Mode, Toasts, Loading Overlay
========================================================= */

// ---- 1. DARK MODE TOGGLE ----
const themeToggleBtn = document.getElementById('themeToggle');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(dark) {
  document.body.classList.toggle('dark-theme', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

function loadTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) applyTheme(saved === 'dark');
  else applyTheme(prefersDark.matches);
}

loadTheme();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    themeToggleBtn.innerHTML = isDark ? '☀️' : '🌙';
  });
}

// ---- 2. TOAST SYSTEM ----
function showToast(message, type = 'success', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type} show`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 500);
  }, duration);
}

// Example usage:
// showToast("Saved successfully!", "success");
// showToast("Error loading data", "error");

// ---- 3. LOADING OVERLAY ----
const loadingOverlay = document.createElement('div');
loadingOverlay.className = 'loading-overlay';
document.body.appendChild(loadingOverlay);

function showLoading() {
  loadingOverlay.classList.add('show');
}
function hideLoading() {
  loadingOverlay.classList.remove('show');
}

// Example usage:
// showLoading();
// setTimeout(hideLoading, 1500);

