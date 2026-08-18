create index if not exists zoho_bank_export_batches_exported_by_idx
  on public.zoho_bank_export_batches (exported_by)
  where exported_by is not null;
