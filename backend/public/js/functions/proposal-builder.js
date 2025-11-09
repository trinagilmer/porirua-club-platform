(() => {
  const createSectionItem = (content = "") => {
    const li = document.createElement("li");
    li.className = "proposal-section-item border rounded-3 p-3 mb-3";

    const head = document.createElement("div");
    head.className = "d-flex justify-content-between align-items-center mb-2";
    const label = document.createElement("span");
    label.className = "proposal-section-label fw-semibold";
    label.innerHTML = 'Section <span data-role="section-index"></span>';
    head.appendChild(label);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-sm btn-outline-danger";
    removeBtn.dataset.role = "remove-section";
    removeBtn.textContent = "Remove";
    head.appendChild(removeBtn);
    li.appendChild(head);

    const editor = document.createElement("div");
    editor.className = "form-control section-content";
    editor.dataset.role = "section-content";
    editor.contentEditable = "true";
    editor.innerHTML = content || "";
    li.appendChild(editor);
    return li;
  };

  const ensureEmptySection = (list) => {
    if (!list) return;
    if (list.querySelector("[data-role='section-index']")) return;
    let placeholder = list.querySelector("[data-role='sections-empty']");
    if (!placeholder) {
      placeholder = document.createElement("li");
      placeholder.dataset.role = "sections-empty";
      placeholder.className = "proposal-section-empty text-muted fst-italic";
      placeholder.textContent = "No sections yet.";
      list.appendChild(placeholder);
    }
    placeholder.classList.remove("d-none");
  };

  const hideEmptySection = (list) => {
    if (!list) return;
    const placeholder = list.querySelector("[data-role='sections-empty']");
    if (placeholder) placeholder.remove();
  };

  const renumberSections = (list) => {
    if (!list) return;
    list.querySelectorAll("[data-role='section-index']").forEach((el, idx) => {
      el.textContent = idx + 1;
    });
  };

  const appendSection = (list, content = "") => {
    if (!list) return;
    hideEmptySection(list);
    const item = createSectionItem(content);
    list.appendChild(item);
    renumberSections(list);
  };

  const collectItemIds = (builder) => {
    if (window.quoteProposalItemIds instanceof Set && window.quoteProposalItemIds.size) {
      return Array.from(window.quoteProposalItemIds);
    }
    if (builder._proposalItemIds instanceof Set && builder._proposalItemIds.size) {
      return Array.from(builder._proposalItemIds);
    }
    if (window.savedProposalState?.includeItemIds?.length) {
      return [...window.savedProposalState.includeItemIds];
    }
    return [];
  };

  const ensureSelectionSet = (builder) => {
    if (!(window.quoteProposalItemIds instanceof Set)) {
      window.quoteProposalItemIds = new Set(window.savedProposalState?.includeItemIds || []);
    }
    if (
      window.quoteProposalItemIds instanceof Set &&
      window.quoteProposalItemIds.size === 0 &&
      builder._proposalItemIds instanceof Set
    ) {
      builder._proposalItemIds.forEach((id) => window.quoteProposalItemIds.add(id));
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

  const ingestItems = (builder) => {
    const source = builder.querySelector("[data-role='items-source']");
    const listItems = source ? Array.from(source.querySelectorAll("li")) : [];
    builder._proposalItemIds = new Set();
    if (!listItems.length) {
      ensureSelectionSet(builder);
      return;
    }
    listItems.forEach((li) => {
      const id = Number(li.dataset.id);
      if (Number.isInteger(id)) builder._proposalItemIds.add(id);
    });
    ensureSelectionSet(builder);
  };

  const initBuilder = (builder) => {
    if (!builder) return;
    const functionId = builder.dataset.functionId;
    const proposalId = builder.dataset.proposalId ? Number(builder.dataset.proposalId) : null;
    const sectionsList = builder.querySelector("[data-role='sections-list']");
    const notePicker = builder.querySelector("[data-role='note-picker']");
    const addNoteBtn = builder.querySelector("[data-role='add-note']");
    const includeContactInputs = builder.querySelectorAll("[data-role='include-contact']");
    const termCheckboxes = builder.querySelectorAll("[data-role='term-select']");
    const termsInput = builder.querySelector("[data-role='terms-input']");
    const previewBtn = builder.querySelector("[data-role='preview-btn']");
    const printBtn = builder.querySelector("[data-role='print-btn']");
    const saveBtn = builder.querySelector("[data-role='save-btn']");
    const noteLibrary = window.functionNotesLibrary || [];
    const noteMap = new Map(noteLibrary.map((note) => [String(note.id), note]));

    if (sectionsList && !sectionsList.querySelector("[data-role='section-index']")) {
      ensureEmptySection(sectionsList);
    }

    ingestItems(builder);

    const syncTermIds = () => {
      const ids = Array.from(termCheckboxes || [])
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);
      window.savedProposalState = window.savedProposalState || {};
      window.savedProposalState.termIds = ids;
    };
    termCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", syncTermIds);
    });
    syncTermIds();

    sectionsList?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-role='remove-section']");
      if (!trigger) return;
      const item = trigger.closest(".proposal-section-item");
      if (item) item.remove();
      if (!sectionsList.querySelector(".proposal-section-item")) {
        ensureEmptySection(sectionsList);
      } else {
        renumberSections(sectionsList);
      }
    });

    addNoteBtn?.addEventListener("click", () => {
      if (!notePicker || !sectionsList) return;
      const noteId = notePicker.value;
      if (!noteId) return;
      const note = noteMap.get(String(noteId));
      if (!note) {
        notify("Unable to load the selected note.", "warning");
        return;
      }
      hideEmptySection(sectionsList);
      const noteBody = note.rendered_content || note.rendered_html || note.content || "";
      appendSection(sectionsList, noteBody);
      notePicker.value = "";
    });

    previewBtn?.addEventListener("click", () => {
      if (!proposalId) return;
      window.open(`/functions/${functionId}/proposal/preview`, "_blank");
    });

    printBtn?.addEventListener("click", () => {
      if (!proposalId) return;
      const win = window.open(`/functions/${functionId}/proposal/preview`, "_blank");
      win?.print?.();
    });

    saveBtn?.addEventListener("click", async () => {
      const includeContacts = Array.from(includeContactInputs || [])
        .filter((input) => input.checked)
        .map((input) => input.value);
      const sections = Array.from(builder.querySelectorAll("[data-role='section-content']")).map((editor) => ({
        content: editor.innerHTML,
      }));
      const currentTermIds = Array.from(window.savedProposalState?.termIds || []);
      const payload = {
        includeItemIds: collectItemIds(builder),
        includeContactIds: includeContacts,
        sections,
        terms: termsInput?.value || "",
        termIds: currentTermIds,
      };

      saveBtn.disabled = true;
      try {
        const res = await fetch(`/functions/${functionId}/proposal/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Save failed.");
        window.savedProposalState = payload;
        notify("Proposal settings saved.", "success");
      } catch (err) {
        console.error(err);
        notify(err.message || "Failed to save proposal.", "danger");
      } finally {
        saveBtn.disabled = false;
      }
    });

    // Standard terms are combined server-side based on the selected checkboxes.
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-proposal-builder]").forEach((builder) => initBuilder(builder));
  });
})();
