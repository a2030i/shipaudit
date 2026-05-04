-- ════════════════════════════════════════════════════════════════
--  ShipAudit Core Schema — v2
--  Run AFTER schema.sql in: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- 1. Carriers (شركات الشحن + عقودها)
CREATE TABLE IF NOT EXISTS public.carriers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  logo        TEXT DEFAULT '📦',
  color       TEXT DEFAULT '#38bdf8',
  contracts   JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Audits (سجل المراجعات)
CREATE TABLE IF NOT EXISTS public.audits (
  id              TEXT PRIMARY KEY,
  carrier_id      TEXT,
  carrier_name    TEXT DEFAULT '',
  contract_label  TEXT DEFAULT '',
  file_name       TEXT DEFAULT '',
  period          TEXT DEFAULT '',
  row_count       INTEGER DEFAULT 0,
  issue_count     INTEGER DEFAULT 0,
  total_expected  NUMERIC(14,2) DEFAULT 0,
  total_billed    NUMERIC(14,2) DEFAULT 0,
  diff            NUMERIC(14,2) DEFAULT 0,
  results         JSONB NOT NULL DEFAULT '[]'::jsonb,
  col_map         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits   ENABLE ROW LEVEL SECURITY;

-- Carriers: all authenticated users can read/write (shared contracts)
CREATE POLICY "carriers_read"   ON carriers FOR SELECT TO authenticated USING (true);
CREATE POLICY "carriers_write"  ON carriers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "carriers_update" ON carriers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "carriers_delete" ON carriers FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Audits: all authenticated users can read all; insert own; admin can delete any
CREATE POLICY "audits_select"  ON audits FOR SELECT TO authenticated USING (true);
CREATE POLICY "audits_insert"  ON audits FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "audits_delete"  ON audits FOR DELETE TO authenticated USING (
  created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
