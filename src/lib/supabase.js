import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://pubtkfwmznfmffavyzsy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1YnRrZndtem5mbWZmYXZ5enN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDY4NjYsImV4cCI6MjA5MjYyMjg2Nn0.Ky-Fz9cyleSV8E84O7Zid5kZ_UTSDVaavgS_-yOvauI'
);
