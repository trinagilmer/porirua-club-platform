# porirua-club-platform
Porirua Club Booking Platform (Functions, Restaurant, Events, Tasks, Reports)
# 🏗️ Porirua Club Platform

**Centralized event, function, and club management system** built for Porirua Club — integrating **functions, restaurant bookings, club events, communications, tasks, and reports** into one unified operational platform.

---

## 🚀 Overview

The Porirua Club Platform provides a **single hub** for managing:
- 🎉 **Functions** – with contact linking, event scheduling, tasks, menus, and proposals  
- 🍽 **Restaurant Bookings** – reservations, menu selections, guest tracking  
- 🎭 **Club Events** – recurring and one-off public or adjunct events  
- 📅 **Calendar** – unified visual timeline across functions, events, and bookings  
- 💬 **Inbox & Communications** – integrated with **Microsoft 365 (Graph API)** for centralized email, contact, and note tracking  
- 📊 **Reports** – sales, revenue, and operational insights across all business units  

All major features share a consistent Node.js + EJS architecture backed by PostgreSQL (Supabase) and Microsoft Graph for communications.

---

## 🧱 Tech Stack

| Layer | Tools & Frameworks |
|-------|--------------------|
| **Backend** | Node.js + Express |
| **Frontend** | EJS (Server-Side Rendering) + Vanilla JS (fetch/AJAX) |
| **Database** | PostgreSQL via Supabase |
| **Auth** | Local login + Microsoft 365 OAuth (MSAL) |
| **Styling** | `/public/css/main.css` – unified card-based flat UI |
| **Deployment** | Render (free tier, moving to production) |

---

## 📨 Microsoft 365 Integration

- Connected via **Microsoft Graph API**
- Shared mailbox: `events@poriruaclub.co.nz`
- Scopes required:
  - `Mail.ReadWrite.Shared`
  - `Mail.Send.Shared`
  - `User.Read`
- Enables:
  - Viewing all event/booking-related correspondence
  - Sending automated and manual emails from within the platform
  - Linking communications directly to **functions**, **bookings**, and **contacts**

---

## 🧩 Unified Communications

All correspondence — including **emails, notes, and tasks** — is unified through the `unified_communications` view.

Each entry links to:
- a **function** (`function_id`),  
- a **restaurant booking** (`booking_id`), and/or  
- a **contact** (`contact_id`).

Supports chronological viewing, grouping by type, and automatic updates to “last contacted” fields.

---

## 📁 Project Structure

