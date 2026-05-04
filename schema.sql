-- ════════════════════════════════════════════════════════════════
--  FinancialMail Schema — ShipAudit Pro
--  Run this once in: Supabase Dashboard → SQL Editor → New Query
-- ════════════════════════════════════════════════════════════════

-- 1. Profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name          TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'accountant1'
                  CHECK (role IN ('admin','accountant1','accountant2')),
  email         TEXT,
  avatar_color  TEXT    DEFAULT '#38bdf8',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Tasks
CREATE TABLE IF NOT EXISTS public.tasks (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email_id         TEXT,
  email_subject    TEXT    NOT NULL DEFAULT 'بدون عنوان',
  email_from       TEXT    DEFAULT '',
  email_from_name  TEXT    DEFAULT '',
  email_date       TIMESTAMPTZ DEFAULT NOW(),
  email_body       TEXT    DEFAULT '',
  ai_is_financial  BOOLEAN DEFAULT false,
  ai_summary       TEXT    DEFAULT '',
  ai_category      TEXT    DEFAULT '',
  has_excel        BOOLEAN DEFAULT false,
  has_pdf          BOOLEAN DEFAULT false,
  status           TEXT    NOT NULL DEFAULT 'analyzing'
                     CHECK (status IN (
                       'analyzing','pending_acc1','pending_acc2',
                       'approved_acc1','rejected_acc1',
                       'approved','rejected','not_financial'
                     )),
  assigned_to      UUID REFERENCES public.profiles(id),
  created_by       UUID REFERENCES public.profiles(id),
  priority         TEXT DEFAULT 'normal'
                     CHECK (priority IN ('low','normal','high','urgent')),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Attachments
CREATE TABLE IF NOT EXISTS public.attachments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id      UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  filename     TEXT NOT NULL,
  file_type    TEXT NOT NULL DEFAULT 'other'
                 CHECK (file_type IN ('excel','pdf','other')),
  storage_path TEXT,
  file_size    INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Task Actions (activity log)
CREATE TABLE IF NOT EXISTS public.task_actions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id    UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  user_id    UUID REFERENCES public.profiles(id),
  action     TEXT NOT NULL
               CHECK (action IN ('created','approved','rejected','comment','reassigned','analyzed')),
  notes      TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  task_id    UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT DEFAULT '',
  type       TEXT DEFAULT 'info'
               CHECK (type IN ('info','success','warning','error')),
  read       BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_admin"  ON profiles FOR ALL    TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- Tasks
CREATE POLICY "tasks_admin" ON tasks FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "tasks_assigned_select" ON tasks FOR SELECT TO authenticated
  USING (assigned_to = auth.uid());
CREATE POLICY "tasks_assigned_update" ON tasks FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid());

-- Attachments
CREATE POLICY "attach_admin" ON attachments FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "attach_task" ON attachments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND assigned_to = auth.uid())
);

-- Task actions
CREATE POLICY "actions_admin"  ON task_actions FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "actions_view"   ON task_actions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM tasks WHERE id = task_id AND assigned_to = auth.uid())
);
CREATE POLICY "actions_insert" ON task_actions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Notifications
CREATE POLICY "notif_own" ON notifications FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- ── Storage bucket ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-files', 'task-files', false)
ON CONFLICT DO NOTHING;

CREATE POLICY "storage_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-files');
CREATE POLICY "storage_read"   ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'task-files');
CREATE POLICY "storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'task-files');
