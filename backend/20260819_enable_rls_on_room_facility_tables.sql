-- Enable RLS on room-facility tables flagged by the Supabase linter.
-- No public policies are added here; access remains restricted unless explicitly allowed.

ALTER TABLE IF EXISTS public.room_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.function_room_facility_selections ENABLE ROW LEVEL SECURITY;
