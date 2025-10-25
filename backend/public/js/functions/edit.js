// backend/public/js/functions/edit.js

console.log("🧩 Function Edit Script Loaded");

// Basic DOM hooks
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form[action*='/edit']");
  if (!form) return;

  const saveBtn = form.querySelector("button[type='submit']");
  const cancelBtn = form.querySelector("a.btn-outline-secondary");
  const inputs = form.querySelectorAll("input, select, textarea");

  // 🧠 Prevent accidental double submits
  form.addEventListener("submit", (e) => {
    if (saveBtn.disabled) {
      e.preventDefault();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  });

  // 🧩 Client-side validation helper
  form.addEventListener("submit", (e) => {
    const eventName = form.querySelector("[name='event_name']");
    if (!eventName.value.trim()) {
      e.preventDefault();
      alert("Event name is required.");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
      eventName.focus();
      return;
    }
  });

  // 💡 (Optional) Live visual feedback
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("is-invalid");
    });
  });

  // 🧭 Cancel button safety confirmation (optional)
  cancelBtn?.addEventListener("click", (e) => {
    const hasChanges = Array.from(inputs).some((input) => input.value !== input.defaultValue);
    if (hasChanges && !confirm("Discard unsaved changes?")) {
      e.preventDefault();
    }
  });
});
