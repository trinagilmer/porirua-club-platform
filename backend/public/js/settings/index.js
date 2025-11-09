/* =========================================================
   ⚙️ Settings Index Script
   Shared logic for all Settings subpages
========================================================= */

import { showToast } from "./_shared.js";

console.log("⚙️ Settings Index JS loaded");

/* =========================================================
   🌍 Page Detection Helpers
========================================================= */

/**
 * Returns the current settings page type
 * e.g. "event-types", "spaces", etc.
 */
export function getSettingsPage() {
  return document.body.dataset.pageType || document.body.dataset.page || "";
}

/**
 * Dynamically loads page-specific scripts if needed.
 * Example: preload additional logic for other tabs.
 */
export async function loadSettingsModule(page) {
  switch (page) {
    case "event-types":
      await import("./event-types.js");
      break;
    case "spaces":
      await import("./spaces.js");
      break;
    default:
      console.log("No specific module found for:", page);
  }
}

/* =========================================================
   🚀 Bootstrap Initialization
========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const page = getSettingsPage();
  console.log(`📄 Settings page detected: ${page || "general"}`);
  await loadSettingsModule(page);
});

/* =========================================================
   🧁 Global Event Hook (Optional)
   Used if you want to show global toast messages
   from backend responses or flash messages.
========================================================= */

const flashEl = document.querySelector('[data-flash-message]');
if (flashEl) {
  showToast(flashEl.dataset.flashMessage, flashEl.dataset.flashType || "info");
}
