// =========================================================
// 📋 FUNCTION TASKS CONTROLLER (Card Layout)
// Compatible with current function-tasks.ejs
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.querySelector(".task-cards-grid");
  const form = document.getElementById("taskForm");
  const modalEl = document.getElementById("taskModal");
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;
  const addTaskBtn = document.getElementById("addTaskBtn");
  const functionId = window.fnContext?.id || window.functionId;

  // ---------------------------------------------------------
  // 🧩 Toast Utility
  // ---------------------------------------------------------
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ---------------------------------------------------------
  // 🧰 Reset Modal Form
  // ---------------------------------------------------------
  function resetForm() {
    form.reset();
    form.querySelector(".modal-title").textContent = "Add Task";
    document.getElementById("taskId").value = "";
  }

  addTaskBtn?.addEventListener("click", () => {
    resetForm();
    modal?.show();
  });

  // ---------------------------------------------------------
  // 💾 Save Task (Create or Update)
  // ---------------------------------------------------------
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("taskId").value;
    const title = document.getElementById("taskTitle").value.trim();
    const description = document.getElementById("taskDescription")?.value.trim() || null;
    const assigned_to = document.getElementById("taskAssignedTo").value || null;
    const due_at = document.getElementById("taskDueAt").value || null;

    if (!title) return showToast("⚠️ Please enter a task title", "warning");

    const saveBtn = form.querySelector("button[type='submit']");
    saveBtn.disabled = true;

    const url = id
      ? `/functions/tasks/${id}/update`
      : `/functions/${functionId}/tasks/new`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, assigned_to, due_at }),
      });

      const data = await res.json();
      if (data.success) {
        showToast(id ? "✅ Task updated" : "✅ Task created", "success");
        modal?.hide();
        setTimeout(() => location.reload(), 600);
      } else {
        showToast("❌ Failed to save task", "error");
      }
    } catch (err) {
      console.error("[Task Save] Error:", err);
      showToast("⚠️ Error saving task", "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

// ---------------------------------------------------------
// ✏️ Edit Task (Card Click)
// ---------------------------------------------------------
grid?.addEventListener("click", (e) => {
  // Ignore clicks on action buttons
  if (
    e.target.closest(".completeTaskBtn") ||
    e.target.closest(".deleteTaskBtn") ||
    e.target.closest(".reopenTaskBtn")
  ) {
    return;
  }

  // Detect click on title or card
  const card = e.target.closest(".task-card");
  if (!card) return;

  const id = card.dataset.id;
  const title = card.querySelector(".task-card-title")?.textContent.trim() || "";
  let description = card.querySelector(".task-card-desc")?.textContent.trim() || "";
  if (description === "No details") description = "";

  const assigned = card.querySelector(".task-card-meta span strong")?.nextSibling?.textContent?.trim() || "";
  const dueAt = card.querySelector(".task-card-meta span:nth-of-type(2)")?.textContent?.replace("Due:", "").trim() || "";

  // Fill modal
  document.getElementById("taskId").value = id;
  document.getElementById("taskTitle").value = title;
  document.getElementById("taskDescription").value = description;

  const assignedSelect = document.getElementById("taskAssignedTo");
  if (assignedSelect && assigned) {
    const match = [...assignedSelect.options].find(opt => opt.textContent.trim() === assigned);
    assignedSelect.value = match ? match.value : "";
  }

  if (dueAt && dueAt !== "—") {
    const parsed = new Date(dueAt);
    if (!isNaN(parsed)) document.getElementById("taskDueAt").value = parsed.toISOString().split("T")[0];
  }

  // Show modal
  form.querySelector(".modal-title").textContent = "Edit Task";
  modal?.show();
});

  // ---------------------------------------------------------
  // ✅ Complete / 🔁 Reopen / 🗑️ Delete Task
  // ---------------------------------------------------------
  grid?.addEventListener("click", async (e) => {
    const completeBtn = e.target.closest(".completeTaskBtn");
    const reopenBtn = e.target.closest(".reopenTaskBtn");
    const deleteBtn = e.target.closest(".deleteTaskBtn");

    // ✅ COMPLETE TASK
    if (completeBtn) {
      const id = completeBtn.dataset.id;
      try {
        const res = await fetch(`/functions/tasks/${id}/complete`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
          showToast("✅ Task marked as completed", "success");
          setTimeout(() => location.reload(), 600);
        } else showToast("⚠️ Could not complete task", "warning");
      } catch (err) {
        console.error("[Complete Task] Error:", err);
        showToast("❌ Error completing task", "error");
      }
    }

    // 🔁 REOPEN TASK
    if (reopenBtn) {
      const id = reopenBtn.dataset.id;
      try {
        const res = await fetch(`/functions/tasks/${id}/reopen`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
          showToast("🔄 Task reopened", "success");
          setTimeout(() => location.reload(), 600);
        } else showToast("⚠️ Could not reopen task", "warning");
      } catch (err) {
        console.error("[Reopen Task] Error:", err);
        showToast("❌ Error reopening task", "error");
      }
    }

    // 🗑️ DELETE TASK
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      if (!confirm("Delete this task?")) return;
      try {
        const res = await fetch(`/functions/tasks/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          showToast("🗑️ Task deleted", "success");
          deleteBtn.closest(".task-card").remove();
        } else {
          showToast("⚠️ Failed to delete task", "warning");
        }
      } catch (err) {
        console.error("[Delete Task] Error:", err);
        showToast("❌ Error deleting task", "error");
      }
    }
  });
});