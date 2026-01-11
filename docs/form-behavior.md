# Form Behavior Reference (Derived from Current Code)

This document summarizes form inputs, validation rules, and outputs as implemented in the codebase.
It is intended to guide test coverage and QA for all major data entry points.

## Auth

### Login (`/auth/login`)
- Fields: `email` (required), `password` (required), `next` (optional).
- Validation: email + password must match a record in `users`.
- Output: redirects to `next`, `default_landing`, or `/dashboard`. Invalid creds show error.

### Register (`/auth/register`)
- Fields: `name`, `email`, `password` (all required).
- Validation: email must be unique.
- Output: creates `users` row and logs in; redirects to `/dashboard`.

### Forgot Password (`/auth/forgot-password`)
- Fields: `email` (required).
- Validation: none beyond required.
- Output: creates `password_resets` if user exists; always shows generic success message.

### Reset Password (`/auth/reset-password/:token`)
- Fields: `password`, `confirm_password` (required).
- Validation: password length >= 8, passwords match, token valid and unexpired.
- Output: updates `users.password_hash`, marks reset used, returns to login with success.

### Accept Invite (`/auth/accept-invite/:token`)
- Fields: `password`, `confirm_password` (required).
- Validation: password length >= 8, passwords match, token valid and unexpired.
- Output: updates `users.password_hash`, marks invite used, returns to login with success.

## Restaurant Booking

### Public Booking (`/calendar/restaurant/book`)
- Fields: `party_name`, `contact_email`, `booking_date`, `booking_time`, `size` (required).
- Optional: `contact_phone`, `service_id`, `notes`.
- Validation: date/time valid, party size > 0, service matches time.
- Output: creates `restaurant_bookings` with `channel=online`.
- Capacity errors return message: `please contact the restaurant to complete this booking email:  chef@poriruaclub.co.nz or phone 04 237 6143 ext 2`.

### Admin Booking (modal -> `/calendar/restaurant/bookings`)
- Fields: `party_name`, `booking_date`, `booking_time`, `size` (required).
- Optional: `service_id`, `zone_id`, `table_id`, `status`, `notes`, `contact_email`, `contact_phone`.
- Output: creates booking and notifies restaurant team; redirects back to calendar.

## Functions

### Create Function (`/functions/new`)
- Fields: `event_name` (required).
- Optional: `event_date`, `start_time`, `end_time`, `attendees`, `budget`, `room_id`, `event_type`, `status`, `owner_id`, recurrence fields.
- Validation: event name required; recurrence requires `event_date`.
- Output: creates `functions` row and optional recurrence series; redirects to `/functions/:id`.

### Edit Function (`/functions/:id/edit`)
- Fields: similar to create; optional recurrence scope.
- Output: updates `functions` and related entities.

## Contacts

### Create Contact (API) (`POST /contacts`)
- Fields: `name` (required).
- Optional: `email`, `phone`, `company`, `feedback_opt_out`.
- Output: creates `contacts` row; returns JSON `{ success, id }`.

### Import Contacts (`POST /contacts/import`)
- Input: CSV file with columns `name`, `email`, `phone`, `company`, `feedback_opt_out`.
- Output: creates/updates contacts; returns JSON `{ success, created, updated }`.

## Settings

### Restaurant Services (`/settings/restaurant/services/add`)
- Fields: `name`, `day_of_week`, `start_time`, `end_time` (required).
- Optional: `slot_minutes`, `turn_minutes`, `max_covers_per_slot`, `max_online_covers`, `max_online_party_size`, `active`, special menu fields.
- Output: creates `restaurant_services` row.

### Restaurant Services Edit (`/settings/restaurant/services/edit`)
- Fields: same as add + `id`.
- Output: updates `restaurant_services` row.

## Notes

### Notes (various)
- Notes fields are free-text and stored as provided; no additional validation beyond required fields where applicable.

## General Rules

- Most forms are protected by session auth; public routes are `/auth/*`, `/calendar/restaurant/book`, `/entertainment`, `/feedback`, and `/widgets`.
- Capacity validation errors use the public contact message above.

