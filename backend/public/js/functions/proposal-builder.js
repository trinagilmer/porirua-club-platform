(() => {
  const isQuotePage = () => Boolean(document.getElementById("quoteMenuMount"));

  const parseMeta = (text = "") => {
    const meta = {};
    let match;
    const regex = /\[([a-z_]+):([^\]]+)\]/gi;
    while ((match = regex.exec(text))) {
      meta[match[1].toLowerCase()] = match[2];
    }
    const qtyMatch = text.match(/ x (\d+)/i);
    if (qtyMatch) meta.qty = Number(qtyMatch[1]);
    if (/\[excluded:true\]/i.test(text)) meta.excluded = true;
    return meta;
  };

  const cleanLabel = (text = "") => text.replace(/\[[^\]]+\]/g, "").replace(/\s{2,}/g, " ").trim();

  const isChildRow = (text = "") => /^\s*(Choice:|Add-on:)/i.test(text);

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

    const textarea = document.createElement("textarea");
    textarea.className = "form-control section-content";
    textarea.rows = 4;
    textarea.dataset.role = "section-content";
    textarea.value = content;
    li.appendChild(textarea);
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
    const global = window.quoteActiveItemIds;
    if (isQuotePage() && global instanceof Set && global.size) {
      return Array.from(global);
    }
    if (builder._proposalItemIds instanceof Set && builder._proposalItemIds.size) {
      return Array.from(builder._proposalItemIds);
    }
    if (global instanceof Set && global.size) {
      return Array.from(global);
    }
    return [];
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

  const buildSummary = (builder) => {
    const summary = builder.querySelector("[data-role='menu-summary']");
    const source = builder.querySelector("[data-role='items-source']");
    const emptyState = builder.querySelector("[data-role='menu-empty']");
    builder._proposalItemIds = new Set();
    if (!summary) return;
    summary.innerHTML = "";

    const listItems = source ? Array.from(source.querySelectorAll("li")) : [];
    if (!listItems.length) {
      if (emptyState) emptyState.classList.remove("d-none");
      return;
    }
    if (emptyState) emptyState.classList.add("d-none");

    const categories = new Map();
    let currentMenu = null;

    listItems.forEach((li) => {
      const id = Number(li.dataset.id);
      const raw = (li.textContent || "").trim();
      const meta = parseMeta(raw);
      const text = cleanLabel(raw);
      const price = Number(li.dataset.price || 0);

      if (!isChildRow(text)) {
        const category = meta.category || "Uncategorised";
        if (!categories.has(category)) categories.set(category, []);
        currentMenu = {
          title: text.replace(/^Menu:\s*/i, ""),
          items: [],
          basePrice: price,
        };
        categories.get(category).push(currentMenu);
        builder._proposalItemIds.add(id);
        return;
      }

      if (!currentMenu || meta.excluded) return;
      builder._proposalItemIds.add(id);
      const qty = meta.qty ? Number(meta.qty) : 1;
      const priceEach = meta.base != null ? Number(meta.base) : qty > 0 ? price / qty : price;
      currentMenu.items.push({
        name: text.replace(/^(Choice:|Add-on:)\s*/i, "").replace(/\s+x\s+\d+.*/, "").trim(),
        qty,
        priceEach,
        total: price,
      });
    });

    if (!categories.size) {
      summary.innerHTML = '<div class="alert alert-secondary mb-0">No items currently selected.</div>';
      return;
    }

    categories.forEach((menus, category) => {
      const card = document.createElement("div");
      card.className = "proposal-summary-card";

      const header = document.createElement("div");
      header.className = "hdr";
      header.textContent = category;
      card.appendChild(header);

      const body = document.createElement("div");
      body.className = "body";
      menus.forEach((menu) => {
        const block = document.createElement("div");
        block.className = "menu-block";
        block.innerHTML = `<div class="menu-title">${menu.title}</div>`;
        if (menu.basePrice) {
          block.innerHTML += `<div class="menu-base">Base Price: $${Number(menu.basePrice).toFixed(2)}</div>`;
        }

        if (menu.items.length) {
          const headRow = document.createElement("div");
          headRow.className = "menu-row head";
          headRow.innerHTML = "<div>Item</div><div>Qty</div><div>Each</div><div>Total</div>";
          block.appendChild(headRow);
          menu.items.forEach((item) => {
            const row = document.createElement("div");
            row.className = "menu-row";
            row.innerHTML = `
              <div>${item.name}</div>
              <div>${item.qty}</div>
              <div>$${Number(item.priceEach).toFixed(2)}</div>
              <div>$${Number(item.total).toFixed(2)}</div>
            `;
            block.appendChild(row);
          });
        } else {
          const empty = document.createElement("div");
          empty.className = "menu-empty";
          empty.textContent = "No visible choices for this menu.";
          block.appendChild(empty);
        }

        body.appendChild(block);
      });

      card.appendChild(body);
      summary.appendChild(card);
    });
  };

  const initBuilder = (builder) => {
    if (!builder) return;
    const functionId = builder.dataset.functionId;
    const proposalId = builder.dataset.proposalId ? Number(builder.dataset.proposalId) : null;
    const sectionsList = builder.querySelector("[data-role='sections-list']");
    const templatePicker = builder.querySelector("[data-role='template-picker']");
    const addTemplateBtn = builder.querySelector("[data-role='add-template']");
    const includeContactInputs = builder.querySelectorAll("[data-role='include-contact']");
    const sectionsEmpty = builder.querySelector("[data-role='sections-empty']");
    const termsInput = builder.querySelector("[data-role='terms-input']");
    const previewBtn = builder.querySelector("[data-role='preview-btn']");
    const printBtn = builder.querySelector("[data-role='print-btn']");
    const saveBtn = builder.querySelector("[data-role='save-btn']");
    const termsPicker = builder.querySelector("[data-role='terms-picker']");
    const loadTermsBtn = builder.querySelector("[data-role='load-terms']");

    if (sectionsList && !sectionsList.querySelector("[data-role='section-index']")) {
      ensureEmptySection(sectionsList);
    }

    buildSummary(builder);

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

    addTemplateBtn?.addEventListener("click", async () => {
      const templateId = templatePicker?.value;
      if (!templateId) return;
      addTemplateBtn.disabled = true;
      try {
        const res = await fetch(`/settings/note-templates/api/${templateId}`);
        const payload = await res.json();
        if (!payload.success) throw new Error(payload.error || "Failed to load template");
        if (sectionsEmpty) sectionsEmpty.remove();
        appendSection(sectionsList, payload.data?.content || "");
        templatePicker.value = "";
      } catch (err) {
        console.error(err);
        notify(err.message || "Failed to insert template.", "danger");
      } finally {
        addTemplateBtn.disabled = false;
      }
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
      const sections = Array.from(builder.querySelectorAll("[data-role='section-content']")).map((textarea) => ({
        content: textarea.value,
      }));
      const payload = {
        includeItemIds: collectItemIds(builder),
        includeContactIds: includeContacts,
        sections,
        terms: termsInput?.value || "",
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
        notify("Proposal settings saved.", "success");
      } catch (err) {
        console.error(err);
        notify(err.message || "Failed to save proposal.", "danger");
      } finally {
        saveBtn.disabled = false;
      }
    });

    loadTermsBtn?.addEventListener("click", () => {
      if (!termsPicker || !termsInput) return;
      const id = Number(termsPicker.value);
      if (!id) return;
      const library = window.proposalTermsLibrary || [];
      const term = library.find((entry) => Number(entry.id) === id);
      if (!term) {
        notify("Unable to load the selected terms.", "warning");
        return;
      }
      termsInput.value = term.content || "";
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-proposal-builder]").forEach((builder) => initBuilder(builder));
  });
})();
