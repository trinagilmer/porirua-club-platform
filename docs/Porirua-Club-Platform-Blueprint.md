# 🏗️ Porirua Club Platform – System Blueprint v2.0

## Overview
The Porirua Club Platform is a full-stack management system for events, restaurant bookings, club activities, and communications. It integrates Microsoft 365 for email and calendar functionality and centralizes all venue operations.

---

## 🧩 Stack

| Layer | Technology | Description |
|-------|-------------|-------------|
| **Backend** | Node.js + Express | Modular routing for all dashboards |
| **Database** | PostgreSQL (Supabase) | Central data source for all entities |
| **Frontend** | EJS Templates | Server-side rendering |
| **Styling** | `/public/css/main.css` | Shared modern flat design |
| **Auth** | Express-session, bcrypt, MSAL (Microsoft 365) | Local + Microsoft login |
| **Hosting** | Render | Staging & production hosting |
| **Email/Calendar** | Microsoft Graph API | Integrated mail and calendar sync |

---

## 🧱 Database Overview (Supabase)

### Core Tables

| Table | Purpose | Key Relationships |
|--------|----------|------------------|
| **users** | Staff accounts | Linked to tasks, events |
| **roles** | Role permissions | Defines admin/staff/user |
| **functions** | Main event table | Links to contacts, rooms, menus, etc. |
| **function_contacts** | Many-to-many join | Links functions ↔ contacts |
| **contacts** | Contact records | Linked to functions, messages |
| **rooms** | Venue spaces | Linked to events, bookings |
| **tasks** | Task tracking | Linked to functions/events |
| **function_notes** | Notes | Logs per function |
| **function_services** | Service items | Linked to functions |
| **function_menus** | Menus | Links menus + categories |
| **function_facilities** | Facilities usage | Linked to functions |
| **documents** | File uploads | Linked to functions/proposals |
| **messages** | Emails (from Graph) | Linked to contacts & events |
| **proposals** | Client proposals | Built from menus/services |
| **proposal_items** | Line items | Child table to proposals |
| **restaurant_bookings** | Dining reservations | Linked to contacts & menus |
| **club_events** | Club event management | Linked to rooms, facilities |
| **calendar_events** | Combined events view | Aggregates all events |

---

## 🧾 Modules

### 1️⃣ Functions Dashboard
- Central event management hub
- Filters by status (`lead`, `qualified`, `confirmed`, etc.)
- Two-column layout: Contacts + Event Details
- KPIs by status group
- Edit page `/functions/:id/edit` includes:
  - Tabs: Info, Tasks, Notes, Menus, Services, Facilities, Proposal
  - Reuses `.card` form layout

### 2️⃣ Restaurant Dashboard
- Table of bookings (by date range)
- Filters: Today, This Week, Custom
- Columns: Contact, Party, Menu Type, Size, Value, Status
- Future integration: automatic email confirmations

### 3️⃣ Club Events Dashboard
- Manages recurring and ad hoc events
- Filters: Date Range / Event Type / Room
- Supports categories (Adjunct, Entertainment, Sports, etc.)
- Facilities & catering support

### 4️⃣ Calendar Dashboard
- Unified view: Functions, Bookings, Club Events
- Filters by Type, Room, Status, Owner
- Modes: Month, Week, List
- Features:
  - Click = Quick View popup
  - Drag = Reschedule
  - Add Note / Block Room

### 5️⃣ Inbox Dashboard
- Microsoft 365 email integration
- Shows inbound/outbound mail
- Matches contacts automatically by email
- Future: AI parsing of leads from email content

### 6️⃣ Reports Dashboard
- Exports and analytics by category
- Tabs: Functions / Club Events / Restaurant / Payments / Sales
- Export to Excel / CSV
- Charts and revenue summaries

### 7️⃣ Settings
- Venue details, Rooms setup
- Menu builder and categories
- Staff & roles management
- Contact form builder (website lead integration)
- Proposal templates and defaults

---

## 🔐 Environment Variables

| Variable | Purpose |
|-----------|----------|
| `DATABASE_URL` | Supabase Postgres connection |
| `SESSION_SECRET` | Express session signing |
| `AZURE_CLIENT_ID` | Microsoft App ID |
| `AZURE_TENANT_ID` | Tenant GUID |
| `AZURE_CLIENT_SECRET` | Client Secret (Value, not ID) |
| `AZURE_REDIRECT_URI` | Redirect callback URL |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Server key for backend sync |

---

## 📂 Project Structure

