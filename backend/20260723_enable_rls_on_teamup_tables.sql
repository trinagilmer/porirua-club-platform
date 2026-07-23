-- Enable RLS on Teamup tables flagged by Supabase linter.
-- No public policies are added here; access remains restricted unless explicitly allowed.

ALTER TABLE IF EXISTS public.teamup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.teamup_events ENABLE ROW LEVEL SECURITY;
