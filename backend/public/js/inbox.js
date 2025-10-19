/**
 * 📬 Porirua Club Platform – Unified Inbox Frontend (Enhanced)
 * Handles: Inbox navigation, Modals, Quill editor, and Toasts
 */

document.addEventListener("DOMContentLoaded", () => {
  console.log("📡 Unified Inbox JS Loaded");

  /* ---------------------------------------------------------
     🕓 Relative time formatting
  --------------------------------------------------------- */
  const formatTimeAgo = (date) => {
    if (!date) return "";
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    const intervals = [
      { label: "year", seconds: 31536000 },
      { label: "month", seconds: 2592000 },
      { label: "day", seconds: 86400 },
      { label: "hour", seconds: 3600 },
      { label: "minute", seconds: 60 },
    ];
    for (const i of intervals) {
      const count = Math.floor(seconds / i.seconds);
      if (count >= 1) return `${count} ${i.label}${count > 1 ? "s" : ""} ago`;
    }
    return "just now";
  };

  document.querySelectorAll(".msg-date").forEach((el) => {
    const t = el.dataset.time;
    if (t) el.textContent = formatTimeAgo(t);
  });

  /* ---------------------------------------------------------
     💌 Message cards → click to open detail page
  --------------------------------------------------------- */
  const messageCards = document.querySelectorAll(".message-card");
  messageCards.forEach((card) => {
    card.addEventListener("click", (e) => {
      // Prevent clicks on internal buttons (if any)
      if (e.target.closest("button, a")) return;
      const id = card.dataset.id;
      if (id) {
        console.log(`📨 Opening message ${id}`);
        window.location.href = `/inbox/${id}`;
      } else {
        console.warn("⚠️ Message card missing data-id");
      }
    });
  });

  /* ---------------------------------------------------------
     💬 Modal Triggers (Reply / Link)
  --------------------------------------------------------- */
  window.addEventListener("load", () => {
    console.log("🧩 Page fully loaded — checking for modal buttons...");
    const replyBtn = document.querySelector(".btn-reply-message");
    const linkBtn = document.querySelector(".btn-link-message");

    if (!replyBtn && !linkBtn) {
      console.log("ℹ️ No modal buttons found on this page.");
      return;
    }

    const showModal = (id) => {
      const el = document.getElementById(id);
      if (!el) {
        console.warn(`⚠️ Modal #${id} not found in DOM.`);
        return;
      }
      const modal = new bootstrap.Modal(el);
      modal.show();
    };

    if (replyBtn) {
      replyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("💬 Opening reply modal...");
        showModal("replyMessageModal");
      });
    }

    if (linkBtn) {
      linkBtn.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("🔗 Opening link modal...");
        showModal("linkMessageModal");
      });
    }
  });


  /* ---------------------------------------------------------
     ✅ Optional form feedback
  --------------------------------------------------------- */
  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      const btn = form.querySelector("button[type='submit']");
      if (btn) {
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "⏳ Sending...";
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = oldText;
        }, 3000);
      }
    });
  });

  /* ---------------------------------------------------------
     🔔 Toast Notifications
  --------------------------------------------------------- */
  const showToast = (msg, type = "success") => {
    const toast = document.createElement("div");
    toast.className = `toast align-items-center text-white bg-${
      type === "success" ? "success" : type === "error" ? "danger" : "secondary"
    } border-0 position-fixed bottom-0 end-0 m-4 p-3 fade show`;
    toast.innerHTML = `<div>${msg}</div>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.remove("show"), 4000);
  };

  const flash = document.getElementById("flash-msg");
  if (flash) showToast(flash.textContent, flash.dataset.type || "info");
});



