(() => {
  const formatTimestamp = (value) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "";
    }
  };

  const notify = (message, type = "info") => {
    if (window.toast) {
      window.toast({ message, type });
    } else if (window.showToast) {
      window.showToast(message, type);
    } else {
      alert(message);
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    const terms = window.proposalTermsData || [];
    const listEl = document.getElementById("termsList");
    const form = document.getElementById("termForm");
    const idInput = document.getElementById("termId");
    const nameInput = document.getElementById("termName");
    const categoryInput = document.getElementById("termCategory");
    const contentInput = document.getElementById("termContent");
    const defaultInput = document.getElementById("termDefault");
    const deleteBtn = document.getElementById("termDeleteBtn");
    const resetBtn = document.getElementById("termResetBtn");
    const saveBtn = document.getElementById("termSaveBtn");
    const newBtn = document.getElementById("newTermBtn");
    const titleEl = document.getElementById("termFormTitle");
    const updatedEl = document.getElementById("termLastUpdated");

    const clearActive = () => {
      listEl?.querySelectorAll(".list-group-item").forEach((btn) => btn.classList.remove("active"));
    };

    const resetForm = () => {
      idInput.value = "";
      nameInput.value = "";
      categoryInput.value = "";
      contentInput.value = "";
      defaultInput.checked = false;
      deleteBtn.disabled = true;
      titleEl.textContent = "Create Terms Block";
      updatedEl.textContent = "";
      clearActive();
    };

    const loadTerm = (term) => {
      if (!term) return;
      idInput.value = term.id;
      nameInput.value = term.name || "";
      categoryInput.value = term.category || "";
      contentInput.value = term.content || "";
      defaultInput.checked = Boolean(term.is_default);
      deleteBtn.disabled = false;
      titleEl.textContent = `Editing: ${term.name}`;
      updatedEl.textContent = term.updated_at ? `Updated ${formatTimestamp(term.updated_at)}` : "";
    };

    listEl?.addEventListener("click", (event) => {
      const target = event.target.closest("[data-term-id]");
      if (!target) return;
      const id = Number(target.dataset.termId);
      const term = terms.find((t) => Number(t.id) === id);
      if (!term) return;
      clearActive();
      target.classList.add("active");
      loadTerm(term);
    });

    newBtn?.addEventListener("click", resetForm);
    resetBtn?.addEventListener("click", resetForm);

    deleteBtn?.addEventListener("click", async () => {
      const id = Number(idInput.value);
      if (!id || deleteBtn.disabled) return;
      if (!confirm("Delete this terms block? This cannot be undone.")) return;
      deleteBtn.disabled = true;
      try {
        const res = await fetch(`/settings/proposal-terms/api/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Delete failed.");
        notify("Terms block deleted.", "success");
        window.location.reload();
      } catch (err) {
        console.error(err);
        notify(err.message || "Failed to delete terms.", "danger");
      } finally {
        deleteBtn.disabled = false;
      }
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!nameInput.value.trim()) {
        notify("Please provide a name for the terms block.", "warning");
        return;
      }
      const payload = {
        name: nameInput.value,
        category: categoryInput.value,
        content: contentInput.value,
        is_default: defaultInput.checked,
      };
      const id = idInput.value;
      const method = id ? "PATCH" : "POST";
      const endpoint = id ? `/settings/proposal-terms/api/${id}` : "/settings/proposal-terms/api";
      saveBtn.disabled = true;
      try {
        const res = await fetch(endpoint, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Save failed.");
        notify("Terms saved.", "success");
        window.location.reload();
      } catch (err) {
        console.error(err);
        notify(err.message || "Failed to save terms.", "danger");
      } finally {
        saveBtn.disabled = false;
      }
    });
  });
})();
