(function () {
  const STATUS_LABELS = {
    lead: "Lead",
    qualified: "Qualified",
    confirmed: "Confirmed",
    balance_due: "Balance due",
    completed: "Completed",
    pending: "Pending",
    seated: "Seated",
    cancelled: "Cancelled",
    published: "Published",
    scheduled: "Scheduled",
  };

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function minutesToDuration(minutes) {
    const mins = Math.max(5, Math.min(Number(minutes) || 30, 240));
    const hoursPart = Math.floor(mins / 60);
    const minutesPart = mins % 60;
    return `${pad(hoursPart)}:${pad(minutesPart)}:00`;
  }

  function formatDateRange(start, end, allDay) {
    if (!start) return "--";
    const optionsDate = { weekday: "short", month: "short", day: "numeric" };
    const optionsTime = { hour: "2-digit", minute: "2-digit" };
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    if (allDay || !endDate) {
      const label = allDay ? "All day" : startDate.toLocaleTimeString("en-NZ", optionsTime);
      return `${startDate.toLocaleDateString("en-NZ", optionsDate)} - ${label}`;
    }
    const sameDay = endDate.toDateString() === startDate.toDateString();
    if (sameDay) {
      return `${startDate.toLocaleDateString("en-NZ", optionsDate)} - ${startDate.toLocaleTimeString(
        "en-NZ",
        optionsTime
      )} - ${endDate.toLocaleTimeString("en-NZ", optionsTime)}`;
    }
    return `${startDate.toLocaleDateString("en-NZ", optionsDate)} ${startDate.toLocaleTimeString(
      "en-NZ",
      optionsTime
    )} -> ${endDate.toLocaleDateString("en-NZ", optionsDate)} ${endDate.toLocaleTimeString("en-NZ", optionsTime)}`;
  }

  function ensureAtLeastFunctions(selectedTypes) {
    if (!selectedTypes.size) {
      selectedTypes.add("functions");
      const toggle = document.querySelector('[data-calendar-type="functions"]');
      if (toggle) toggle.checked = true;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const calendarEl = document.getElementById("functionCalendar");
    if (!calendarEl || !window.FullCalendar) return;

    const configMinutes = Number(window.calendarConfig?.daySlotMinutes);
    const slotMinutes = Math.max(5, Math.min(Number.isFinite(configMinutes) ? configMinutes : 30, 240));
    const slotDuration = minutesToDuration(slotMinutes);

    const modalEl = document.getElementById("calendarEventModal");
    const modal =
      modalEl && window.bootstrap && window.bootstrap.Modal ? new window.bootstrap.Modal(modalEl) : null;
    const modalFields = modalEl
      ? {
          title: modalEl.querySelector('[data-calendar-field="title"]'),
          schedule: modalEl.querySelector('[data-calendar-field="schedule"]'),
          room: modalEl.querySelector('[data-calendar-field="room"]'),
          status: modalEl.querySelector('[data-calendar-field="status"]'),
          contact: modalEl.querySelector('[data-calendar-field="contact"]'),
          attendees: modalEl.querySelector('[data-calendar-field="attendees"]'),
          link: modalEl.querySelector('[data-calendar-action="open-function"]'),
        }
      : {};

    const state = {
      rooms: [],
      types: new Set(["functions"]),
      pendingAdd: null,
      selectedEvent: null,
    };

    const CONVERT_OPTIONS = {
      functions: ["restaurant", "entertainment"],
      restaurant: ["functions"],
      entertainment: ["functions"],
    };

    let currentEvents = [];
    let printStyleEl = null;

    function formatAddLabel(dateObj) {
      if (!dateObj) return "";
      return dateObj.toLocaleString("en-NZ", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    function openAddModal(dateInfo) {
      if (!addModal) {
        calendar.changeView("timeGridDay", dateInfo.dateStr);
        return;
      }
      const isoDate = dateInfo.dateStr.split("T")[0];
      const timePart = dateInfo.dateStr.includes("T") ? dateInfo.dateStr.split("T")[1].slice(0, 5) : "00:00";
      state.pendingAdd = {
        isoDate,
        time: timePart,
      };
      if (addModalDateField) {
        addModalDateField.textContent = formatAddLabel(dateInfo.date);
      }
      addModal.show();
    }

    function handleAddAction(target) {
      if (!state.pendingAdd) return;
      const params = new URLSearchParams();
      if (state.pendingAdd.isoDate) {
        if (target === "functions") params.set("event_date", state.pendingAdd.isoDate);
        else params.set("prefill_date", state.pendingAdd.isoDate);
      }
      if (state.pendingAdd.time) {
        if (target === "functions") params.set("start_time", state.pendingAdd.time);
        else params.set("prefill_time", state.pendingAdd.time);
      }
      let baseUrl = "/";
      if (target === "functions") {
        baseUrl = "/functions/new";
      } else if (target === "restaurant") {
        baseUrl = "/calendar/restaurant";
      } else if (target === "entertainment") {
        baseUrl = "/settings/entertainment";
      }
      const url = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
      window.location.href = url;
    }

    function setupConvertOptions(eventType) {
      if (!convertGroup) return;
      const allowed = CONVERT_OPTIONS[eventType] || [];
      convertGroup.classList.toggle("d-none", !allowed.length);
      convertButtons.forEach((btn) => {
        const target = btn.getAttribute("data-convert-target");
        btn.classList.toggle("d-none", !allowed.includes(target));
      });
    }

    async function handleConversion(targetType) {
      if (!state.selectedEvent) return;
      if (!targetType) return;
      const confirmLabel = `Convert "${state.selectedEvent.title || "this booking"}" to ${targetType}?`;
      if (!window.confirm(confirmLabel)) return;
      try {
        const res = await fetch("/calendar/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceType: state.selectedEvent.type,
            sourceId: state.selectedEvent.id,
            targetType,
          }),
        });
        const payload = await res.json();
        if (!payload.success) throw new Error(payload.error || "Conversion failed");
        if (payload.detailUrl) {
          window.location.href = payload.detailUrl;
          return;
        }
        if (addModal) addModal.hide();
        if (modal) modal.hide();
        calendar.refetchEvents();
      } catch (err) {
        console.error("Conversion failed", err);
        window.alert(err.message || "Unable to convert");
      }
    }

    const monthFormatter = new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric" });
    const dayFormatter = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "long", year: "numeric" });
    const shortMonthFormatter = new Intl.DateTimeFormat("en-NZ", { month: "short" });

    const calendarViewLabel = document.getElementById("calendarViewLabel");
    const calendarPrintTitle = document.getElementById("calendarPrintTitle");
    const exitDayViewBtn = document.getElementById("exitDayViewBtn");
    const printWrapper = document.querySelector(".calendar-print-wrapper");
    const printMonthBody = document.getElementById("calendarPrintMonthBody");
    const printWeekRow = document.getElementById("calendarPrintWeekRow");
    const printDayList = document.getElementById("calendarPrintDayList");
    const printDayMeta = document.getElementById("calendarPrintDayMeta");
    const addModalEl = document.getElementById("calendarAddModal");
    const addModal = addModalEl && window.bootstrap && window.bootstrap.Modal ? new window.bootstrap.Modal(addModalEl) : null;
    const addModalDateField = addModalEl ? addModalEl.querySelector("[data-calendar-add-date]") : null;
    const addTypeButtons = addModalEl ? addModalEl.querySelectorAll("[data-calendar-add-target]") : [];
    const addViewDayBtn = document.getElementById("calendarAddViewDay");
    const convertGroup = document.getElementById("calendarConvertGroup");
    const convertButtons = convertGroup ? convertGroup.querySelectorAll("[data-convert-target]") : [];

    const calendar = new window.FullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      height: "auto",
      expandRows: true,
      firstDay: 1,
      navLinks: true,
      nowIndicator: true,
      dayMaxEventRows: true,
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,dayGridWeek,timeGridDay",
      },
      eventDisplay: "block",
      slotDuration,
      slotLabelInterval: slotDuration,
      slotMinTime: "08:00:00",
      slotMaxTime: "24:00:00",
      scrollTime: "08:00:00",
      views: {
        timeGridDay: {
          slotDuration,
          slotLabelInterval: slotDuration,
        },
        dayGridWeek: {
          dayHeaderFormat: { weekday: "short" },
        },
      },
      events: {
        url: "/calendar/events",
        method: "GET",
        extraParams: () => {
          const params = {};
          if (state.rooms.length) params.rooms = state.rooms.join(",");
          if (state.types.size) params.include = Array.from(state.types).join(",");
          return params;
        },
        failure: (error) => console.error("Calendar events failed", error),
      },
      eventsSet: (events) => {
        currentEvents = Array.isArray(events) ? events : [];
        updatePrintLayout(calendar.view);
      },
      eventClick: (info) => {
        info.jsEvent?.preventDefault();
        if (modal && modalFields.title) {
          if (modalFields.title) modalFields.title.textContent = info.event.title || "Function";
          if (modalFields.schedule)
            modalFields.schedule.textContent = formatDateRange(info.event.start, info.event.end, info.event.allDay);
          const extended = info.event.extendedProps || {};
          if (modalFields.room) modalFields.room.textContent = extended.roomName || "Unassigned";
          if (modalFields.status) {
            const label = extended.status || "";
            modalFields.status.textContent = STATUS_LABELS[label] || label || label || "--";
          }
          const eventType = extended.type || "functions";
          if (modalFields.contact) {
            if (eventType === "restaurant") {
              modalFields.contact.textContent = extended.contact_email || extended.contact_phone || info.event.title;
            } else if (eventType === "entertainment") {
              modalFields.contact.textContent = extended.organiser || "Entertainment";
            } else {
              modalFields.contact.textContent = extended.contactName || "Not assigned";
            }
          }
          if (modalFields.attendees) {
            if (eventType === "restaurant") {
              const size = extended.partySize || 0;
              modalFields.attendees.textContent = `${size} guests`;
            } else if (eventType === "entertainment") {
              if (extended.price) {
                const priceLabel = new Intl.NumberFormat("en-NZ", {
                  style: "currency",
                  currency: extended.currency || "NZD",
                  minimumFractionDigits: 2,
                }).format(Number(extended.price));
                modalFields.attendees.textContent = `${priceLabel} entry`;
              } else {
                modalFields.attendees.textContent = "Public event";
              }
            } else {
              const attendees = extended.attendees || 0;
              modalFields.attendees.textContent = `${attendees} guests`;
            }
          }
          if (modalFields.link && extended.detailUrl) {
            modalFields.link.href = extended.detailUrl;
            modalFields.link.classList.remove("d-none");
          } else if (modalFields.link) {
            modalFields.link.classList.add("d-none");
          }
          state.selectedEvent = {
            id: extended.sourceId || info.event.id,
            type: eventType,
            title: info.event.title || "Booking",
          };
          setupConvertOptions(eventType);
          modal.show();
        } else if (info.event.extendedProps?.detailUrl) {
          window.location.href = info.event.extendedProps.detailUrl;
        }
      },
      dateClick: (info) => {
        if (info?.dateStr) {
          openAddModal(info);
        }
      },
      datesSet: (arg) => {
        const view = arg.view;
        const viewType = view.type;
        const title = getViewTitle(view);
        setPrintOrientation(viewType);
        if (calendarViewLabel) calendarViewLabel.textContent = title;
        if (calendarPrintTitle) calendarPrintTitle.textContent = title;
        if (exitDayViewBtn) exitDayViewBtn.classList.toggle("d-none", viewType !== "timeGridDay");
        calendarEl.classList.toggle("calendar-day-mode", viewType === "timeGridDay");
        updatePrintLayout(view);
      },
    });

    calendar.render();
    setPrintOrientation(calendar.view?.type || "dayGridMonth");
    updatePrintLayout(calendar.view);

    addTypeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-calendar-add-target");
        handleAddAction(target);
      });
    });
    if (addViewDayBtn) {
      addViewDayBtn.addEventListener("click", () => {
        if (!state.pendingAdd?.isoDate) return;
        if (addModal) addModal.hide();
        calendar.changeView("timeGridDay", state.pendingAdd.isoDate);
      });
    }
    convertButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-convert-target");
        handleConversion(target);
      });
    });

    const roomButtons = document.querySelectorAll(".calendar-room-btn");
    roomButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const active = !btn.classList.contains("active");
        btn.classList.toggle("active", active);
        syncRoomsFromButtons(true);
      });
    });
    syncRoomsFromButtons(false);

    const typeInputs = document.querySelectorAll("[data-calendar-type]");
    typeInputs.forEach((input) => {
      const type = input.getAttribute("data-calendar-type");
      if (!type) return;
      input.addEventListener("change", () => {
        if (input.checked) state.types.add(type);
        else state.types.delete(type);
        ensureAtLeastFunctions(state.types);
        calendar.refetchEvents();
      });
    });

    const resetButton = document.getElementById("calendarClearFilters");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        roomButtons.forEach((btn) => btn.classList.add("active"));
        syncRoomsFromButtons(false);
        state.types = new Set(["functions"]);
        typeInputs.forEach((input) => {
          input.checked = input.getAttribute("data-calendar-type") === "functions";
        });
        calendar.refetchEvents();
      });
    }

    const printBtn = document.getElementById("calendarPrintBtn");
    if (printBtn) {
      printBtn.addEventListener("click", () => {
        window.print();
      });
    }

    if (exitDayViewBtn) {
      exitDayViewBtn.addEventListener("click", () => {
        calendar.changeView("dayGridMonth");
      });
    }

    function syncRoomsFromButtons(refetch) {
      const activeButtons = Array.from(roomButtons).filter((btn) => btn.classList.contains("active"));
      if (!activeButtons.length || activeButtons.length === roomButtons.length) {
        state.rooms = [];
      } else {
        state.rooms = activeButtons.map((btn) => btn.dataset.roomId).filter(Boolean);
      }
      if (refetch) calendar.refetchEvents();
    }

    function setPrintOrientation(viewType) {
      const orientation = viewType === "timeGridDay" ? "portrait" : "landscape";
      const margin = viewType === "timeGridDay" ? "10mm 7mm 7mm 7mm" : "7mm";
      if (!printStyleEl) {
        printStyleEl = document.createElement("style");
        printStyleEl.id = "calendar-print-style";
        document.head.appendChild(printStyleEl);
      }
      printStyleEl.textContent = `@media print { @page { size: A4 ${orientation}; margin: ${margin}; } }`;
    }

    function getViewTitle(view) {
      const start = view.currentStart ? new Date(view.currentStart) : null;
      const end = view.currentEnd ? new Date(view.currentEnd) : null;
      if (!start) return view.title || "";
      if (view.type === "dayGridMonth") return monthFormatter.format(start);
      if (view.type === "timeGridDay") return dayFormatter.format(start);
      if (view.type === "dayGridWeek") return formatWeekRange(start, end || start);
      return view.title || "";
    }

    function formatWeekRange(start, endExclusive) {
      const end = new Date(endExclusive || start);
      end.setDate(end.getDate() - 1);
      const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
      if (sameMonth) {
        return `${shortMonthFormatter.format(start)} ${start.getDate()}-${end.getDate()} ${start.getFullYear()}`;
      }
      return `${shortMonthFormatter.format(start)} ${start.getDate()} ${start.getFullYear()} - ${shortMonthFormatter.format(
        end
      )} ${end.getDate()} ${end.getFullYear()}`;
    }

    function normaliseDateKey(dateInput) {
      const date = new Date(dateInput);
      date.setHours(0, 0, 0, 0);
      return date.toISOString().split("T")[0];
    }

    function groupEventsByDate(events = []) {
      const map = new Map();
      events.forEach((event) => {
        if (!event.start) return;
        const key = normaliseDateKey(event.start);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(event);
      });
      return map;
    }

    function updatePrintLayout(view) {
      if (!printWrapper) return;
      const eventsByDate = groupEventsByDate(currentEvents);
      printWrapper.classList.remove("print-mode-month", "print-mode-week", "print-mode-day");
      if (view.type === "dayGridMonth") {
        populatePrintMonth(view, eventsByDate);
        printWrapper.classList.add("print-mode-month");
      } else if (view.type === "dayGridWeek") {
        populatePrintWeek(view, eventsByDate);
        printWrapper.classList.add("print-mode-week");
      } else if (view.type === "timeGridDay") {
        populatePrintDay(view, eventsByDate);
        printWrapper.classList.add("print-mode-day");
      }
    }

    function populatePrintMonth(view, eventsByDate) {
      if (!printMonthBody) return;
      printMonthBody.innerHTML = "";
      const start = new Date(view.currentStart);
      const end = new Date(view.currentEnd);
      const cursor = new Date(start);
      while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() - 1);
      while (cursor < end || cursor.getDay() !== 1) {
        const row = document.createElement("tr");
        for (let i = 0; i < 7; i++) {
          const cell = document.createElement("td");
          cell.classList.add("print-day-cell");
          cell.innerHTML = `<div class="print-day-number">${cursor.getDate()}</div>`;
          appendEventList(cell, eventsByDate.get(normaliseDateKey(cursor)) || [], { showTime: true });
          row.appendChild(cell);
          cursor.setDate(cursor.getDate() + 1);
        }
        printMonthBody.appendChild(row);
        if (cursor >= end && cursor.getDay() === 1) break;
      }
    }

    function populatePrintWeek(view, eventsByDate) {
      if (!printWeekRow) return;
      printWeekRow.innerHTML = "";
      const cursor = new Date(view.currentStart);
      while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() - 1);
      for (let i = 0; i < 7; i++) {
        const cell = document.createElement("td");
        cell.classList.add("print-day-cell");
        cell.innerHTML = `<div class="print-day-number">${cursor.getDate()}</div>`;
        appendEventList(cell, eventsByDate.get(normaliseDateKey(cursor)) || [], { showTime: false });
        printWeekRow.appendChild(cell);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    function populatePrintDay(view, eventsByDate) {
      if (!printDayList || !printDayMeta) return;
      printDayList.innerHTML = "";
      printDayMeta.textContent = getViewTitle(view);
      const dayKey = normaliseDateKey(view.currentStart);
      const events = (eventsByDate.get(dayKey) || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
      if (!events.length) {
        const li = document.createElement("li");
        li.textContent = "No events scheduled.";
        printDayList.appendChild(li);
        return;
      }
      events.forEach((event) => {
        const li = document.createElement("li");
        const timeText = event.allDay
          ? "All day"
          : new Date(event.start).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
        const attendees = Number(event.extendedProps?.attendees || 0);
        const room = event.extendedProps?.roomName || "";
        li.innerHTML = `<strong>${timeText}</strong> ${event.title || ""}${
          attendees ? ` (${attendees} guests)` : ""
        } <span class="print-room">${room}</span>`;
        printDayList.appendChild(li);
      });
    }

    function appendEventList(cell, events, { showTime }) {
      if (!events.length) return;
      const list = document.createElement("ul");
      list.classList.add("print-event-list");
      events.forEach((event) => {
        const item = document.createElement("li");
        const timeText =
          showTime && !event.allDay
            ? new Date(event.start).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })
            : "";
        const attendees = Number(event.extendedProps?.attendees || 0);
        const parts = [];
        if (timeText) parts.push(`<strong>${timeText}</strong>`);
        parts.push(event.title || "");
        if (attendees) parts.push(`(${attendees} guests)`);
        item.innerHTML = parts.filter(Boolean).join(" ");
        list.appendChild(item);
      });
      cell.appendChild(list);
    }
  });
})();
