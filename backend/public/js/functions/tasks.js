(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const grid = document.querySelector(".task-cards-grid");
    const form = document.getElementById("taskForm");
    const modalEl = document.getElementById("taskModal");
    const addTaskBtn = document.getElementById("addTaskBtn");
    const functionId = window.fnContext?.id || window.functionId;
    const modal = createModalController(modalEl);
    const notifyCheckbox = document.getElementById("taskNotifyAssignee");
    modalEl?.querySelectorAll('[data-bs-dismiss="modal"]').forEach((btn) => {
      btn.addEventListener("click", () => modal?.hide());
    });

    function createModalController(el) {
      if (!el) return null;
      let instance = null;
      let fallbackBackdrop = null;

      const getInstance = () => {
        if (!window.bootstrap?.Modal) return null;
        if (!instance) {
          instance = bootstrap.Modal.getOrCreateInstance(el);
        }
        return instance;
      };

      const showFallback = () => {
        if (el.classList.contains("show")) return;
        el.classList.add("show");
        el.style.display = "block";
        el.removeAttribute("aria-hidden");
        fallbackBackdrop = document.createElement("div");
        fallbackBackdrop.className = "modal-backdrop fade show";
        document.body.appendChild(fallbackBackdrop);
        document.body.classList.add("modal-open");
        el.dataset.modalFallback = "true";
      };

      const hideFallback = () => {
        if (el.dataset.modalFallback !== "true") return;
        el.classList.remove("show");
        el.style.display = "none";
        el.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
        if (fallbackBackdrop) {
          fallbackBackdrop.remove();
          fallbackBackdrop = null;
        }
        delete el.dataset.modalFallback;
      };

      return {
        show() {
          const inst = getInstance();
          if (inst) inst.show();
          else showFallback();
        },
        hide() {
          const inst = getInstance();
          if (inst) inst.hide();
          else hideFallback();
        },
      };
    }

    function showToast(message, type = "info") {
      const toast = document.createElement("div");
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add("show"));
      setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    }

    function resetForm() {
      form?.reset();
      document.getElementById("taskId").value = "";
      const titleEl = form?.querySelector(".modal-title");
      if (titleEl) titleEl.textContent = "Add Task";
      if (notifyCheckbox) notifyCheckbox.checked = true;
    }

    addTaskBtn?.addEventListener("click", () => {
      resetForm();
      modal?.show();
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("taskId").value;
      const title = document.getElementById("taskTitle").value.trim();
      const description = document.getElementById("taskDescription").value.trim();
      const assigned_to = document.getElementById("taskAssignedTo").value || null;
      const due_at = document.getElementById("taskDueAt").value || null;
      if (!title) return showToast("Please enter a task title", "warning");
      const btn = form.querySelector("button[type='submit']");
      if (btn) btn.disabled = true;
      const url = id ? `/functions/tasks/${id}/update` : `/functions/${functionId}/tasks/new`;
      const send_email = !!notifyCheckbox?.checked;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description, assigned_to, due_at, send_email }),
        });
        const data = await res.json();
        if (data.success) {
          showToast(id ? "Task updated" : "Task created", "success");
          modal?.hide();
          setTimeout(() => window.location.reload(), 600);
        } else {
          showToast(data.error || "Failed to save task", "error");
        }
      } catch (err) {
        console.error("[Task Save] Error:", err);
        showToast("Error saving task", "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    grid?.addEventListener("click", (event) => {
      const card = event.target.closest(".task-card");
      if (!card) return;
      if (
        event.target.closest(".completeTaskBtn") ||
        event.target.closest(".deleteTaskBtn") ||
        event.target.closest(".reopenTaskBtn")
      ) {
        return;
      }
      const id = card.dataset.id;
      document.getElementById("taskId").value = id;
      document.getElementById("taskTitle").value = card.querySelector(".task-card-title")?.textContent.trim() || "";
      const desc = card.querySelector(".task-card-desc")?.textContent.trim() || "";
      document.getElementById("taskDescription").value = desc === "No details" ? "" : desc;
      const assignedSelect = document.getElementById("taskAssignedTo");
      const assignedName = card.querySelector(".task-card-meta div strong")?.nextSibling?.textContent?.trim() || "";
      if (assignedSelect) {
        const match = Array.from(assignedSelect.options).find(
          (opt) => opt.textContent.trim() === assignedName
        );
        assignedSelect.value = match ? match.value : "";
      }
      const dueText = card.querySelector(".task-card-meta div:nth-of-type(2)")?.textContent || "";
      const dueValue = dueText.replace("Due:", "").trim();
      if (dueValue && dueValue !== "-") {
        const parsed = new Date(dueValue);
        if (!isNaN(parsed)) document.getElementById("taskDueAt").value = parsed.toISOString().split("T")[0];
      }
      const titleEl = form?.querySelector(".modal-title");
      if (titleEl) titleEl.textContent = "Edit Task";
      if (notifyCheckbox) notifyCheckbox.checked = false;
      modal?.show();
    });

    grid?.addEventListener("click", async (event) => {
      const completeBtn = event.target.closest(".completeTaskBtn");
      const reopenBtn = event.target.closest(".reopenTaskBtn");
      const deleteBtn = event.target.closest(".deleteTaskBtn");
      if (completeBtn) {
        const id = completeBtn.dataset.id;
        try {
          const res = await fetch(`/functions/tasks/${id}/complete`, { method: "POST" });
          const data = await res.json();
          if (data.success) {
            showToast("Task marked as completed", "success");
            setTimeout(() => window.location.reload(), 600);
          } else showToast("Could not complete task", "warning");
        } catch (err) {
          console.error("[Complete Task] Error:", err);
          showToast("Error completing task", "error");
        }
      }
      if (reopenBtn) {
        const id = reopenBtn.dataset.id;
        try {
          const res = await fetch(`/functions/tasks/${id}/reopen`, { method: "POST" });
          const data = await res.json();
          if (data.success) {
            showToast("Task reopened", "success");
            setTimeout(() => window.location.reload(), 600);
          } else showToast("Could not reopen task", "warning");
        } catch (err) {
          console.error("[Reopen Task] Error:", err);
          showToast("Error reopening task", "error");
        }
      }
      if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        if (!confirm("Delete this task?")) return;
        try {
          const res = await fetch(`/functions/tasks/${id}`, { method: "DELETE" });
          const data = await res.json();
          if (data.success) {
            showToast("Task deleted", "success");
            deleteBtn.closest(".task-card")?.remove();
          } else showToast("Failed to delete task", "warning");
        } catch (err) {
          console.error("[Delete Task] Error:", err);
          showToast("Error deleting task", "error");
        }
      }
    });
  });
})();
