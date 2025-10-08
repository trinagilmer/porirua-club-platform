# 🧭 Porirua Club Platform – Copilot Task Header

Use this header at the top of every new file or function implementation.
It gives Copilot (and other devs) full context so it writes consistent, schema-safe code.

---

## 📄 Template

```js
// 🧭 Porirua Club Platform Context
// Module: [Name of the module, e.g. "Message Auto-Linker Service"]
// File: [Relative path, e.g. "services/messageMatcher.js"]
// Purpose: [Brief description of what this file does]
// Schema Context:
//   messages(from_email, to_email, related_contact, related_function)
//   contacts(email, id)
//   functions(contact_id)
//   function_contacts(contact_id, function_id)
//   restaurant_bookings(id, status, booking_date, size)
// Rules:
// - DO NOT recreate or modify existing tables
// - Use async/await (Node.js + Express)
// - Supabase JS client or pg Pool is available
// - Logging should use console.log() with summary metrics
// - Export main function or Express route as required
// - Keep code modular, consistent with other services
// Example import: const supabase = require('../config/supabaseClient');
