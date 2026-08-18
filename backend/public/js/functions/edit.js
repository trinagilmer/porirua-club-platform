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
  const roomConflictWarning = document.getElementById("roomConflictWarning");
  const roomInput = form.querySelector('[name="room_id"]');
  const eventDateInput = form.querySelector('[name="event_date"]');
  const endDateInput = form.querySelector('[name="end_date"]');
  const startTimeInput = form.querySelector('[name="start_time"]');
  const endTimeInput = form.querySelector('[name="end_time"]');
  const cateringRows = document.getElementById("cateringScheduleRows");
  const cateringTemplate = document.getElementById("cateringTimeTemplate");
  const addCateringTime = document.getElementById("addCateringTime");

  let bypassConflictCheck = false;
  let conflictSubmitInFlight = false;
  let conflictCheckInFlight = false;
  let conflictDebounceTimer = null;

  const setConflictWarning = (message) => {
    if (!roomConflictWarning) return;
    if (!message) {
      roomConflictWarning.classList.add("d-none");
      roomConflictWarning.textContent = "";
      return;
    }
    roomConflictWarning.textContent = message;
    roomConflictWarning.classList.remove("d-none");
  };

  const collectAllocationPayload = () => {
    const rows = Array.from(form.querySelectorAll(".allocation-row"));
    return rows
      .map((row) => {
        const rowRoom = row.querySelector('select[name="allocation_room_id"]')?.value || "";
        const sDate = row.querySelector('input[name="allocation_start_date"]')?.value || "";
        const sTime = row.querySelector('input[name="allocation_start_time"]')?.value || "";
        const eDate = row.querySelector('input[name="allocation_end_date"]')?.value || "";
        const eTime = row.querySelector('input[name="allocation_end_time"]')?.value || "";
        if (!rowRoom || !sDate || !eDate) return null;
        return {
          room_id: rowRoom,
          start_at: `${sDate} ${(sTime || "00:00")}:00`,
          end_at: `${eDate} ${(eTime || "23:59")}:00`,
        };
      })
      .filter(Boolean);
  };

  const runConflictCheck = async () => {
    if (conflictCheckInFlight) return { hasConflicts: false };
    const roomId = roomInput?.value || "";
    const eventDate = eventDateInput?.value || "";
    if (!roomId || !eventDate) {
      setConflictWarning("");
      return { hasConflicts: false };
    }

    conflictCheckInFlight = true;
    try {
      const response = await fetch("/functions/room-conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function_id: window.fnContext?.id || null,
          room_id: roomId,
          event_date: eventDate,
          end_date: endDateInput?.value || eventDate,
          start_time: startTimeInput?.value || null,
          end_time: endTimeInput?.value || null,
          allocations: collectAllocationPayload(),
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || "Conflict check failed");
      setConflictWarning(result.hasConflicts ? (result.message || "Room conflict detected.") : "");
      return result;
    } catch (error) {
      console.error(error);
      return { hasConflicts: false };
    } finally {
      conflictCheckInFlight = false;
    }
  };

  const scheduleConflictCheck = () => {
    clearTimeout(conflictDebounceTimer);
    conflictDebounceTimer = setTimeout(runConflictCheck, 220);
  };

  // 🧠 Prevent accidental double submits
  form.addEventListener("submit", (e) => {
    if (!bypassConflictCheck) return;
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
        scheduleConflictCheck();
      });
    });
  };

  bindRemoveButtons();

  const bindCateringRemoveButtons = (root = document) => {
    root.querySelectorAll(".remove-catering-time").forEach((button) => {
      if (button.dataset.bound === "1") return;
      button.dataset.bound = "1";
      button.addEventListener("click", () => {
        button.closest(".catering-service-row")?.remove();
      });
    });
  };

  bindCateringRemoveButtons();
  addCateringTime?.addEventListener("click", () => {
    if (!cateringRows || !cateringTemplate) return;
    cateringRows.appendChild(cateringTemplate.content.cloneNode(true));
    bindCateringRemoveButtons(cateringRows);
    cateringRows.querySelector(".catering-service-row:last-child input")?.focus();
  });

  addAllocationBtn?.addEventListener("click", () => {
    if (!allocationContainer || !allocationTemplate) return;
    const clone = allocationTemplate.content.cloneNode(true);
    allocationContainer.appendChild(clone);
    bindRemoveButtons(allocationContainer);
    scheduleConflictCheck();
  });

  [roomInput, eventDateInput, endDateInput, startTimeInput, endTimeInput].forEach((el) => {
    el?.addEventListener("change", scheduleConflictCheck);
    el?.addEventListener("input", scheduleConflictCheck);
  });

  allocationContainer?.addEventListener("change", scheduleConflictCheck);
  allocationContainer?.addEventListener("input", scheduleConflictCheck);

  runConflictCheck();

  // 🧭 Cancel button safety confirmation (optional)
  cancelBtn?.addEventListener("click", (e) => {
    const hasChanges = Array.from(inputs).some((input) => input.value !== input.defaultValue);
    if (hasChanges && !confirm("Discard unsaved changes?")) {
      e.preventDefault();
    }
  });

  form.addEventListener("submit", async (e) => {
    if (bypassConflictCheck || e.defaultPrevented) return;
    e.preventDefault();
    if (conflictSubmitInFlight) return;
    conflictSubmitInFlight = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      if (typeof window.waitForQuoteUpdates === "function") {
        await window.waitForQuoteUpdates();
      }
    } catch (error) {
      conflictSubmitInFlight = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
      return;
    }
    const result = await runConflictCheck();
    if (result.hasConflicts) {
      alert(result.message || "Room conflict detected. Please resolve before saving.");
      conflictSubmitInFlight = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
      return;
    }
    bypassConflictCheck = true;
    saveBtn.disabled = false;
    form.requestSubmit();
  });
});
