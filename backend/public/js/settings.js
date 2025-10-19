console.log("⚙️ Settings JS loaded");

// Selectors
const modal = document.getElementById("settingsEventTypeModal");
const openBtn = document.getElementById("addEventTypeBtn");
const closeBtn = document.getElementById("closeSettingsEventTypeModal");
const cancelBtn = document.getElementById("settingsCancelEventTypeBtn");
const saveBtn = document.getElementById("settingsSaveEventTypeBtn");
const inputField = document.getElementById("settingsNewEventTypeName");
/* =========================================================
   🧁 Toast Notifications
========================================================= */
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return alert(message); // fallback if container missing

  const toast = document.createElement("div");
  toast.className = `toast-message ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Remove after animation
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

// 🧭 Helpers
function openModal() {
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  inputField.value = "";
  inputField.focus();
}

function closeModal() {
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

// Event bindings
openBtn?.addEventListener("click", openModal);
closeBtn?.addEventListener("click", closeModal);
cancelBtn?.addEventListener("click", closeModal);

// 💾 Save event type
saveBtn?.addEventListener("click", async () => {
  const name = inputField.value.trim();
  if (!name) return alert("Please enter a name.");

  try {
    const res = await fetch("/settings/event-types/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const data = await res.json();
    if (data.success) {
      showToast("✅ Event type added!", "success");
      location.reload();
    } else {
      showToast("⚠️ Failed to add: " + (data.message || ""), "error");
    }
  } catch (err) {
    console.error("❌ Add error:", err);
    showToast("❌ Could not add event type.");
  }
});

// 🖱️ Close modal if user clicks outside
window.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
/* =========================================================
   ✏️ EDIT EVENT TYPE
========================================================= */
const editModal = document.getElementById("settingsEventTypeEditModal");
const editNameField = document.getElementById("settingsEditEventTypeName");
const editIdField = document.getElementById("settingsEditEventTypeId");
const editCloseBtn = document.getElementById("closeSettingsEventTypeEditModal");
const editCancelBtn = document.getElementById("settingsCancelEditEventTypeBtn");
const editSaveBtn = document.getElementById("settingsSaveEditEventTypeBtn");

// Open modal when clicking "Edit"
document.querySelectorAll(".edit-event-type").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const id = e.target.dataset.id;
    const currentName = e.target.closest("li").querySelector(".event-type-name").textContent.trim();

    editIdField.value = id;
    editNameField.value = currentName;
    editModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  });
});

// Close modal
function closeEditModal() {
  editModal.classList.add("hidden");
  document.body.style.overflow = "";
}

[editCloseBtn, editCancelBtn].forEach((btn) =>
  btn?.addEventListener("click", closeEditModal)
);

// Save changes
editSaveBtn?.addEventListener("click", async () => {
  const id = editIdField.value;
  const name = editNameField.value.trim();
  if (!id || !name) return alert("Please enter a name.");

  try {
    const res = await fetch("/settings/event-types/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });

    const data = await res.json();
    if (data.success) {
      showToast("✅ Event type updated!", "success");

      location.reload();
    } else {
      showToast("⚠️ Failed to update: " + (data.message || ""), "error");
    }
  } catch (err) {
    console.error("❌ Edit error:", err);
    showToast("❌ Could not update event type.", "error");
  }
});

// Close when clicking outside
window.addEventListener("click", (e) => {
  if (e.target === editModal) closeEditModal();
});
/* =========================================================
   🗑️ DELETE EVENT TYPE
========================================================= */
document.querySelectorAll(".delete-event-type").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const id = e.target.dataset.id;
    const name = e.target.closest("li").textContent.trim();

    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch("/settings/event-types/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();
      if (data.success) {
        showToast("🗑️ Event type deleted.", "success");
        location.reload();
      } else {
        showToast("⚠️ Failed to delete: " + (data.message || ""), "error");
      }
    } catch (err) {
      console.error("❌ Delete error:", err);
      showToast("❌ Could not delete event type.", "error");
    }
  });
});
/* =========================================================
   🏠 ROOMS / SPACES CRUD
========================================================= */

// 🧭 Selectors
const roomAddModal = document.getElementById("settingsRoomAddModal");
const roomOpenBtn = document.getElementById("addRoomBtn");
const roomCloseBtn = document.getElementById("closeSettingsRoomAddModal");
const roomCancelBtn = document.getElementById("settingsCancelRoomBtn");
const roomSaveBtn = document.getElementById("settingsSaveRoomBtn");

const roomEditModal = document.getElementById("settingsRoomEditModal");
const editRoomName = document.getElementById("settingsEditRoomName");
const editRoomCapacity = document.getElementById("settingsEditRoomCapacity");
const editRoomId = document.getElementById("settingsEditRoomId");
const closeEditRoomBtn = document.getElementById("closeSettingsRoomEditModal");
const cancelEditRoomBtn = document.getElementById("settingsCancelEditRoomBtn");
const saveEditRoomBtn = document.getElementById("settingsSaveEditRoomBtn");

// 🧭 Open Add Modal
function openAddRoomModal() {
  roomAddModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  document.getElementById("settingsNewRoomName").value = "";
  document.getElementById("settingsNewRoomCapacity").value = "";
}

function closeAddRoomModal() {
  roomAddModal.classList.add("hidden");
  document.body.style.overflow = "";
}

roomOpenBtn?.addEventListener("click", openAddRoomModal);
roomCloseBtn?.addEventListener("click", closeAddRoomModal);
roomCancelBtn?.addEventListener("click", closeAddRoomModal);

// 💾 Save new room
roomSaveBtn?.addEventListener("click", async () => {
  const name = document.getElementById("settingsNewRoomName").value.trim();
  const capacity = document.getElementById("settingsNewRoomCapacity").value.trim() || null;

  if (!name) return showToast("⚠️ Please enter a room name.", "warning");

  try {
    const res = await fetch("/settings/spaces/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, capacity }),
    });

    const data = await res.json();
    if (data.success) {
      showToast("✅ Room added successfully!", "success");
      location.reload();
    } else {
      showToast("⚠️ Failed to add room: " + (data.message || ""), "error");
    }
  } catch (err) {
    console.error("❌ Add room error:", err);
    showToast("❌ Could not add room.", "error");
  }
});

// ✏️ Edit Room
document.querySelectorAll(".edit-room").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    const id = btn.dataset.id;
    const name = li.querySelector(".room-name").textContent.trim();
    const capacity = btn.dataset.capacity || "";

    editRoomId.value = id;
    editRoomName.value = name;
    editRoomCapacity.value = capacity;

    roomEditModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  });
});

function closeEditRoomModal() {
  roomEditModal.classList.add("hidden");
  document.body.style.overflow = "";
}

[closeEditRoomBtn, cancelEditRoomBtn].forEach((btn) =>
  btn?.addEventListener("click", closeEditRoomModal)
);

// 💾 Save edited room
saveEditRoomBtn?.addEventListener("click", async () => {
  const id = editRoomId.value;
  const name = editRoomName.value.trim();
  const capacity = editRoomCapacity.value.trim() || null;

  if (!id || !name) return showToast("⚠️ Please fill all fields.", "warning");

  try {
    const res = await fetch("/settings/spaces/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, capacity }),
    });

    const data = await res.json();
    if (data.success) {
      showToast("✅ Room updated successfully!", "success");
      location.reload();
    } else {
      showToast("⚠️ Failed to update room.", "error");
    }
  } catch (err) {
    console.error("❌ Edit room error:", err);
    showToast("❌ Could not update room.", "error");
  }
});

/* =========================================================
   🗑️ DELETE ROOM (Improved UX)
========================================================= */
document.querySelectorAll(".delete-room").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const id = e.target.dataset.id;
    const name = e.target.closest("li").textContent.trim();

    if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch("/settings/spaces/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      // Check for non-JSON responses (like HTML 404s)
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.error("Unexpected response:", text);
        return showToast("⚠️ Unexpected response from server.", "error");
      }

      if (res.ok && data.success) {
        showToast(`🗑️ "${name}" deleted successfully.`, "success");
        setTimeout(() => location.reload(), 500);
      } else if (data.message?.includes("linked to one or more functions")) {
        // 🔹 Specific foreign key error
        showToast(`⚠️ "${name}" is in use by existing functions and cannot be deleted.`, "warning");
      } else {
        showToast(`⚠️ Failed to delete "${name}": ${data.message || "Unknown error"}`, "error");
      }
    } catch (err) {
      console.error("❌ Delete error:", err);
      showToast("❌ Could not delete room. Please try again later.", "error");
    }
  });
});


