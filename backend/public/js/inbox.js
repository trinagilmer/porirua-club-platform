/**
 * 📬 Porirua Club Platform – Enhanced Inbox Frontend
 * Module 2C: Linked Intelligence + Auto-Linker Integration
 */

document.addEventListener("DOMContentLoaded", () => {
  const messages = window.messages || [];
  const filterButtons = document.querySelectorAll(".filter-btn");
  const messageCards = document.querySelectorAll(".message-card");
  const detailContainer = document.getElementById("detailContainer");

  // 🕓 Format relative time
  const timeAgo = (date) => {
    if (!date) return "";
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    const intervals = [
      { label: "year", seconds: 31536000 },
      { label: "month", seconds: 2592000 },
      { label: "day", seconds: 86400 },
      { label: "hour", seconds: 3600 },
      { label: "minute", seconds: 60 }
    ];
    for (const interval of intervals) {
      const count = Math.floor(seconds / interval.seconds);
      if (count >= 1) {
        return `${count} ${interval.label}${count > 1 ? "s" : ""} ago`;
      }
    }
    return "just now";
  };

  // Apply relative times
  document.querySelectorAll(".msg-date").forEach(el => {
    const t = el.dataset.time;
    if (t) el.textContent = timeAgo(t);
  });

  // 🧭 Filtering logic
  filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      filterButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const type = btn.dataset.filter;

      messageCards.forEach(card => {
        const linked = card.dataset.linked === "true";
        const hasFunction = card.dataset.hasFunction === "true";
        const hasBooking = card.dataset.hasBooking === "true";

        card.style.display = "flex"; // default visible

        if (type === "linked" && !linked) card.style.display = "none";
        if (type === "unlinked" && linked) card.style.display = "none";
        if (type === "functions" && !hasFunction) card.style.display = "none";
        if (type === "bookings" && !hasBooking) card.style.display = "none";
      });
    });
  });

  // 🧱 Select and show message detail
  messageCards.forEach(card => {
    card.addEventListener("click", () => {
      messageCards.forEach(c => c.classList.remove("active"));
      card.classList.add("active");

      const id = card.dataset.id;
      const msg = messages.find(m => m.id === id);
      if (!msg) return;

      // Render partial inline
      detailContainer.innerHTML = `
        <div class="message-detail-inner">
          <h2>${msg.subject || "(No Subject)"}</h2>
          <p><strong>From:</strong> ${msg.from_email || "Unknown"}</p>
          <p><strong>To:</strong> ${msg.to_email || "Unknown"}</p>
          <p><strong>Date:</strong> ${new Date(msg.created_at).toLocaleString()}</p>
          <hr>
          ${msg.contacts ? `
            <div class="contact-card">
              <h3>Contact Info</h3>
              <p><strong>${msg.contacts.name}</strong></p>
              <p>${msg.contacts.email}</p>
              ${msg.contacts.phone ? `<p>📞 ${msg.contacts.phone}</p>` : ""}
            </div>` : `<p class="muted">No linked contact.</p>`}
          ${msg.functions ? `
            <div class="function-card">
              <h3>Function</h3>
              <p><strong>${msg.functions.event_name}</strong></p>
              <p>${msg.functions.event_date ? new Date(msg.functions.event_date).toLocaleDateString() : ""}</p>
            </div>` : ""}
          <hr>
          <div class="message-body"><pre>${msg.body || "(No message body)"}</pre></div>
          <div class="action-row">
            <a href="/inbox/link/${msg.id}" class="btn btn-outline-primary">Link</a>
            <a href="/inbox/reply/${msg.id}" class="btn btn-outline-success">Reply</a>
          </div>
        </div>
      `;
    });
  });

  // 🧠 Auto-Linker Integration
  const runLinkerBtn = document.getElementById("runLinker");
  const linkerLog = document.getElementById("linkerLog");

  runLinkerBtn?.addEventListener("click", async () => {
    runLinkerBtn.disabled = true;
    linkerLog.innerHTML = '<span class="loading">⏳ Running Auto-Linker...</span>';

    try {
      const res = await fetch("/inbox/match", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        linkerLog.innerHTML = `<span class="success">✅ Completed successfully</span>\n${JSON.stringify(data, null, 2)}`;
      } else {
        linkerLog.innerHTML = `<span class="error">❌ Error: ${data.message}</span>`;
      }
    } catch (err) {
      linkerLog.innerHTML = `<span class="error">💥 Request failed: ${err.message}</span>`;
    } finally {
      runLinkerBtn.disabled = false;
    }
  });

  console.log("📡 Enhanced Inbox JS active (Module 2C)");
});


