(function () {
  document.addEventListener("DOMContentLoaded", function () {
    const calendarEl = document.getElementById("restaurantCalendar");
    if (!calendarEl || !window.FullCalendar) return;

    const slotMinutes = window.calendarConfig?.daySlotMinutes || 30;
    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "timeGridWeek",
      slotDuration: { minutes: slotMinutes },
      slotLabelInterval: { minutes: slotMinutes },
      height: "auto",
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay",
      },
      events: "/calendar/restaurant/events",
      eventDisplay: "block",
      displayEventTime: true,
      eventClick: (info) => {
        info.jsEvent?.preventDefault();
        const url = info.event.extendedProps?.detailUrl;
        if (url) window.location.href = url;
      },
    });

    calendar.render();
  });
})();
