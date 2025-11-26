(function () {
  document.addEventListener("DOMContentLoaded", function () {
    const calendarEl = document.getElementById("restaurantCalendar");
    if (!calendarEl || !window.FullCalendar) return;
    const services = Array.isArray(window.restaurantServices) ? window.restaurantServices : [];
    const hasServices = services.length > 0;

    const toMinutes = (t) => {
      if (!t) return 0;
      const [h, m] = t.slice(0, 5).split(":").map(Number);
      return h * 60 + m;
    };

    const businessHours = hasServices ? services.map((s) => {
      const start = (s.start_time || "00:00").slice(0, 5);
      const end = (s.end_time || "23:59").slice(0, 5);
      // FullCalendar treats endTime as exclusive; bump by 1 minute to include the last minute
      const endMinutes = toMinutes(end) + 1;
      const endInclusive = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
      return {
        daysOfWeek: [Number(s.day_of_week)],
        startTime: start,
        endTime: endInclusive,
      };
    }) : true;

    const timeFromMinutes = (mins) => {
      const safe = Math.max(0, Math.min(mins, 24 * 60 - 1));
      const h = Math.floor(safe / 60);
      const m = safe % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const closedBlocks = [];
    if (hasServices) {
      for (let dow = 0; dow < 7; dow++) {
        const todays = services.filter((s) => Number(s.day_of_week) === dow);
        if (!todays.length) {
            closedBlocks.push({
              daysOfWeek: [dow],
              startTime: "00:00",
              endTime: "23:59",
              display: "background",
              backgroundColor: "#f5f5f5",
              borderColor: "#f5f5f5",
              className: ["restaurant-closed"],
              allDay: false,
            });
            continue;
          }

        const windows = todays
          .map((s) => ({
            startM: toMinutes((s.start_time || "00:00").slice(0, 5)),
            endM: toMinutes((s.end_time || "23:59").slice(0, 5)),
          }))
          .sort((a, b) => a.startM - b.startM);

        let cursor = 0;
        windows.forEach((w, idx) => {
          if (cursor < w.startM) {
            closedBlocks.push({
              daysOfWeek: [dow],
              startTime: timeFromMinutes(cursor),
              endTime: timeFromMinutes(w.startM),
              display: "background",
              backgroundColor: "#f5f5f5",
              borderColor: "#f5f5f5",
              className: ["restaurant-closed"],
              allDay: false,
            });
          }
          cursor = Math.max(cursor, w.endM + 1);
          if (idx === windows.length - 1 && cursor < 24 * 60) {
            closedBlocks.push({
              daysOfWeek: [dow],
              startTime: timeFromMinutes(cursor),
              endTime: "23:59",
              display: "background",
              backgroundColor: "#f5f5f5",
              borderColor: "#f5f5f5",
              className: ["restaurant-closed"],
              allDay: false,
            });
          }
        });
      }
    }

    const allStarts = services.map((s) => (s.start_time || "06:00").slice(0, 5));
    const allEnds = services.map((s) => (s.end_time || "23:59").slice(0, 5));
    const slotMinTime = allStarts.length ? allStarts.sort()[0] : "06:00";
    const slotMaxTime = allEnds.length ? allEnds.sort().slice(-1)[0] : "23:59";

    const slotMinutes = window.calendarConfig?.daySlotMinutes || 30;
    const isWithinService = (dateObj) => {
      if (!hasServices) return true;
      const dow = dateObj.getDay();
      const timeMinutes = toMinutes(
        `${String(dateObj.getHours()).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}`
      );
      return services.some((s) => {
        if (Number(s.day_of_week) !== dow) return false;
        const startM = toMinutes(s.start_time || "00:00");
        const endM = toMinutes(s.end_time || "23:59") + 1; // inclusive
        return timeMinutes >= startM && timeMinutes <= endM;
      });
    };

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "timeGridWeek",
      slotDuration: { minutes: slotMinutes },
      slotLabelInterval: { minutes: slotMinutes },
      slotMinTime,
      slotMaxTime,
      height: "auto",
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay",
      },
      events: "/calendar/restaurant/events",
      eventDisplay: "block",
      displayEventTime: true,
      businessHours,
      selectable: true,
      selectMirror: true,
      selectAllow: (selectionInfo) => {
        return isWithinService(selectionInfo.start);
      },
      eventSources: closedBlocks.length
        ? [
            {
      events: closedBlocks,
      display: "background",
      backgroundColor: "#f5f5f5",
      borderColor: "#f5f5f5",
      className: "restaurant-closed",
            },
          ]
        : [],
      eventClick: (info) => {
        info.jsEvent?.preventDefault();
        const url = info.event.extendedProps?.detailUrl;
        if (url) window.location.href = url;
      },
      dateClick: (info) => {
        if (!window.restaurantCanManage) return;
        const modalEl = document.getElementById("restaurantBookingModal");
        if (!modalEl) return;
        const modal = new bootstrap.Modal(modalEl);

        const dateLocal = info.date; // already local from FullCalendar
        const pad = (n) => String(n).padStart(2, "0");
        const isoDate = `${dateLocal.getFullYear()}-${pad(dateLocal.getMonth() + 1)}-${pad(dateLocal.getDate())}`;
        const timeStr = `${pad(dateLocal.getHours())}:${pad(dateLocal.getMinutes())}`;

        const dow = dateLocal.getDay();
        const timeMinutes = toMinutes(timeStr);
        const matchingService =
          services.find((s) => {
            if (Number(s.day_of_week) !== dow) return false;
            const startM = toMinutes(s.start_time || "00:00");
            const endM = toMinutes(s.end_time || "23:59") + 1; // inclusive
            return timeMinutes >= startM && timeMinutes <= endM;
          }) ||
          services.find((s) => Number(s.day_of_week) === dow) ||
          services[0] ||
          null;

        if (services.length && !isWithinService(dateLocal)) {
          alert("This time is outside the configured service windows.");
          return;
        }

        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.value = val || "";
        };

        setVal("rb-date", isoDate);
        setVal("rb-time", timeStr);
        setVal("rb-size", info.view.type === "dayGridMonth" ? "" : "2");
        setVal("rb-party", "");
        setVal("rb-service", matchingService?.id || "");

        const toggle = document.getElementById("rb-recurring-toggle");
        const panel = document.getElementById("rb-recurring-fields");
        if (toggle && panel) {
          toggle.checked = false;
          panel.classList.add("d-none");
        }

        modal.show();
      },
    });

    calendar.render();

    // Recurring toggle
    const toggle = document.getElementById("rb-recurring-toggle");
    const panel = document.getElementById("rb-recurring-fields");
    if (toggle && panel) {
      toggle.addEventListener("change", () => {
        if (toggle.checked) {
          panel.classList.remove("d-none");
        } else {
          panel.classList.add("d-none");
          panel.querySelectorAll("input, select, textarea").forEach((el) => {
            if (el.type === "checkbox") el.checked = false;
            else el.value = "";
          });
        }
      });
    }
  });
})();
