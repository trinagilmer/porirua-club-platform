# 📧 Porirua Club Platform — Communication & Lead Intelligence System

_Last updated: Oct 2025_  
_Environment: Node.js (Express) + PostgreSQL + Supabase + Microsoft Graph (Shared Mailbox)_

---

## 🧭 Overview

This document defines the **communication system** that connects all event and booking correspondence within the Porirua Club Platform.  
It covers inbound and outbound email integration, lead triage, contact linking, and unified communication history.

All emails are fetched via a **Microsoft 365 shared mailbox** (`events@poriruaclub.co.nz`), synchronized through the Microsoft Graph API.

---

## 🧱 System Goals

| Goal | Description |
|------|--------------|
| 📥 Centralize | Aggregate all inbound messages and leads in one inbox |
| 🔗 Link | Automatically associate messages with Functions, Bookings, and Contacts |
| 📜 Track | Store and display a unified communication timeline per record |
| 💬 Send | Allow outbound replies and automated emails through the same shared mailbox |
| 🧠 Convert | Turn inbound leads into Functions or Restaurant Bookings |
| 📊 Analyze | Enable future reporting on communication volume and response times |

---

## 🗂️ Database Schema Additions

### 1. `messages`
Stores all inbound, outbound, and automated communication.

```sql
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type text CHECK (message_type IN ('inbound','outbound','auto','note')),
  subject text,
  body text,
  from_email text,
  to_email text[],
  received_at timestamp default now(),
  sent_at timestamp,
  conversation_id text,
  related_function int REFERENCES functions(id) ON DELETE CASCADE,
  related_booking int REFERENCES restaurant_bookings(id) ON DELETE CASCADE,
  related_contact uuid REFERENCES contacts(id) ON DELETE SET NULL,
  source text,  -- e.g., 'graph', 'manual', 'template'
  created_by int REFERENCES users(id),
  created_at timestamp default now()
);
2. leads
Captures all unclassified inbound messages or web enquiries.

sql
Copy code
CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text,  -- 'email', 'web_form', 'manual'
  subject text,
  message text,
  sender_email text,
  sender_name text,
  received_at timestamp default now(),
  linked_contact uuid REFERENCES contacts(id),
  linked_function int REFERENCES functions(id),
  linked_booking int REFERENCES restaurant_bookings(id),
  triage_status text DEFAULT 'new' CHECK (triage_status IN ('new','converted','archived'))
);
3. email_templates
Stores pre-written messages for automation.

sql
Copy code
CREATE TABLE email_templates (
  id serial PRIMARY KEY,
  name text NOT NULL,
  subject text,
  body text,
  is_active boolean default true,
  category text, -- e.g. 'proposal', 'confirmation', 'reminder'
  created_at timestamp default now()
);
🔄 Data Flow
Incoming email → Shared Mailbox (events@poriruaclub.co.nz)

Microsoft Graph fetcher (/inbox/sync) pulls messages into messages

Background job auto-matches:

from_email or to_email to known contacts

Links to a function or booking if contact association exists

Unmatched messages → leads for manual triage

User triage options in Inbox:

Convert to Function

Convert to Restaurant Booking

Archive

🧠 Auto-Linking Logic (Message Matcher)
text
Copy code
IF message.from_email IN contacts
  AND contact.id IN function_contacts
    → set messages.related_function = that function.id
ELSE IF message.from_email IN contacts
  AND contact.id IN restaurant_bookings.contact_id
    → set messages.related_booking = that booking.id
ELSE
    → insert into leads
This runs automatically on sync or can be triggered manually from the Inbox view.

💬 Unified Activity Timeline
Each Function and Booking detail page includes a timeline panel, combining:

Type	Source	Description
Email (inbound/outbound)	messages	Sent or received via shared mailbox
Note	messages.message_type='note'	Internal staff notes or meeting logs
Auto Email	messages.message_type='auto'	System-generated emails (templates)
Document	documents	Files uploaded for this record
Task	tasks	Linked task events (optional integration)

Timeline is sorted descending by date, unified across sources.

🧭 UI Layout Overview
1. 📬 Smart Inbox (/inbox)
Left Column: Filters (All, Unlinked, Functions, Bookings)

Middle Column: Email List (subject, sender, preview, date)

Right Panel:

Full message view (HTML or text)

“Convert to Function” / “Convert to Booking” buttons

Contact card if matched

Notes tab (quick add staff notes)

2. 🧾 Function / Booking Detail
Adds a “Communication” tab beside Notes and Tasks:

Shows unified activity timeline

Staff can add quick notes

Shows auto emails and attachments inline

3. 🧰 Future Tabs (Ready for Extension)
Documents

Proposals

Payments

Chat (internal staff discussion)

📧 Sending Emails
All outbound messages use the same shared mailbox credentials.

Example Outbound Workflow
User clicks “Reply” in Inbox or Function detail view.

A modal opens with:

Subject prefilled

Message body editor (TinyMCE or plain <textarea>)

Backend sends via Microsoft Graph API /sendMail

Stores a record in messages with message_type='outbound'.

✅ Replies automatically link to the correct conversation by conversation_id.

🔒 Permissions
Role	Access
Admin	View all messages and leads
Staff	View messages for owned or assigned functions/bookings
Viewer	Read-only
System	Background sync, auto classification

Access control handled in WHERE clauses on message routes.

🚀 Performance Strategy
Feature	Strategy
Graph API Fetch	Paginate 20 messages per sync
Caching	Store message metadata in DB
Background Sync	Schedule with node-cron (every 10–15 min)
Rendering	Lazy-load message bodies, “Load more” button
Fallback	If Graph API fails, use last cached set

📊 Reporting Hooks
Messages table supports future analytics:

Average response time (first reply delay)

Communication count by staff

Conversion rate from lead → booking/function

These will later feed into /reports.

🧩 Integration Summary
Component	Depends On	Integration
Inbox	Microsoft Graph	Shared mailbox message sync
Leads	Messages	Unlinked inbound items
Messages	Functions / Bookings / Contacts	Activity feed linking
Email Templates	Messages	Auto emails (confirmation, proposal)
Functions / Bookings	Contacts	Two-way linkage for communication
Tasks / Notes	Messages	Unified timeline integration

🛠️ Implementation Order (Recommended)
✅ Create database tables (messages, leads, email_templates)

⚙️ Update /inbox routes:

Fetch shared mailbox emails

Store + link to contacts

🧠 Add message matcher logic (auto-linker)

🧾 Build unified timeline partial view (partials/timeline.ejs)

✉️ Add outbound reply route + modal

🗂️ Add “Convert to Function / Booking” triage

💬 Add internal notes as message type note

🧩 Future Enhancements
🤖 AI-powered message classification (“Is this a booking or enquiry?”)

📎 File attachment preview in timeline

🔔 Slack / Teams notifications for new enquiries

🧾 Automated proposal triggers based on keywords

🪄 Blueprint Loader Header Snippet
When starting a new ChatGPT session to continue work on this module, paste this header first:

sql
Copy code
🧭 Porirua Club Platform – Communication & Lead Intelligence System

Here’s my project context (copied from COMMUNICATION_BLUEPRINT.md).  
We’re continuing the build of the communication layer that integrates:
- Shared mailbox (Microsoft Graph)
- Functions and Restaurant Bookings
- Leads, Notes, and Unified Timeline

Please use the Communication Blueprint context to guide any new routes, EJS views, or SQL migrations.
);
