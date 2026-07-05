# Functions Simplification Plan

## Goal
Make the functions workflow feel like one simple booking and quoting experience for staff, while preserving the deeper quote, proposal, and reporting functionality underneath.

## Core model

### Function status
Use only:
- Lead
- Confirmed
- Cancelled

### Payment flags
Use:
- Deposit paid
- Fully paid

### Core function fields
Keep the main function record focused on:
- event name
- date
- end date
- start time
- end time
- room
- attendees
- owner/contact
- notes
- status
- deposit paid
- fully paid

## Design principles
- Quick entry first
- Advanced options later
- One main working screen for the function
- Keep advanced details available but not overwhelming
- Make notes part of the core workflow
- Keep quote building simple and item-based
- Do not rely on admin menu setup as the main quote workflow

## Implementation phases

### Phase 1 — Simplify the function model
- Reduce the visible function statuses to Lead / Confirmed / Cancelled
- Introduce Deposit paid and Fully paid as simple flags
- Keep legacy statuses available in the background if needed for compatibility

### Phase 2 — Simplify the create form
- Make the form fast and guided
- Show essential fields first
- Move recurrence and advanced options into a collapsible advanced section
- Make notes part of the main create flow

### Phase 3 — Simplify the function detail experience
- Make the main function screen the primary working surface
- Support inline editing for common fields
- Keep advanced details in expandable sections
- Organise related areas into clear sections such as:
  - Overview
  - Details
  - Quote
  - Notes
  - Tasks
  - Communications

### Phase 4 — Simplify the dashboard
- Default to upcoming functions
- Show lead and confirmed functions prominently
- Keep cancelled visible but less prominent
- Move past/older functions into a secondary view
- Reduce the number of status filters shown by default

### Phase 5 — Simplify the quote experience
- Replace the current menu-heavy workflow with a simpler item-based quote experience
- Make room charge a standard quote line
- Allow food, drinks, extras, and service charges as standard items
- Let staff either:
  - choose from a reusable library
  - or add a one-off item directly on the quote page
- Make save-for-reuse optional

### Phase 6 — Simplify notes
- Use a clean rich text editor for function notes
- Make notes easy to add from the main function screen
- Keep note types simple and practical

### Phase 7 — Preserve advanced details without overwhelming the screen
- Put advanced fields into expandable sections
- Keep them available on the main screen
- Do not remove them from the system

### Phase 8 — Verify and refine
- Test real staff workflows end to end
- Confirm the flow feels faster and clearer
- Adjust labels, layout, and defaults based on actual use

## Recommended final experience
When complete, staff should be able to:
- add a function quickly
- fill in the essentials
- add notes easily
- build a quote quickly
- add room charge and food/extras simply
- mark deposit and full payment clearly
- send a proposal when ready

## What to avoid
- Do not remove old data too early
- Do not break quote/proposal generation
- Do not force staff into admin menu setup
- Do not make reusable items mandatory
- Do not overload the main function screen with too many visible sections
