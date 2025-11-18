(function () {
  const contacts = Array.isArray(window.initialContacts) ? window.initialContacts : [];
  const listEl = document.getElementById("contactList");
  const searchInput = document.getElementById("contactSearch");
  const detailPlaceholder = document.getElementById("contactDetailPlaceholder");
  const detailPanel = document.getElementById("contactDetailPanel");
  const detailName = document.querySelector("[data-contact-field='name']");
  const emailLink = document.getElementById("contactEmailLink");
  const phoneText = document.getElementById("contactPhoneText");
  const editForm = document.getElementById("contactEditForm");
  const createForm = document.getElementById("contactCreateForm");
  const emailBtn = document.getElementById("emailContactBtn");
  const deleteBtn = document.getElementById("deleteContactBtn");
  const functionsList = document.getElementById("contactFunctionsList");
  const bookingsList = document.getElementById("contactBookingsList");
  const functionBadge = document.getElementById("contactFunctionCount");
  const bookingBadge = document.getElementById("contactBookingCount");
  const modalEl = document.getElementById("contactCreateModal");
  const createModal = modalEl && window.bootstrap ? new window.bootstrap.Modal(modalEl) : null;
  const importInput = document.getElementById("contactImportInput");
  const optOutBadge = document.getElementById("contactOptOutBadge");
  const optOutCheckbox = document.getElementById("contactEditOptOut");
  const searchParams = new URLSearchParams(window.location.search || "");

  let filteredContacts = contacts.slice();
  let selectedId = null;
  let isLoading = false;

  function setDetailVisible(contact) {
    if (!detailPanel || !detailPlaceholder) return;
    if (!contact) {
      detailPanel.classList.add("d-none");
      detailPlaceholder.classList.remove("d-none");
      return;
    }
    detailPlaceholder.classList.add("d-none");
    detailPanel.classList.remove("d-none");
  }

  function renderList() {
    if (!listEl) return;
    if (!filteredContacts.length) {
      listEl.innerHTML = '<li class="list-group-item text-muted">No contacts found.</li>';
      return;
    }
    const items = filteredContacts
      .map(
        (contact) => {
          const isActive = String(contact.id) === String(selectedId || "");
          return `
        <li class="list-group-item list-group-item-action d-flex justify-content-between align-items-start contact-row ${
          isActive ? "active" : ""
        }"
            data-contact-id="${contact.id}">
          <div>
            <div class="fw-semibold">${contact.name}</div>
            <small class="text-muted d-block">${contact.email || "No email"}</small>
          </div>
          <div class="text-end">
            <small class="badge rounded-pill bg-light text-dark">${
              contact.function_count || 0
            } functions</small>
          </div>
        </li>`;
        }
      )
      .join("");
    listEl.innerHTML = items;
  }

  async function reloadContacts(preferredId) {
    try {
      const res = await fetch("/api/contacts");
      if (!res.ok) throw new Error("Failed to load contacts");
      const list = await res.json();
      contacts.length = 0;
      list.forEach((entry) => contacts.push(entry));
      filteredContacts = contacts.slice();
      renderList();
      if (contacts.length) {
        const target = preferredId || contacts[0].id;
        loadContact(target);
      } else {
        setDetailVisible(null);
      }
    } catch (err) {
      console.error(err);
      alert(err.message || "Unable to refresh contacts");
    }
  }

  function handleSearch() {
    const term = (searchInput.value || "").toLowerCase().trim();
    filteredContacts = contacts.filter((contact) => {
      if (!term) return true;
      return (
        (contact.name || "").toLowerCase().includes(term) ||
        (contact.email || "").toLowerCase().includes(term)
      );
    });
    renderList();
  }

  function setOptOutBadge(flag) {
    if (!optOutBadge) return;
    if (flag) {
      optOutBadge.textContent = "Survey opt-out";
      optOutBadge.classList.add("bg-warning", "text-dark");
      optOutBadge.classList.remove("bg-success");
    } else {
      optOutBadge.textContent = "Survey opt-in";
      optOutBadge.classList.add("bg-success", "text-dark");
      optOutBadge.classList.remove("bg-warning");
    }
  }

  function updateDetail(contact) {
    if (!contact) return;
    detailName.textContent = contact.name || "Unnamed contact";
    const email = contact.email || "";
    emailLink.textContent = email || "No email";
    emailLink.href = email ? `mailto:${email}` : "#";
    emailBtn.classList.toggle("disabled", !email);
    emailBtn.href = email ? `mailto:${email}` : "#";
    phoneText.textContent = contact.phone || "No phone number";
    document.getElementById("contactEditId").value = contact.id || contact.id_uuid || "";
    document.getElementById("contactEditName").value = contact.name || "";
    document.getElementById("contactEditCompany").value = contact.company || "";
    document.getElementById("contactEditEmail").value = email || "";
    document.getElementById("contactEditPhone").value = contact.phone || "";
    if (optOutCheckbox) optOutCheckbox.checked = Boolean(contact.feedback_opt_out);
    setOptOutBadge(Boolean(contact.feedback_opt_out));
  }

  function renderAssociations(listElRef, badgeEl, data, emptyText, formatter) {
    if (!listElRef || !badgeEl) return;
    badgeEl.textContent = data.length;
    if (!data.length) {
      listElRef.innerHTML = `<li class="text-muted">${emptyText}</li>`;
      return;
    }
    listElRef.innerHTML = data.map(formatter).join("");
  }

  function formatDate(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-NZ", { month: "short", day: "numeric", year: "numeric" });
  }

  function formatTime(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(`1970-01-01T${value}`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  }

  async function loadContact(contactId) {
    if (!contactId) return;
    if (isLoading) return;
    isLoading = true;
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/full`);
      if (!res.ok) throw new Error("Unable to load contact");
      const payload = await res.json();
      if (!payload?.success) throw new Error(payload.message || "Failed to load contact");
      selectedId = String(payload.contact.id);
      setDetailVisible(payload.contact);
      updateDetail(payload.contact);
      renderAssociations(
        functionsList,
        functionBadge,
        payload.functions || [],
        "No linked functions.",
        (fn) => `<li><a href="/functions/${fn.id_uuid}" class="text-decoration-none">${fn.event_name}</a>
          <small class="text-muted d-block">${formatDate(fn.event_date)} · ${fn.status || ""}</small></li>`
      );
      renderAssociations(
        bookingsList,
        bookingBadge,
        payload.bookings || [],
        "No matching bookings.",
        (bk) => `<li><a href="/calendar/restaurant/bookings/${bk.id}" class="text-decoration-none">${bk.party_name}</a>
          <small class="text-muted d-block">${formatDate(bk.booking_date)} ${formatTime(bk.booking_time)}</small></li>`
      );
      renderList();
    } catch (err) {
      console.error(err);
      alert(err.message || "Unable to load contact");
    } finally {
      isLoading = false;
    }
  }

  async function updateContact(formData) {
    if (!selectedId) return;
    const payload = Object.fromEntries(formData.entries());
    if (optOutCheckbox) {
      payload.feedback_opt_out = optOutCheckbox.checked;
    } else if (typeof payload.feedback_opt_out === "undefined") {
      payload.feedback_opt_out = false;
    }
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(selectedId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.message || "Update failed");
      const contact = contacts.find((c) => String(c.id) === String(selectedId));
      if (contact) {
        contact.name = payload.name;
        contact.email = payload.email;
        contact.phone = payload.phone;
        contact.company = payload.company;
        contact.feedback_opt_out = Boolean(payload.feedback_opt_out);
      }
      updateDetail({ ...contact, ...payload });
      renderList();
    } catch (err) {
      console.error(err);
      alert(err.message || "Unable to update contact");
    }
  }

  async function deleteContact() {
    if (!selectedId) return;
    const confirmName = prompt("Type DELETE to remove this contact:");
    if ((confirmName || "").trim().toUpperCase() !== "DELETE") return;
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(selectedId)}`, {
        method: "DELETE",
      });
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.message || "Delete failed");
      const idx = contacts.findIndex((c) => String(c.id) === String(selectedId));
      if (idx >= 0) contacts.splice(idx, 1);
      filteredContacts = contacts.slice();
      selectedId = null;
      setDetailVisible(null);
      renderList();
      if (contacts.length) {
        loadContact(contacts[0].id);
      }
    } catch (err) {
      console.error(err);
      alert(err.message || "Unable to delete contact");
    }
  }

  async function createContact(formData) {
    const payload = Object.fromEntries(formData.entries());
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.message || "Create failed");
      contacts.push({
        id: body.id,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        company: payload.company,
        function_count: 0,
        feedback_opt_out: false,
      });
      filteredContacts = contacts.slice();
      renderList();
      if (createModal) createModal.hide();
      formData.forEach((_, key) => {
        formData.set(key, "");
      });
      loadContact(body.id);
    } catch (err) {
      console.error(err);
      alert(err.message || "Unable to create contact");
    }
  }

  if (listEl) {
    listEl.addEventListener("click", (event) => {
      const item = event.target.closest(".contact-row");
      if (!item) return;
      const id = item.getAttribute("data-contact-id");
      loadContact(id);
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      handleSearch();
    });
  }

  if (editForm) {
    editForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(editForm);
      updateContact(formData);
    });
  }

  if (createForm) {
    createForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(createForm);
      createContact(formData);
      createForm.reset();
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      deleteContact();
    });
  }

  if (importInput) {
    importInput.addEventListener("change", () => {
      if (!importInput.files || !importInput.files.length) return;
      const file = importInput.files[0];
      const formData = new FormData();
      formData.append("contacts_file", file);
      fetch("/api/contacts/import", {
        method: "POST",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data.success) throw new Error(data.message || "Import failed");
          alert(`Import complete: ${data.created} added, ${data.updated} updated.`);
          importInput.value = "";
          reloadContacts();
        })
        .catch((err) => {
          console.error(err);
          alert(err.message || "Unable to import contacts");
        })
        .finally(() => {
          importInput.value = "";
        });
    });
  }

  handleSearch();
  if (contacts.length) {
    const initialSelected = searchParams.get("selected");
    loadContact(initialSelected || contacts[0].id);
  }
})();
