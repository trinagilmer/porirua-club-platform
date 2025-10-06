# Porirua Club Platform – Project Blueprint (2025)

## 🧩 Overview
The Porirua Club Platform is a Node.js + Express + Supabase + EJS application that manages:
- Functions (core module)
- Restaurant Bookings
- Club Events
- Calendar
- Inbox (Microsoft Graph integration)
- Tasks
- Reports
- Settings

Each module integrates into a unified backend for staff and admin users to manage all club operations and communications.

---

## ⚙️ Core Tech Stack
- **Backend:** Node.js + Express  
- **Database:** Supabase (PostgreSQL)  
- **Frontend:** EJS templates + Vanilla JS  
- **Auth:** Local + Microsoft 365 (MSAL Node)  
- **Email Integration:** Microsoft Graph via shared mailbox `events@poriruaclub.co.nz`  
- **Hosting:** Render (free tier for dev)  

---

## 🧠 Modules Summary

### 🏛️ Functions
- Core hub for all events.
- Tracks contacts, notes, tasks, documents, services, menus, and facilities.
- Linked to proposals, financial totals, and communication history.
- Supports conversion between a *Function* and a *Restaurant Booking*.

### 🍽️ Restaurant Bookings
- Similar to functions but simplified (party name, size, date/time, menu type, price).
- Can be promoted or demoted to/from a Function.

### 🎶 Club Events
- Handles recurring or public events.
- Integrates into the shared calendar.

### 🗓️ Calendar
- Unified visual calendar for Functions, Bookings, and Club Events.
- Filters by room, status, owner, and type.

### 📥 Inbox
- Connected to Microsoft 365 shared mailbox `events@poriruaclub.co.nz`.
- Fetches inbound and sent mail using Microsoft Graph API.
- Filters by keywords and contact matches (links to functions or bookings).
- Staff can reply and send from this shared address.

### 💬 Unified Communications
A **Supabase view** that merges `messages`, `function_notes`, and `tasks` into a single feed.

#### Table/View: `unified_communications`
```sql
CREATE VIEW unified_communications AS
SELECT 
  'message' AS entry_type,
  m.id::text AS entry_id,
  m.related_function,
  m.related_booking,
  m.related_contact,
  m.created_by,
  COALESCE(m.message_type, 'email') AS message_type,
  m.subject,
  m.body,
  m.from_email,
  m.to_email,
  COALESCE(m.sent_at, m.received_at, m.created_at) AS entry_date,
  m.created_at,
  m.created_at AS updated_at,
  FALSE AS private
FROM messages m

UNION ALL

SELECT 
  'note' AS entry_type,
  n.id::text AS entry_id,
  n.function_id AS related_function,
  NULL AS related_booking,
  NULL AS related_contact,
  NULL AS created_by,
  'note' AS message_type,
  NULL AS subject,
  n.content AS body,
  NULL AS from_email,
  NULL AS to_email,
  n.created_at AS entry_date,
  n.created_at,
  n.created_at AS updated_at,
  FALSE AS private
FROM function_notes n

UNION ALL

SELECT 
  'task' AS entry_type,
  t.id::text AS entry_id,
  COALESCE(t.related_function_id, t.function_id) AS related_function,
  t.related_booking_id AS related_booking,
  NULL AS related_contact,
  t.assigned_user_id AS created_by,
  'task' AS message_type,
  t.title AS subject,
  NULL AS body,
  NULL AS from_email,
  NULL AS to_email,
  t.created_at AS entry_date,
  t.created_at,
  t.created_at AS updated_at,
  FALSE AS private
FROM tasks t;
