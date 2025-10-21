<!-- 📬 Function Communications Detail -->
<% locals.layout = 'layouts/main'; %>

<main class="function-layout-two-col">
  <!-- 🧭 Sidebar -->
  <aside class="function-sidebar">
    <%- include('../../partials/functions/sidebar', {
      fn,
      linkedContacts: linkedContacts || [],
      rooms: rooms || [],
      eventTypes: eventTypes || []
    }) %>
  </aside>

  <!-- 🧩 Workspace -->
  <section class="function-workspace">
    <!-- 🔹 Tabs -->
    <%- include('../../partials/functions/tabs', { fn, activeTab: 'communications' }) %>

    <!-- 🔹 Body -->
    <div class="function-body container py-4">
      <% if (message) { %>
        <div class="message-detail card shadow-sm p-4 mb-4">
          <h2 class="mb-3"><%= message.subject || '(No subject)' %></h2>
          <div class="d-flex justify-content-between align-items-center mb-3 text-muted small">
            <div>
              <strong>From:</strong> <%= message.from_email || 'Unknown' %><br>
              <strong>To:</strong> <%= message.to_list ? message.to_list.join(', ') : '' %>
            </div>
            <div><%= new Date(message.created_at).toLocaleString('en-NZ') %></div>
          </div>
          <hr>
          <div class="message-body">
            <%- message.body_html || `<pre>${message.body_text || '(no content)'}</pre>` %>
          </div>

          <% if (message.attachments && message.attachments.length) { %>
            <hr>
            <div class="attachments mt-3">
              <h6>📎 Attachments</h6>
              <ul class="list-unstyled">
                <% message.attachments.forEach(att => { %>
                  <li><a href="<%= att.download_url %>" target="_blank"><%= att.filename %></a></li>
                <% }) %>
              </ul>
            </div>
          <% } %>

          <div class="mt-4">
            <a href="/functions/<%= fn.id %>/communications" class="btn btn-outline-secondary">← Back to Communications</a>
            <button class="btn btn-primary ms-2" id="replyBtn">Reply</button>
          </div>
        </div>
      <% } else { %>
        <p class="text-muted">Message not found.</p>
      <% } %>
    </div>
  </section>
</main>

<script>
  window.fnContext = { id: <%- JSON.stringify(fn.id) %>, messageId: <%- JSON.stringify(message?.id || null) %> };
</script>

<script src="/js/functions/communications.js" defer></script>
