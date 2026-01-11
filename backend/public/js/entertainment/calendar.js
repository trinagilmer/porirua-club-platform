(function () {
  function getInitialView(value) {
    const cleaned = String(value || "").toLowerCase();
    if (cleaned === "week") return "dayGridWeek";
    if (cleaned === "agenda" || cleaned === "list") return "listWeek";
    if (cleaned === "pinboard") return "pinboard";
    return "dayGridMonth";
  }

  function getTypeFromToggle() {
    const checked = document.querySelector('input[name="ent-mode"]:checked');
    return checked ? checked.value : "entertainment";
  }

  function setActiveButton(buttons, activeKey) {
    buttons.forEach((button) => {
      const key = button.getAttribute("data-ent-view");
      button.classList.toggle("active", key === activeKey);
    });
  }

  function viewKeyFromType(viewType) {
    if (viewType === "dayGridWeek") return "week";
    if (viewType === "listWeek") return "agenda";
    return "month";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const calendarEl = document.getElementById("entertainmentCalendar");
    if (!calendarEl || !window.FullCalendar) return;

    const isEmbed = calendarEl.dataset.embed === "1";
    const titleEl = document.getElementById("entCalendarTitle");
    const viewButtons = document.querySelectorAll("[data-ent-view]");
    const navButtons = document.querySelectorAll("[data-cal-nav]");
    const typeToggles = document.querySelectorAll('input[name="ent-mode"]');
    const calendarShell = document.querySelector(".ent-calendar-shell");
    const pinboardShell = document.querySelector(".ent-pinboard-shell");
    const pinboardViews = document.querySelectorAll(".ent-pinboard");

    let currentType = calendarEl.dataset.initialType || getTypeFromToggle();
    const initialView = getInitialView(calendarEl.dataset.initialView);

    function parseColor(value) {
      if (!value) return null;
      const hexMatch = String(value).trim().match(/^#?([0-9a-fA-F]{6})$/);
      if (hexMatch) {
        const hex = hexMatch[1];
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
        };
      }
      const rgbMatch = String(value).match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
      if (rgbMatch) {
        return {
          r: Number(rgbMatch[1]),
          g: Number(rgbMatch[2]),
          b: Number(rgbMatch[3]),
        };
      }
      return null;
    }

    function isDark(colorValue) {
      const rgb = parseColor(colorValue);
      if (!rgb) return false;
      const luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
      return luminance < 140;
    }

    function setViewVisibility(showPinboard) {
      if (calendarShell) calendarShell.classList.toggle("d-none", showPinboard);
      if (pinboardShell) pinboardShell.classList.toggle("d-none", !showPinboard);
    }

    function updatePinboard() {
      pinboardViews.forEach((view) => {
        const mode = view.getAttribute("data-mode");
        view.classList.toggle("d-none", mode !== currentType);
      });
    }

    const calendar = new window.FullCalendar.Calendar(calendarEl, {
      initialView,
      height: "auto",
      expandRows: true,
      firstDay: 1,
      navLinks: true,
      nowIndicator: true,
      eventDisplay: "block",
      headerToolbar: false,
      dayMaxEventRows: true,
      eventTimeFormat: { hour: "numeric", minute: "2-digit", meridiem: "short" },
      events: (info, success, failure) => {
        const params = new URLSearchParams();
        if (info.startStr) params.set("start", info.startStr.slice(0, 10));
        if (info.endStr) params.set("end", info.endStr.slice(0, 10));
        if (currentType) params.set("type", currentType);
        fetch(`/entertainment/events?${params.toString()}`)
          .then((resp) => {
            if (!resp.ok) throw new Error("Unable to load events");
            return resp.json();
          })
          .then((events) => success(events))
          .catch((err) => {
            console.error("[Entertainment] Calendar fetch failed:", err);
            failure(err);
          });
      },
      datesSet: (arg) => {
        if (titleEl) titleEl.textContent = arg.view?.title || "";
        setActiveButton(viewButtons, viewKeyFromType(arg.view?.type));
      },
      eventClick: (info) => {
        if (info.event.url) {
          info.jsEvent?.preventDefault();
          const targetUrl = isEmbed ? `${info.event.url}?embed=1` : info.event.url;
          window.location.href = targetUrl;
        }
      },
      eventDidMount: (info) => {
        const isAgenda = info.view?.type === "listWeek";
        const bgColor =
          info.event.extendedProps?.event_color || info.event.backgroundColor || info.event.color;
        if (isAgenda) {
          const dot = info.el.querySelector(".fc-list-event-dot");
          if (dot) {
            dot.style.setProperty("border-color", "#cbd5f5", "important");
            dot.style.setProperty("background-color", "transparent", "important");
          }
          return;
        }
        if (bgColor) {
          info.el.style.setProperty("background-color", bgColor, "important");
          info.el.style.setProperty("border-color", bgColor, "important");
          info.el.style.setProperty("--fc-event-bg-color", bgColor, "important");
          info.el.style.setProperty("--fc-event-border-color", bgColor, "important");
          const mainEl = info.el.querySelector(".fc-event-main");
          if (mainEl) {
            mainEl.style.setProperty("background-color", bgColor, "important");
            mainEl.style.setProperty("border-color", bgColor, "important");
          }
          const mainFrame = info.el.querySelector(".fc-event-main-frame");
          if (mainFrame) {
            mainFrame.style.setProperty("background-color", bgColor, "important");
            mainFrame.style.setProperty("border-color", bgColor, "important");
          }
          const dot = info.el.querySelector(".fc-daygrid-event-dot");
          if (dot) {
            dot.style.setProperty("border-color", bgColor, "important");
          }
        }
        if (info.view?.type === "dayGridMonth") {
          const isDarkBg = isDark(bgColor);
          const textColor = isDarkBg ? "#ffffff" : "#0f172a";
          info.el.style.color = textColor;
          info.el.querySelectorAll(".fc-event-title, .fc-event-time").forEach((el) => {
            el.style.color = textColor;
          });
        }
      },
    });

    calendar.render();
    if (initialView === "pinboard") {
      setViewVisibility(true);
      setActiveButton(viewButtons, "pinboard");
    } else {
      setViewVisibility(false);
      setActiveButton(viewButtons, viewKeyFromType(calendar.view?.type));
    }
    updatePinboard();

    viewButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.getAttribute("data-ent-view");
        if (!target) return;
        if (target === "pinboard") {
          setViewVisibility(true);
          setActiveButton(viewButtons, "pinboard");
          updatePinboard();
          return;
        }
        const viewType = getInitialView(target);
        setViewVisibility(false);
        calendar.changeView(viewType);
      });
    });

    navButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-cal-nav");
        if (action === "prev") calendar.prev();
        if (action === "next") calendar.next();
        if (action === "today") calendar.today();
      });
    });

    typeToggles.forEach((toggle) => {
      toggle.addEventListener("change", () => {
        currentType = getTypeFromToggle();
        calendar.refetchEvents();
        updatePinboard();
      });
    });
  });
})();
