import { showToast } from "./_shared.js";

console.log("🏠 Spaces JS loaded");

// Bootstrap modal instances
const addModalEl = document.getElementById("settingsRoomAddModal");
const editModalEl = document.getElementById("settingsRoomEditModal");
const addModal = addModalEl ? new bootstrap.Modal(addModalEl) : null;
const editModal = editModalEl ? new bootstrap.Modal(editModalEl) : null;

// Add form fields
const roomNameInput = document.getElementById("settingsNewRoomName");
const roomCapacityInput = document.getElementById("settingsNewRoomCapacity");
const saveAddBtn = document.getElementById("settingsSaveRoomBtn");

// Edit form fields
const editRoomNameInput = document.getElementById("settingsEditRoomName");
const editRoomCapacityInput = document.getElementById("settingsEditRoomCapacity");
const editRoomIdInput = document.getElementById("settingsEditRoomId");
const saveEditBtn = document.getElementById("settingsSaveEditRoomBtn");

// ✅ ADD ROOM
saveAddBtn?.addEventListener("click", async () => {
  const name = roomNameInput.value.trim();
  const capacity = roomCapacityInput.value.trim();

  if (!name) return showToast("Room name is required.", "warning");

  try {
    const res = await fetch("/settings/spaces/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, capacity }),
    });
    const data = await res.json();

    if (data.success) {
      showToast("✅ Room added successfully!");
      addModal?.hide();
      setTimeout(() => location.reload(), 600);
    } else {
      showToast(data.message || "Failed to add room.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("❌ Server error adding room.", "error");
  }
});

// ✅ EDIT ROOM
document.querySelectorAll(".edit-room").forEach(btn => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.id;
    const name = btn.dataset.name;
    const capacity = btn.dataset.capacity;

    editRoomIdInput.value = id;
    editRoomNameInput.value = name || "";
    editRoomCapacityInput.value = capacity || "";

    editModal?.show();
  });
});

saveEditBtn?.addEventListener("click", async () => {
  const id = editRoomIdInput.value;
  const name = editRoomNameInput.value.trim();
  const capacity = editRoomCapacityInput.value.trim();

  if (!name) return showToast("Please enter a room name.", "warning");

  try {
    const res = await fetch("/settings/spaces/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, capacity }),
    });
    const data = await res.json();

    if (data.success) {
      showToast("✅ Room updated!");
      editModal?.hide();
      setTimeout(() => location.reload(), 600);
    } else {
      showToast(data.message || "Failed to update room.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("❌ Server error updating room.", "error");
  }
});

// ✅ DELETE ROOM
document.querySelectorAll(".delete-room").forEach(btn => {
  btn.addEventListener("click", async () => {
    const id = btn.dataset.id;
    const item = btn.closest(".list-group-item");
    const name = item?.querySelector("strong")?.textContent.trim();

    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch("/settings/spaces/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();

      if (data.success) {
        showToast("🗑️ Room deleted.");
        setTimeout(() => location.reload(), 500);
      } else {
        showToast(data.message || "Failed to delete.", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("❌ Server error deleting room.", "error");
    }
  });
});

