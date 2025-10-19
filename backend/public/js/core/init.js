/* =========================================================
   🚀 APP INITIALIZER — Smart Module Loader
   Dynamically loads scripts based on DOM presence
========================================================= */

import { ready } from "./utils.js";

ready(async () => {
  console.log("🧠 App Init started...");

  // Sidebar partial present?
  if (document.querySelector(".function-sidebar")) {
    console.log("🧭 Loading sidebar.js...");
    await import("../sidebar.js");
  }

  // Function detail page present?
  if (document.querySelector("[data-page='function-detail']")) {
    console.log("📄 Loading function-detail.js...");
    await import("../function-detail.js");
  }

  // Future expansions: add tab-based or page-specific imports
  // if (document.querySelector("[data-page='tasks']")) await import("../tasks.js");

  console.log("✅ All modules loaded.");
});
