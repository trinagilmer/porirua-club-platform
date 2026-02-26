// backend/public/js/functions/edit.js

console.log("🧩 Function Edit Script Loaded");

// Basic DOM hooks
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form[action*='/edit']");
  if (!form) return;

  const saveBtn = form.querySelector("button[type='submit']");
  const cancelBtn = form.querySelector("a.btn-outline-secondary");
  const inputs = form.querySelectorAll("input, select, textarea");
  const allocationContainer = document.getElementById("allocationRows");
  const addAllocationBtn = document.getElementById("addAllocationRow");
  const allocationTemplate = document.getElementById("allocationRowTemplate");
  const allocationError = document.getElementById("allocationError");

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
    const allocationRows = form.querySelectorAll(".allocation-row");
    for (const row of allocationRows) {
      const roomSelect = row.querySelector('select[name="allocation_room_id"]');
      const roomValue = roomSelect ? roomSelect.value : "";
      if (!roomValue) continue;
      const startDate = row.querySelector('input[name="allocation_start_date"]')?.value || "";
      const startTime = row.querySelector('input[name="allocation_start_time"]')?.value || "";
      const endDate = row.querySelector('input[name="allocation_end_date"]')?.value || "";
      const endTime = row.querySelector('input[name="allocation_end_time"]')?.value || "";
      if (!startDate && !endDate && !startTime && !endTime) continue;
      const startStamp = startDate ? `${startDate}T${startTime || "00:00"}:00` : "";
      const endStamp = endDate ? `${endDate}T${endTime || "23:59"}:00` : "";
      if (startStamp && endStamp) {
        const startAt = new Date(startStamp);
        const endAt = new Date(endStamp);
        if (!Number.isNaN(startAt.getTime()) && !Number.isNaN(endAt.getTime()) && endAt < startAt) {
          e.preventDefault();
          if (allocationError) {
            allocationError.textContent = "Allocation end must be after start.";
            allocationError.classList.remove("d-none");
          } else {
            alert("Allocation end must be after start.");
          }
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
    }
  });

  // 💡 (Optional) Live visual feedback
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("is-invalid");
      if (allocationError) {
        allocationError.classList.add("d-none");
        allocationError.textContent = "";
      }
    });
  });

  const bindRemoveButtons = (root = document) => {
    root.querySelectorAll(".remove-allocation").forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const row = btn.closest(".allocation-row");
        row?.remove();
        if (allocationError) {
          allocationError.classList.add("d-none");
          allocationError.textContent = "";
        }
      });
    });
  };

  bindRemoveButtons();

  addAllocationBtn?.addEventListener("click", () => {
    if (!allocationContainer || !allocationTemplate) return;
    const clone = allocationTemplate.content.cloneNode(true);
    allocationContainer.appendChild(clone);
    bindRemoveButtons(allocationContainer);
  });

  // 🧭 Cancel button safety confirmation (optional)
  cancelBtn?.addEventListener("click", (e) => {
    const hasChanges = Array.from(inputs).some((input) => input.value !== input.defaultValue);
    if (hasChanges && !confirm("Discard unsaved changes?")) {
      e.preventDefault();
    }
  });
});
