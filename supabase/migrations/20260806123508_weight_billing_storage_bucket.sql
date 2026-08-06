-- Persist every generated Lamha weight workbook so accounting-cycle history
-- can download the exact same file without rebuilding or creating a new export.
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'weight-billing',
  'weight-billing',
  false,
  52428800
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;
