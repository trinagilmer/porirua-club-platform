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

    const titleEl = document.getElementById("entCalendarTitle");
    const viewButtons = document.querySelectorAll("[data-ent-view]");
    const navButtons = document.querySelectorAll("[data-cal-nav]");
    const typeToggles = document.querySelectorAll('input[name="ent-mode"]');
    const calendarShell = document.querySelector(".ent-calendar-shell");
    const pinboardShell = document.querySelector(".ent-pinboard-shell");
    const pinboardViews = document.querySelectorAll(".ent-pinboard");

    let currentType = calendarEl.dataset.initialType || getTypeFromToggle();
    const initialView = getInitialView(calendarEl.dataset.initialView);

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
          window.location.href = info.event.url;
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
