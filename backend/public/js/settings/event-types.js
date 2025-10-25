import { showToast } from "./_shared.js";

console.log("⚙️ Event Types JS loaded");

// Bootstrap modal instances
const addModalEl = document.getElementById("settingsEventTypeModal");
const editModalEl = document.getElementById("settingsEventTypeEditModal");
const addModal = addModalEl ? new bootstrap.Modal(addModalEl) : null;
const editModal = editModalEl ? new bootstrap.Modal(editModalEl) : null;

// Form fields
const nameInput = document.getElementById("settingsNewEventTypeName");
const saveAddBtn = document.getElementById("settingsSaveEventTypeBtn");
const editNameInput = document.getElementById("settingsEditEventTypeName");
const editIdInput = document.getElementById("settingsEditEventTypeId");
const saveEditBtn = document.getElementById("settingsSaveEditEventTypeBtn");

// ✅ ADD EVENT TYPE
saveAddBtn?.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) return showToast("Please enter a name.", "warning");

  try {
    const res = await fetch("/settings/event-types/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.success) {
      showToast("✅ Event type added!");
      addModal?.hide();
      setTimeout(() => location.reload(), 600);
    } else {
      showToast(data.message || "Failed to add event type.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("❌ Server error adding event type.", "error");
  }
});

// ✅ EDIT EVENT TYPE
document.querySelectorAll(".edit-event-type").forEach(btn => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.id;
    const name = btn.dataset.name;

    editIdInput.value = id;
    editNameInput.value = name;
    editModal?.show();
  });
});

saveEditBtn?.addEventListener("click", async () => {
  const id = editIdInput.value;
  const name = editNameInput.value.trim();

  if (!name) return showToast("Please enter a new name.", "warning");

  try {
    const res = await fetch("/settings/event-types/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
    const data = await res.json();

    if (data.success) {
      showToast("✅ Event type updated!");
      editModal?.hide();
      setTimeout(() => location.reload(), 600);
    } else {
      showToast(data.message || "Failed to update.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("❌ Server error updating event type.", "error");
  }
});

// ✅ DELETE EVENT TYPE
document.querySelectorAll(".delete-event-type").forEach(btn => {
  btn.addEventListener("click", async () => {
    const id = btn.dataset.id;
    const row = btn.closest("tr");
    const name = row?.querySelector("td:first-child")?.textContent.trim();

    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch("/settings/event-types/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();

      if (data.success) {
        showToast("🗑️ Event type deleted.");
        setTimeout(() => location.reload(), 500);
      } else {
        showToast(data.message || "Failed to delete.", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("❌ Server error deleting event type.", "error");
    }
  });
});

