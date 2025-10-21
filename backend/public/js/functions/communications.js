/**
 * 📬 Function Communications – behaviour like Inbox
 * - New Message modal (Quill editor)
 * - Clickable message cards
 * - 401 -> redirect to /auth/login
 */

document.addEventListener("DOMContentLoaded", () => {
  console.log("📨 Function Communications JS Loaded");

  // ---- Context & elements
  const fnId = window.fnContext?.id;
  const userEmail = window.fnContext?.userEmail || "";
  const newMessageBtn   = document.getElementById("newMessageBtn");
  const newMessageModal = document.getElementById("newMessageModal");
  const form            = document.getElementById("newMessageForm");
  const recipientsInput = document.getElementById("recipientsInput"); // comma-separated
  const subjectInput    = document.getElementById("newSubject");
  const listEl          = document.getElementById("communicationsList");
  const editorEl        = document.getElementById("editor");
  const sendBtn         = document.getElementById("sendBtn");

  // ---- Guard: don’t crash if partials missing
  if (!fnId) {
    console.warn("Missing fnContext.id – cannot bind handlers.");
    return;
  }

  // ---- Init Quill on demand
  let quill = null;
  function ensureQuill() {
    if (!quill && editorEl && window.Quill) {
      quill = new Quill("#editor", {
        theme: "snow",
        placeholder: "Type your message…",
        modules: {
          toolbar: [
            [{ header: [1, 2, false] }],
            ["bold", "italic", "underline"],
            [{ list: "ordered" }, { list: "bullet" }],
            ["link"],
          ],
        },
      });
    }
    return quill;
  }

  // ---- Helpers
  const showToast = (msg, type = "success") => {
    const toast = document.createElement("div");
    toast.className = `toast align-items-center text-white bg-${
      type === "success" ? "success" : type === "error" ? "danger" : "secondary"
    } border-0 position-fixed bottom-0 end-0 m-4 p-3 fade show`;
    toast.innerHTML = `<div>${msg}</div>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.remove("show"), 4500);
  };

  const redirectIf401 = async (res) => {
    if (res.status === 401 || res.status === 403) {
      try {
        const j = await res.json();
        if (j?.redirect) window.location.href = j.redirect;
        else window.location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      } catch {
        window.location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      }
      return true;
    }
    return false;
  };

  // ======================================================
  // 1) “+ New Message” button -> open modal
  // ======================================================
  if (newMessageBtn && newMessageModal) {
    newMessageBtn.addEventListener("click", () => {
      if (!window.bootstrap) {
        console.error("Bootstrap not loaded – modal cannot open.");
        return;
      }
      const modal = new bootstrap.Modal(newMessageModal);
      modal.show();
      ensureQuill();
      if (subjectInput) subjectInput.value = "";
      if (recipientsInput) recipientsInput.value = "";
      if (quill) quill.setText("");
    });
  }

  // ======================================================
  // 2) Submit new message
  // ======================================================
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!sendBtn) return;

      const to = (recipientsInput?.value || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      const subject = subjectInput?.value?.trim() || "(No subject)";
      const bodyHtml = quill ? quill.root.innerHTML : (document.getElementById("plainBody")?.value || "");

      if (!to.length) return showToast("Please add at least one recipient.", "error");
      sendBtn.disabled = true;

      try {
        const res = await fetch(`/functions/${encodeURIComponent(fnId)}/communications/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ to, subject, body: bodyHtml }),
        });

        if (await redirectIf401(res)) return;

        const data = await res.json();
        if (!data?.success) throw new Error(data?.error || "Failed to send");

        showToast("Email sent ✅");
        // Optimistic UI: prepend a new card
        if (listEl) {
          const now = new Date().toISOString();
          const card = document.createElement("div");
          card.className = "message-card";
          card.dataset.id = data.data?.id || "";
          card.innerHTML = `
            <div class="msg-left">
              <div class="msg-from">${userEmail || "You"}</div>
              <div class="msg-subject">${subject}</div>
              <div class="msg-preview">${(bodyHtml || "").replace(/<[^>]+>/g, "").slice(0, 120)}</div>
            </div>
            <div class="msg-date" data-time="${now}">${new Date(now).toLocaleString("en-NZ")}</div>
          `;
          listEl.prepend(card);
        }

        // Close modal
        if (window.bootstrap && newMessageModal) {
          bootstrap.Modal.getOrCreateInstance(newMessageModal).hide();
        }
      } catch (err) {
        console.error(err);
        showToast("Couldn’t send your email.", "error");
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  // ======================================================
  // 3) Make message cards clickable (navigate to /inbox/:id)
  // ======================================================
  function bindCardClicks(root = document) {
    root.querySelectorAll(".message-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("button,a,.btn")) return;
        const id = card.dataset.id;
        if (id) window.location.href = `/functions/${encodeURIComponent(fnId)}/communications/${encodeURIComponent(id)}`;
      });
    });
  }
  bindCardClicks();

  // If you ever re-render the list via AJAX, call bindCardClicks(listEl) again.
});
