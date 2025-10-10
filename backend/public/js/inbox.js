/**
 * 📬 Porirua Club Platform – Unified Inbox Frontend
 * Supports: Inbox message navigation, Auto-Linker, Reply & Link Modals
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
     🧠 Auto-Linker integration (optional backend route)
  --------------------------------------------------------- */
  const runLinkerBtn = document.getElementById("runLinker");
  const linkerLog = document.getElementById("linkerLog");

  if (runLinkerBtn && linkerLog) {
    runLinkerBtn.addEventListener("click", async () => {
      runLinkerBtn.disabled = true;
      linkerLog.innerHTML = '<span class="loading">⏳ Running Auto-Linker...</span>';

      try {
        const res = await fetch("/inbox/match", { method: "POST" });
        const data = await res.json();

        if (res.ok) {
          linkerLog.innerHTML = `
            <span class="success">✅ Auto-Linker Completed</span>
            <pre>${JSON.stringify(data, null, 2)}</pre>`;
        } else {
          linkerLog.innerHTML = `
            <span class="error">❌ Error: ${data.message || "Unknown error"}</span>`;
        }
      } catch (err) {
        console.error("💥 Auto-Linker failed:", err);
        linkerLog.innerHTML = `<span class="error">💥 Request failed: ${err.message}</span>`;
      } finally {
        runLinkerBtn.disabled = false;
      }
    });
  }

  /* ---------------------------------------------------------
     💬 Modal Triggers (Message Detail Page)
     — Bootstrap 5 Modals for Link / Reply
  --------------------------------------------------------- */
  window.addEventListener("load", () => {
    console.log("🧩 Page fully loaded — checking for modal buttons...");
    const replyBtn = document.querySelector(".btn-reply-message");
    const linkBtn = document.querySelector(".btn-link-message");

    if (!replyBtn && !linkBtn) {
      console.log("ℹ️ No modal buttons found on this page.");
      return;
    }

    console.log("✅ Modal buttons detected:", {
      reply: !!replyBtn,
      link: !!linkBtn,
    });

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
     ✅ Optional form feedback (Reply + Link)
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
     🔔 Optional Toast Notifications
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


