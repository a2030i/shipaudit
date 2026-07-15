-- (١) مفتاح zoho.apply_credits الحسّاس — backfill لحاملي money.pnl فقط
-- (تضييق مقصود: كان receivables.view «عرض» يكفي لكتابة مالية في زوهو).
update profiles set permissions = coalesce(permissions, '{}'::jsonb)
  || '{"zoho.apply_credits": true}'::jsonb
where role = 'accountant' and coalesce(permissions->>'money.pnl', 'false') = 'true';

-- (٢) توحيد المتابعة: حالات «فرص من هاتف» → retargeting_followups الموحّد
-- (lead→interested · supplier/noise/converted أُضيفت للمفردات). لا دهس لموجود.
insert into retargeting_followups (phone, status, owner_id, notes, updated_at)
select phone,
  case status when 'lead' then 'interested' when 'supplier' then 'supplier'
              when 'noise' then 'noise' when 'converted' then 'converted'
              else 'new' end,
  owner_id, nullif(note, ''), coalesce(updated_at, now())
from hatif_unknown_contacts
where status <> 'new' or nullif(note, '') is not null or owner_id is not null
on conflict (phone) do nothing;
