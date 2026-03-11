-- Enable RLS on public room-link tables flagged by Supabase linter.
-- No public policies are added here; access remains restricted unless explicitly allowed.

ALTER TABLE IF EXISTS public.entertainment_event_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.club_event_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.function_room_allocations ENABLE ROW LEVEL SECURITY;
