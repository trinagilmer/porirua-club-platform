(() => {
  const editorId = "termContentEditor";

  const notify = (message, type = "info") => {
    if (window.toast) {
      window.toast({ message, type });
    } else if (window.showToast) {
      window.showToast(message, type);
    } else {
      alert(message);
    }
  };

  const initTinyEditor = (initialHtml = "") =>
    new Promise((resolve) => {
      if (!window.tinymce) {
        console.warn("TinyMCE not available; using plain textarea.");
        resolve(false);
        return;
      }

      window.tinymce.remove(`#${editorId}`);
      window.tinymce.init({
        selector: `#${editorId}`,
        height: 320,
        menubar: false,
        plugins: "lists link table paste",
        toolbar:
          "undo redo | blocks | bold italic underline | bullist numlist | link table | removeformat",
        paste_data_images: true,
        table_default_attributes: { border: "1" },
        setup(editor) {
          editor.on("init", () => {
            editor.setContent(initialHtml || "");
            resolve(true);
          });
          editor.on("change keyup", () => {
            const hiddenInput = document.getElementById("termContent");
            if (hiddenInput) hiddenInput.value = editor.getContent();
          });
        },
      });
    });

  const setEditorContent = (html = "") => {
    const hiddenInput = document.getElementById("termContent");
    const textarea = document.getElementById(editorId);
    if (hiddenInput) hiddenInput.value = html || "";
    if (textarea) textarea.value = html || "";
    const instance = window.tinymce?.get(editorId);
    if (instance) instance.setContent(html || "");
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const terms = window.proposalTermsData || [];
    const listEl = document.getElementById("termsList");
    const form = document.getElementById("termForm");
    const idInput = document.getElementById("termId");
    const nameInput = document.getElementById("termName");
    const categoryInput = document.getElementById("termCategory");
    const hiddenContent = document.getElementById("termContent");
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

    await initTinyEditor(hiddenContent?.value || "");

    const resetForm = () => {
      idInput.value = "";
      nameInput.value = "";
      categoryInput.value = "";
      setEditorContent("");
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
      setEditorContent(term.content || "");
      defaultInput.checked = Boolean(term.is_default);
      deleteBtn.disabled = false;
      titleEl.textContent = `Editing: ${term.name}`;
      updatedEl.textContent = term.updated_at
        ? `Updated ${new Date(term.updated_at).toLocaleString()}`
        : "";
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
      const currentContent =
        window.tinymce?.get(editorId)?.getContent() || document.getElementById(editorId)?.value || "";
      hiddenContent.value = currentContent;

      const payload = {
        name: nameInput.value,
        category: categoryInput.value,
        content: hiddenContent.value,
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
