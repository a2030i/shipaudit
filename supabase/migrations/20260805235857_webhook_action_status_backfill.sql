-- Repair historical webhook rows whose attachment was imported as an inbound
-- COD batch before the importer started writing webhook_events.processed_at.
-- Matching on the exact source filename is safe because cod_settlement import
-- is idempotent by source/upload reference; this changes inbox metadata only.

update public.webhook_events as event
set processed_at = coalesce(event.processed_at, batch.first_imported_at),
    processed_by = coalesce(event.processed_by, batch.imported_by)
from (
  select
    source_file,
    min(created_at) as first_imported_at,
    min(created_by::text)::uuid as imported_by
  from public.cod_settlement
  where direction = 'in'
    and nullif(btrim(source_file), '') is not null
  group by source_file
) as batch
where event.audit_id is null
  and event.processed_at is null
  and event.file_name = batch.source_file;
