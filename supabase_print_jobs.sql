-- ══════════════════════════════════════════════════════════════════════════════
-- ⚡ DOGAR SAJJI — PRINT JOB RELAY (run once in Supabase SQL Editor)
-- ══════════════════════════════════════════════════════════════════════════════
-- Lets any device (including one on a public URL like the Vercel deployment,
-- with no direct network path to the restaurant's printers at all) queue a
-- print job here instead of needing to reach the admin PC's own IP address
-- directly. The admin PC's desktop app picks up new rows via a realtime
-- subscription (it's already always connected to Supabase for order/menu
-- sync) and does the actual ESC/POS print locally, then reports back through
-- the same row — no printer IP, LAN reachability, or firewall port needed on
-- the requesting device's end at all.
--
-- Instructions:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard
-- 2. Go to "SQL Editor" in the left sidebar
-- 3. Click "New Query", paste this entire script, and click "RUN"

CREATE TABLE IF NOT EXISTS public.print_jobs (
  id          TEXT PRIMARY KEY,
  target      TEXT NOT NULL,                  -- 'kitchen' | 'billing'
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'done' | 'failed'
  error       TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Full Access" ON public.print_jobs;
CREATE POLICY "Public Full Access" ON public.print_jobs FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'print_jobs'
  ) THEN
    BEGIN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.print_jobs';
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- Housekeeping: old finished/failed jobs don't need to stick around forever.
-- (Optional — safe to skip if you'd rather manage this yourself later.)
CREATE OR REPLACE FUNCTION public.cleanup_old_print_jobs() RETURNS void AS $$
BEGIN
  DELETE FROM public.print_jobs
  WHERE status IN ('done', 'failed') AND updated_at < NOW() - INTERVAL '2 days';
END;
$$ LANGUAGE plpgsql;
