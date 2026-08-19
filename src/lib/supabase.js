import { createClient } from '@supabase/supabase-js';

const defaultUrl = 'https://pubtkfwmznfmffavyzsy.supabase.co';
const defaultPublishableKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1YnRrZndtem5mbWZmYXZ5enN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDY4NjYsImV4cCI6MjA5MjYyMjg2Nn0.Ky-Fz9cyleSV8E84O7Zid5kZ_UTSDVaavgS_-yOvauI';

const runtimeEnv = import.meta.env || {};

export const supabase = createClient(
  runtimeEnv.VITE_SUPABASE_URL || defaultUrl,
  runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY
    || runtimeEnv.VITE_SUPABASE_ANON_KEY
    || defaultPublishableKey,
);
