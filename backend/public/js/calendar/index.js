(function () {
  const STATUS_LABELS = {
    lead: "Lead",
    qualified: "Qualified",
    confirmed: "Confirmed",
    balance_due: "Balance due",
    completed: "Completed",
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
      const timeLabel = allDay ? "All day" : startDate.toLocaleTimeString("en-NZ", optionsTime);
      return `${startDate.toLocaleDateString("en-NZ", optionsDate)} - ${timeLabel}`;
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
      const functionsToggle = document.querySelector('[data-calendar-type="functions"]');
      if (functionsToggle) functionsToggle.checked = true;
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
    };

    let printStyleEl = null;
    const calendarViewLabel = document.getElementById("calendarViewLabel");
    const calendarPrintTitle = document.getElementById("calendarPrintTitle");
    const exitDayViewBtn = document.getElementById("exitDayViewBtn");

    const monthFormatter = new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric" });
    const dayFormatter = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "long", year: "numeric" });
    const weekMonthFormatter = new Intl.DateTimeFormat("en-NZ", { month: "short" });

    function formatWeekRange(start, endInclusive) {
      const sameMonth = start.getMonth() === endInclusive.getMonth();
      const sameYear = start.getFullYear() === endInclusive.getFullYear();
      const startMonth = weekMonthFormatter.format(start);
      const endMonth = weekMonthFormatter.format(endInclusive);
      const startDay = start.getDate();
      const endDay = endInclusive.getDate();
      const year = endInclusive.getFullYear();
      if (sameMonth) {
        return `${startMonth} ${startDay}-${endDay} ${year}`;
      }
      if (sameYear) {
        return `${startMonth} ${startDay} - ${endMonth} ${endDay} ${year}`;
      }
      return `${startMonth} ${startDay} ${start.getFullYear()} - ${endMonth} ${endDay} ${year}`;
    }

    function getViewTitle(view) {
      const type = view.type || "";
      const start = view.currentStart ? new Date(view.currentStart) : null;
      const end = view.currentEnd ? new Date(view.currentEnd) : null;
      if (!start) return view.title || "";
      if (type === "dayGridMonth") {
        return monthFormatter.format(start);
      }
      if (type === "timeGridDay" || type === "dayGridDay") {
        return dayFormatter.format(start);
      }
      if (type === "timeGridWeek" || type === "dayGridWeek") {
        const endInclusive = end ? new Date(end.getTime() - 1) : start;
        return formatWeekRange(start, endInclusive);
      }
      return view.title || monthFormatter.format(start);
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
      document.body.setAttribute("data-calendar-print-orientation", orientation);
    }

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
        right: "dayGridMonth,timeGridWeek,timeGridDay",
      },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit" },
      slotDuration,
      slotLabelInterval: slotDuration,
      scrollTime: "07:00:00",
      views: {
        timeGridDay: {
          slotDuration,
          slotLabelInterval: slotDuration,
        },
      },
      eventDisplay: "block",
      datesSet: (arg) => {
        const view = arg.view;
        const viewType = view.type;
        const isDayView = viewType === "timeGridDay";
        setPrintOrientation(viewType);
        const title = getViewTitle(view);
        if (calendarViewLabel) {
          calendarViewLabel.textContent = title;
        }
        if (calendarPrintTitle) {
          calendarPrintTitle.textContent = title;
        }
        if (exitDayViewBtn) {
          exitDayViewBtn.classList.toggle("d-none", !isDayView);
        }
        calendarEl.classList.toggle("calendar-day-mode", isDayView);
      },
      events: {
        url: "/calendar/events",
        method: "GET",
        extraParams: () => {
          const params = {};
          if (state.rooms.length) {
            params.rooms = state.rooms.join(",");
          }
          if (state.types.size) {
            params.include = Array.from(state.types).join(",");
          }
          return params;
        },
        failure: (error) => {
          console.error("Calendar events failed", error);
        },
      },
      eventClick: (info) => {
        info.jsEvent?.preventDefault();
        openEventModal(info.event);
      },
      eventDidMount: (info) => {
        const el = info.el;
        if (!el) return;
        el.classList.add("calendar-event-card");
        const accent = info.event.backgroundColor || info.event.borderColor || "#6bb4de";
        el.style.setProperty("--calendar-event-accent", accent);
        const titleEl = el.querySelector(".fc-event-title");
        if (titleEl) {
          titleEl.style.whiteSpace = "normal";
        }
      },
    });

    calendar.render();
    setPrintOrientation(calendar.view?.type || "dayGridMonth");

    function openEventModal(event) {
      if (!(modal && modalFields)) {
        if (event.extendedProps?.detailUrl) {
          window.location.href = event.extendedProps.detailUrl;
        }
        return;
      }
      if (modalFields.title) modalFields.title.textContent = event.title || "Function";
      if (modalFields.schedule)
        modalFields.schedule.textContent = formatDateRange(
          event.start,
          event.end || event.extendedProps?.endLabel,
          event.allDay
        );
      if (modalFields.room)
        modalFields.room.textContent = event.extendedProps?.roomName || "Unassigned room";
      if (modalFields.status) {
        const label = event.extendedProps?.status || "";
        modalFields.status.textContent = STATUS_LABELS[label] || label || "—";
      }
      if (modalFields.contact) {
        modalFields.contact.textContent = event.extendedProps?.contactName || "Not assigned";
      }
      if (modalFields.attendees) {
        modalFields.attendees.textContent = `${event.extendedProps?.attendees || 0} guests`;
      }
      if (modalFields.link && event.extendedProps?.detailUrl) {
        modalFields.link.href = event.extendedProps.detailUrl;
      }
      modal.show();
    }

    const typeInputs = document.querySelectorAll("[data-calendar-type]");
    typeInputs.forEach((input) => {
      const type = input.getAttribute("data-calendar-type");
      if (!type) return;
      input.addEventListener("change", () => {
        if (input.checked) {
          state.types.add(type);
        } else {
          state.types.delete(type);
        }
        ensureAtLeastFunctions(state.types);
        calendar.refetchEvents();
      });
    });

    const roomButtons = document.querySelectorAll(".calendar-room-btn");
    function setRoomButtonState(btn, active) {
      if (!btn) return;
      if (active) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    function syncRoomsFromButtons(shouldRefetch = true) {
      if (!roomButtons.length) {
        state.rooms = [];
        if (shouldRefetch) calendar.refetchEvents();
        return;
      }
      const activeButtons = Array.from(roomButtons).filter((btn) => btn.classList.contains("active"));
      if (!activeButtons.length) {
        roomButtons.forEach((btn) => setRoomButtonState(btn, true));
        state.rooms = [];
      } else if (activeButtons.length === roomButtons.length) {
        state.rooms = [];
      } else {
        state.rooms = activeButtons.map((btn) => btn.dataset.roomId).filter(Boolean);
      }
      if (shouldRefetch) calendar.refetchEvents();
    }
    roomButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextState = !btn.classList.contains("active");
        setRoomButtonState(btn, nextState);
        syncRoomsFromButtons(true);
      });
    });
    syncRoomsFromButtons(false);

    const resetButton = document.getElementById("calendarClearFilters");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        roomButtons.forEach((btn) => setRoomButtonState(btn, true));
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

    window.addEventListener("beforeprint", () => {
      calendar.updateSize();
    });
    window.addEventListener("afterprint", () => {
      calendar.updateSize();
    });
  });
})();
