/* =========================================================
   🌙 Porirua Club Platform — Universal UI Controller
   Handles: Theme, Toasts, Loading Overlay, Fetch Wrapper,
   UX Shortcuts, Page Transitions
========================================================= */

(function () {
  console.log("🧠 UI Controller initialized.");

  // =========================================================
  // 1. DARK MODE TOGGLE
  // =========================================================
  const themeToggleBtn = document.getElementById('themeToggle');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(dark) {
    document.body.classList.toggle('dark-theme', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    if (themeToggleBtn) themeToggleBtn.textContent = dark ? '☀️' : '🌙';
  }

  function loadTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) applyTheme(saved === 'dark');
    else applyTheme(prefersDark.matches);
  }
  loadTheme();

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const isDark = !document.body.classList.contains('dark-theme');
      applyTheme(isDark);
    });
  }

  // =========================================================
  // 2. TOAST SYSTEM
  // =========================================================
  function showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type} show`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  // =========================================================
  // 3. LOADING OVERLAY
  // =========================================================
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'loading-overlay';
  document.body.appendChild(loadingOverlay);

  function showLoading() {
    loadingOverlay.classList.add('show');
  }
  function hideLoading() {
    loadingOverlay.classList.remove('show');
  }

  // =========================================================
  // 4. FETCH WRAPPER (Auto Loader + Toast)
  // =========================================================
  async function wrappedFetch(url, options = {}) {
    showLoading();
    try {
      const res = await fetch(url, options);
      const contentType = res.headers.get("content-type");
      const data = contentType && contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      hideLoading();

      if (!res.ok) {
        const msg = data?.message || `Error ${res.status}`;
        showToast(msg, "error");
        throw new Error(msg);
      }

      // Success toast (only for mutations)
      if (options.method && options.method !== "GET") {
        showToast("✅ Action completed successfully", "success");
      }

      return data;
    } catch (err) {
      hideLoading();
      console.error("❌ Fetch error:", err);
      showToast(err.message || "Request failed", "error");
      throw err;
    }
  }

  // =========================================================
  // 5. PAGE TRANSITION ANIMATION (Optional)
  // =========================================================
  document.addEventListener("DOMContentLoaded", () => {
    document.body.style.opacity = 0;
    document.body.style.transition = "opacity 0.4s ease";
    requestAnimationFrame(() => (document.body.style.opacity = 1));
  });

  // =========================================================
  // 6. KEYBOARD SHORTCUTS (Power User Mode)
  // =========================================================
  document.addEventListener('keydown', (e) => {
    // "/" focuses search bar if available
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      const search = document.querySelector('input[type="search"], input#search, .comm-controls input');
      if (search) {
        e.preventDefault();
        search.focus();
      }
    }
    // "n" opens note modal
    if (e.key.toLowerCase() === 'n' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      const newNoteBtn = document.querySelector('#newNoteBtn, .btn-add-note');
      if (newNoteBtn) {
        e.preventDefault();
        newNoteBtn.click();
      }
    }
  });

  // =========================================================
  // 7. AUTO-INIT WELCOME MESSAGE (Optional)
  // =========================================================
  if (window.location.pathname === '/dashboard' && sessionStorage.getItem('welcomeShown') !== 'true') {
    const username = document.querySelector('.user-circle')?.textContent.trim() || 'User';
    showToast(`Welcome back, ${username}!`, "success", 2500);
    sessionStorage.setItem('welcomeShown', 'true');
  }

  // Expose utility functions to global scope if needed
  window.UI = { showToast, showLoading, hideLoading, wrappedFetch };
})();


