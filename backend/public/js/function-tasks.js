// Wait until the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  // === DOM Elements ===
  const table = document.getElementById("taskTableBody");
  const form = document.getElementById("taskForm");
  const modalEl = document.getElementById("taskModal");
  const modal = new bootstrap.Modal(modalEl);
  const functionId = window.functionId; // defined in function-tasks.ejs

  // === Helper: Reset modal form ===
  function resetForm() {
    form.reset();
    form.querySelector(".modal-title").textContent = "Add Task";
    document.getElementById("taskId").value = "";
  }

  // === Open "Add Task" modal ===
  document.getElementById("addTaskBtn").addEventListener("click", resetForm);

  // === Save Task (Add or Edit) ===
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
      const id = document.getElementById("taskId").value;
  const title = document.getElementById("taskTitle").value.trim();
  const description = document.getElementById("taskDescription").value || null; // ✅ new line
  const assigned_to = document.getElementById("taskAssignedTo").value || null;
  const due_at = document.getElementById("taskDueAt").value || null;

    // if id exists → edit, else → create
    const url = id
      ? `/functions/tasks/${id}/update`
      : `/functions/${functionId}/tasks/new`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, assigned_to, due_at }),
    });

    const data = await res.json();
    if (data.success) {
      modal.hide();
      location.reload();
    } else {
      alert("❌ " + data.error);
    }
  });

  // === Edit Task ===
  table.addEventListener("click", (e) => {
    const btn = e.target.closest(".editTaskBtn");
    if (!btn) return;

    const row = btn.closest("tr");
    const title = row.children[0].textContent.trim();
    const assignedTo = row.children[1].textContent.trim() || "";
    const dueAt = row.children[3].textContent.trim();

    document.getElementById("taskId").value = row.dataset.id;
    document.getElementById("taskTitle").value = title;
    document.getElementById("taskAssignedTo").value = assignedTo;

    // Safe date parsing
    let formattedDate = "";
    if (dueAt && !["—", "null", "undefined"].includes(dueAt.toLowerCase())) {
      const parsed = new Date(dueAt);
      if (!isNaN(parsed)) formattedDate = parsed.toISOString().split("T")[0];
    }
    document.getElementById("taskDueAt").value = formattedDate;

    form.querySelector(".modal-title").textContent = "Edit Task";
    modal.show();
  });

  // === Complete / Delete Buttons ===
  table.addEventListener("click", async (e) => {
    const completeBtn = e.target.closest(".completeTaskBtn");
    const deleteBtn = e.target.closest(".deleteTaskBtn");

    // ✅ COMPLETE TASK
    if (completeBtn) {
      const id = completeBtn.dataset.id;
      try {
        const res = await fetch(`/functions/tasks/${id}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        });

        const data = await res.json();
        if (data.success) {
          // optional quick visual feedback
          const row = completeBtn.closest("tr");
          row.querySelector(".status-badge").textContent = "Completed";
          row.querySelector(".status-badge").className =
            "status-badge status-completed";
        } else {
          alert("❌ Could not complete task: " + data.error);
        }
      } catch (err) {
        console.error("❌ [Complete Task] Error:", err);
      }
    }

    // ✅ DELETE TASK
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      if (confirm("Delete this task?")) {
        await fetch(`/functions/tasks/${id}`, { method: "DELETE" });
        location.reload();
      }
    }
  });
}); // 👈 only one closing brace + parenthesis

