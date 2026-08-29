import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const runtimeRoot = path.join(os.tmpdir(), 'store360-pilot-runtime', 'pkg');
const pgliteModule = path.join(runtimeRoot, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js');
const { PGlite } = await import(pathToFileURL(pgliteModule).href);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const sqlPath = path.join(here, 'store_360_core_isolated.sql');
const sql = await fs.readFile(sqlPath, 'utf8');
const db = new PGlite();

const q = async (text, params = []) => (await db.query(text, params)).rows;
const scalar = async (text, params = []) => Object.values((await q(text, params))[0] ?? {})[0];
const setActor = async (id) => {
  await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
};
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(3));
};
const money = (value) => Number(Number(value ?? 0).toFixed(2));
const day = (value) => value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const collectNodes = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node['Node Type']) out.push({
    nodeType: node['Node Type'],
    relation: node['Relation Name'] ?? null,
    index: node['Index Name'] ?? null,
    actualRows: node['Actual Rows'] ?? null,
    loops: node['Actual Loops'] ?? null,
    sharedHit: node['Shared Hit Blocks'] ?? 0,
    sharedRead: node['Shared Read Blocks'] ?? 0,
  });
  for (const child of node.Plans ?? []) collectNodes(child, out);
  return out;
};

const startedAt = new Date().toISOString();
const setupStart = performance.now();
await db.exec(sql);
const setupMs = performance.now() - setupStart;

const counts = {};
for (const table of [
  'merchants', 'customer_merchant_links', 'zoho_contacts', 'zoho_invoices',
  'zoho_payments', 'collection_tasks', 'retargeting_followups', 'merchant_lifecycle_events',
]) {
  counts[table] = Number(await scalar(`select count(*) from pilot_store360.${table}`));
}

const admin = '00000000-0000-0000-0000-000000000001';
const identity = '00000000-0000-0000-0000-000000000002';
const finance = '00000000-0000-0000-0000-000000000003';
const collector = '00000000-0000-0000-0000-000000000004';
const sales = '00000000-0000-0000-0000-000000000005';
const none = '00000000-0000-0000-0000-000000000006';

await setActor(admin);

const planRows = await q("explain (analyze,buffers,format json) select pilot_store360.store_360_core('847')");
const planDoc = Object.values(planRows[0])[0][0];
const internalPlanRows = await q(`
  explain (analyze,buffers,format json)
  with latest_store as (
    select m.* from pilot_store360.merchants m
    where m.snapshot_id=(select snapshot_id from pilot_store360.merchants order by uploaded_at desc limit 1)
      and m.store_id='847'
  ), exact_link as (
    select min(l.customer_name) customer_name
    from pilot_store360.customer_merchant_links l where l.store_id='847'
    having count(*)=1
  ), ar as (
    select a.* from pilot_store360.customer_ar a join exact_link l on l.customer_name=a.contact_name
  )
  select s.store_id,ar.zoho_id,ar.collectible_due,
         sum(cl.collectible_amount) bucket_sum,
         max(cl.age_days) oldest_age_days
  from latest_store s
  left join ar on true
  left join pilot_store360.customer_collectible_lines cl on cl.contact_id=ar.zoho_id and cl.collectible_amount>0.005
  group by s.store_id,ar.zoho_id,ar.collectible_due
`);
const internalPlanDoc = Object.values(internalPlanRows[0])[0][0];
const plan = {
  planningMs: Number(planDoc['Planning Time'].toFixed(3)),
  executionMs: Number(planDoc['Execution Time'].toFixed(3)),
  nodes: collectNodes(planDoc.Plan),
  representativeQuery: {
    planningMs: Number(internalPlanDoc['Planning Time'].toFixed(3)),
    executionMs: Number(internalPlanDoc['Execution Time'].toFixed(3)),
    nodes: collectNodes(internalPlanDoc.Plan),
  },
};

// Warm the Postgres-WASM runtime before recording latency.
for (let i = 1; i <= 30; i += 1) {
  await q('select pilot_store360.store_360_core($1) core', [String((i * 37) % 1500 + 1)]);
}

const newLatency = [];
for (let i = 1; i <= 500; i += 1) {
  const t = performance.now();
  await q('select pilot_store360.store_360_core($1) core', [String((i * 47) % 1500 + 1)]);
  newLatency.push(performance.now() - t);
}

const oldRequestSql = [
  "select snapshot_id from pilot_store360.merchants order by uploaded_at desc limit 1",
  "select * from pilot_store360.merchants where snapshot_id=(select snapshot_id from pilot_store360.merchants order by uploaded_at desc limit 1)",
  "select l.customer_name,ar.* from pilot_store360.customer_merchant_links l join pilot_store360.customer_ar ar on ar.contact_name=l.customer_name where l.store_id=$1 and ar.collectible_due>0.5 order by ar.collectible_due desc limit 1",
  "select * from pilot_store360.zoho_sync_state where entity in ('invoices','customerpayments')",
  "select * from pilot_store360.collection_tasks where customer_name=(select customer_name from pilot_store360.customer_merchant_links where store_id=$1 order by linked_at desc limit 1) order by updated_at desc limit 1",
  "select * from pilot_store360.retargeting_followups where phone=(select phone from pilot_store360.merchants where snapshot_id=(select snapshot_id from pilot_store360.merchants order by uploaded_at desc limit 1) and store_id=$1 limit 1) limit 1",
];
const oldLowerBoundLatency = [];
for (let i = 1; i <= 100; i += 1) {
  const storeId = String((i * 43) % 1500 + 1);
  const t = performance.now();
  for (const statement of oldRequestSql) await q(statement, statement.includes('$1') ? [storeId] : []);
  oldLowerBoundLatency.push(performance.now() - t);
}

const shadowRows = await q(`
  with latest_snapshot as (
    select snapshot_id from pilot_store360.merchants order by uploaded_at desc limit 1
  ), latest_stores as (
    select m.* from pilot_store360.merchants m join latest_snapshot s using(snapshot_id)
  )
  select m.store_id,
         pilot_store360.store_360_core(m.store_id) core,
         old_fin.customer_name old_customer_name,
         old_fin.zoho_id old_zoho_id,
         old_fin.collectible_due old_collectible_due,
         old_fin.overdue old_overdue,
         old_fin.due_today old_due_today,
         old_fin.inv_1_15 old_inv_1_15,
         old_fin.inv_16_30 old_inv_16_30,
         old_fin.inv_31_60 old_inv_31_60,
         old_fin.inv_61_90 old_inv_61_90,
         old_fin.inv_90p old_inv_90p,
         old_fin.opening_balance old_opening_balance,
         old_fin.last_payment_date,
         old_fin.last_payment_amount,
         links.link_count
  from latest_stores m
  left join lateral (
    select ar.contact_name customer_name, ar.zoho_id, ar.collectible_due,
      coalesce(a.overdue,0) overdue, coalesce(a.due_today,0) due_today,
      coalesce(a.inv_1_15,0) inv_1_15, coalesce(a.inv_16_30,0) inv_16_30,
      coalesce(a.inv_31_60,0) inv_31_60, coalesce(a.inv_61_90,0) inv_61_90,
      coalesce(a.inv_90p,0) inv_90p, coalesce(a.opening_balance,0) opening_balance,
      p.payment_date last_payment_date, p.payment_amount last_payment_amount
    from pilot_store360.customer_merchant_links l
    join pilot_store360.customer_ar ar on ar.contact_name=l.customer_name
    left join lateral (
      select
        sum(cl.collectible_amount) filter(where cl.line_kind='opening_balance' or lower(coalesce(cl.status,''))='overdue') overdue,
        sum(cl.collectible_amount) filter(where cl.line_kind='invoice' and cl.age_days=0) due_today,
        sum(cl.collectible_amount) filter(where cl.line_kind='invoice' and cl.age_days between 1 and 15) inv_1_15,
        sum(cl.collectible_amount) filter(where cl.line_kind='invoice' and cl.age_days between 16 and 30) inv_16_30,
        sum(cl.collectible_amount) filter(where cl.line_kind='invoice' and cl.age_days between 31 and 60) inv_31_60,
        sum(cl.collectible_amount) filter(where cl.line_kind='invoice' and cl.age_days between 61 and 90) inv_61_90,
        sum(cl.collectible_amount) filter(where cl.line_kind='invoice' and cl.age_days>90) inv_90p,
        sum(cl.collectible_amount) filter(where cl.line_kind='opening_balance') opening_balance
      from pilot_store360.customer_collectible_lines cl where cl.contact_id=ar.zoho_id and cl.collectible_amount>0.005
    ) a on true
    left join lateral (
      select zp.date payment_date,sum(zp.amount) payment_amount
      from pilot_store360.zoho_payments zp
      where zp.customer_name=ar.contact_name
        and zp.date=(select max(zp2.date) from pilot_store360.zoho_payments zp2 where zp2.customer_name=ar.contact_name)
      group by zp.date
    ) p on true
    where l.store_id=m.store_id and ar.collectible_due>0.5
    order by ar.collectible_due desc limit 1
  ) old_fin on true
  left join lateral (
    select count(*)::int link_count from pilot_store360.customer_merchant_links l where l.store_id=m.store_id
  ) links on true
  order by m.store_id::int
`);

const mismatchIds = [];
const mismatchSamples = [];
const ambiguousIds = [];
const matchedIds = [];
for (const row of shadowRows) {
  const linkStatus = row.core.sections.financialLink.status;
  if (Number(row.link_count) > 1) {
    ambiguousIds.push(row.store_id);
    continue;
  }
  const financeData = row.core.sections.finance.data;
  const paymentData = row.core.sections.lastPayment.data;
  const newValues = financeData ? {
    collectible: money(financeData.collectibleDue),
    overdue: money(financeData.overdue),
    dueToday: money(financeData.aging.dueToday),
    b1: money(financeData.aging.invoice1To15),
    b2: money(financeData.aging.invoice16To30),
    b3: money(financeData.aging.invoice31To60),
    b4: money(financeData.aging.invoice61To90),
    b5: money(financeData.aging.invoiceOver90),
    opening: money(financeData.aging.openingBalance),
    paymentDate: day(paymentData?.date),
    paymentAmount: paymentData ? money(paymentData.amount) : null,
  } : null;
  const oldValues = row.old_zoho_id ? {
    collectible: money(row.old_collectible_due), overdue: money(row.old_overdue),
    dueToday: money(row.old_due_today), b1: money(row.old_inv_1_15),
    b2: money(row.old_inv_16_30), b3: money(row.old_inv_31_60),
    b4: money(row.old_inv_61_90), b5: money(row.old_inv_90p),
    opening: money(row.old_opening_balance), paymentDate: day(row.last_payment_date),
    paymentAmount: row.last_payment_amount == null ? null : money(row.last_payment_amount),
  } : null;
  if (JSON.stringify(newValues) !== JSON.stringify(oldValues)) {
    mismatchIds.push(row.store_id);
    if (mismatchSamples.length < 5) mismatchSamples.push({ storeId: row.store_id, oldValues, newValues });
  }
  else matchedIds.push(row.store_id);
  if (linkStatus === 'ambiguous') mismatchIds.push(row.store_id);
}

const invariantRows = await q(`
  with latest_snapshot as (
    select snapshot_id from pilot_store360.merchants order by uploaded_at desc limit 1
  ), stores as (
    select store_id from pilot_store360.merchants where snapshot_id=(select snapshot_id from latest_snapshot)
  )
  select s.store_id, core,
    ar.collectible_due canonical_due,
    coalesce(lines.bucket_sum,0) canonical_bucket_sum,
    coalesce(lines.overdue,0) canonical_overdue
  from stores s
  cross join lateral (select pilot_store360.store_360_core(s.store_id) core) c
  left join pilot_store360.customer_merchant_links l on l.store_id=s.store_id
  left join pilot_store360.customer_ar ar on ar.contact_name=l.customer_name
  left join lateral (
    select sum(cl.collectible_amount) bucket_sum,
           sum(cl.collectible_amount) filter(where cl.line_kind='opening_balance' or lower(coalesce(cl.status,''))='overdue') overdue
    from pilot_store360.customer_collectible_lines cl
    where cl.contact_id=ar.zoho_id and cl.collectible_amount>0.005
  ) lines on true
  where (select count(*) from pilot_store360.customer_merchant_links lx where lx.store_id=s.store_id)=1
    and ar.collectible_due>0.5
`);
const invariantMismatches = [];
const invariantSamples = [];
for (const row of invariantRows) {
  const f = row.core.sections.finance.data;
  if (!f) { invariantMismatches.push(row.store_id); continue; }
  const a = f.aging;
  const buckets = money(a.dueToday) + money(a.invoice1To15) + money(a.invoice16To30) +
    money(a.invoice31To60) + money(a.invoice61To90) + money(a.invoiceOver90) + money(a.openingBalance);
  if (money(f.collectibleDue) !== money(row.canonical_due) ||
      money(a.bucketsTotal) !== money(row.canonical_bucket_sum) ||
      money(a.bucketsTotal) !== money(buckets) ||
      money(a.reconciledTotal) !== money(f.collectibleDue) ||
      money(a.unallocatedDifference) !== money(f.collectibleDue)-money(a.bucketsTotal) ||
      a.reconciliationStatus !== (Math.abs(money(f.collectibleDue)-money(a.bucketsTotal))<=0.01 ? 'matched' : 'needs_review') ||
      money(f.overdue) !== money(row.canonical_overdue)) {
    invariantMismatches.push(row.store_id);
    if (invariantSamples.length < 5) invariantSamples.push({
      storeId: row.store_id,
      coreDue: money(f.collectibleDue), canonicalDue: money(row.canonical_due),
      canonicalBucketSum: money(row.canonical_bucket_sum), coreBucketSum: money(buckets),
      unallocatedDifference: money(a.unallocatedDifference), reconciliationStatus: a.reconciliationStatus,
      coreOverdue: money(f.overdue), canonicalOverdue: money(row.canonical_overdue),
    });
  }
}

const callCore = async (actor, storeId) => {
  await setActor(actor);
  return (await q('select pilot_store360.store_360_core($1) core', [storeId]))[0].core;
};
const permissionResults = {};
for (const [label, actor] of Object.entries({ identity, finance, collector, sales })) {
  const storeId = label === 'collector' ? '6' : '100';
  const core = await callCore(actor, storeId);
  permissionResults[label] = Object.fromEntries(Object.entries(core.sections).map(([key, section]) => [key, section.visibility]));
}
const collectorOwn = await callCore(collector, '34');
const collectorOther = await callCore(collector, '35');
permissionResults.collectorOwnership = {
  ownTaskVisible: collectorOwn.sections.collections.data?.taskId != null,
  otherTaskHidden: collectorOther.sections.collections.data == null,
};
const rejection = {};
for (const [label, actor] of Object.entries({ none, unauthenticated: null })) {
  try {
    await setActor(actor);
    await q("select pilot_store360.store_360_core('100')");
    rejection[label] = false;
  } catch (error) {
    rejection[label] = /not_allowed|not_authenticated/.test(String(error));
  }
}
permissionResults.rejections = rejection;
permissionResults.inputContract = {};
for (const [label, value] of Object.entries({ storeName: 'Store 100', phone: '+966500000100', empty: '' })) {
  try {
    await setActor(admin);
    await q('select pilot_store360.store_360_core($1)', [value]);
    permissionResults.inputContract[label] = false;
  } catch (error) {
    permissionResults.inputContract[label] = /store_not_found|invalid_store_id/.test(String(error));
  }
}
permissionResults.acl = {
  authenticated: await scalar("select has_function_privilege('authenticated','pilot_store360.store_360_core(text)','execute')"),
  anon: await scalar("select has_function_privilege('anon','pilot_store360.store_360_core(text)','execute')"),
  public: await scalar("select has_function_privilege('public','pilot_store360.store_360_core(text)','execute')"),
};
const restrictedCore = await callCore(identity, '100');
permissionResults.noRestrictedLeak = ['finance', 'lastPayment', 'collections', 'financialLink'].every((key) => {
  const section = restrictedCore.sections[key];
  return section.visibility === 'restricted' && section.data == null && section.source == null;
});

await setActor(admin);
const requiredCases = {
  withoutFinancialLink: await callCore(admin, '1200'),
  withReceivables: await callCore(admin, '100'),
  withoutReceivables: await callCore(admin, '950'),
  withPromise: await callCore(admin, '36'),
  multipleSnapshots: {
    storeId: '847',
    snapshotCount: Number(await scalar("select count(*) from pilot_store360.merchants where store_id='847'")),
    core: await callCore(admin, '847'),
  },
  sharedPhone: {
    store1499: await callCore(admin, '1499'),
    store1500: await callCore(admin, '1500'),
  },
};

const freshCore = await callCore(admin, '100');
await q("update pilot_store360.zoho_sync_state set last_sync=now()-interval '3 hours',last_status='succeeded',last_error=null where entity='invoices'");
const staleCore = await callCore(admin, '100');
await q("update pilot_store360.zoho_sync_state set last_status='failed',last_error='synthetic_timeout' where entity='invoices'");
const failedCore = await callCore(admin, '100');
await q("update pilot_store360.zoho_sync_state set last_sync=null,last_status='failed',last_error='synthetic_unavailable' where entity='invoices'");
const unavailableCore = await callCore(admin, '100');
const freshness = {
  freshStatus: freshCore.sections.finance.source.freshnessStatus,
  staleStatus: staleCore.sections.finance.source.freshnessStatus,
  failedStatus: failedCore.sections.finance.source.freshnessStatus,
  failedAvailability: failedCore.sections.finance.source.availabilityStatus,
  unavailableStatus: unavailableCore.sections.finance.source.freshnessStatus,
  unavailableAvailability: unavailableCore.sections.finance.source.availabilityStatus,
  lastKnownValuePreserved: money(freshCore.sections.finance.data.collectibleDue) === money(failedCore.sections.finance.data.collectibleDue),
  unavailableDoesNotBecomeZero: money(freshCore.sections.finance.data.collectibleDue) === money(unavailableCore.sections.finance.data.collectibleDue),
  failedIsNotZero: money(failedCore.sections.finance.data.collectibleDue) > 0,
};

const result = {
  startedAt,
  finishedAt: new Date().toISOString(),
  isolatedEngine: 'PGlite PostgreSQL-WASM 0.3.14',
  setupMs: Number(setupMs.toFixed(1)),
  syntheticCounts: counts,
  requestModel: {
    oldCodeDerivedMinimum: '12+ local DB/API requests plus pagination',
    oldMeasuredLowerBoundQueries: oldRequestSql.length,
    newQueries: 1,
  },
  latencyMs: {
    oldLowerBound: { p50: percentile(oldLowerBoundLatency, 50), p75: percentile(oldLowerBoundLatency, 75), p95: percentile(oldLowerBoundLatency, 95) },
    newCore: { p50: percentile(newLatency, 50), p75: percentile(newLatency, 75), p95: percentile(newLatency, 95) },
  },
  explain: plan,
  shadow: {
    sampleSize: shadowRows.length,
    exactMatches: matchedIds.length,
    financialMismatchCount: [...new Set(mismatchIds)].length,
    financialMismatchIds: [...new Set(mismatchIds)].slice(0, 50),
    financialMismatchIdsTruncated: [...new Set(mismatchIds)].length > 50,
    mismatchSamples,
    ambiguousLinkCount: ambiguousIds.length,
    ambiguousStoreIds: ambiguousIds,
  },
  financialInvariants: {
    testedStores: invariantRows.length,
    mismatchCount: invariantMismatches.length,
    mismatchStoreIds: invariantMismatches.slice(0, 50),
    mismatchStoreIdsTruncated: invariantMismatches.length > 50,
    mismatchSamples: invariantSamples,
  },
  permissions: permissionResults,
  freshness,
  requiredCases: {
    withoutFinancialLink: { storeId: '1200', link: requiredCases.withoutFinancialLink.sections.financialLink.status, finance: requiredCases.withoutFinancialLink.sections.finance.status },
    withReceivables: { storeId: '100', due: requiredCases.withReceivables.sections.finance.data.collectibleDue },
    withoutReceivables: { storeId: '950', finance: requiredCases.withoutReceivables.sections.finance.status },
    withPromise: { storeId: '36', collection: requiredCases.withPromise.sections.collections.status, promiseAmount: requiredCases.withPromise.sections.collections.data?.promiseAmount ?? null },
    multipleSnapshots: { storeId: '847', snapshotCount: requiredCases.multipleSnapshots.snapshotCount, selectedStoreId: requiredCases.multipleSnapshots.core.storeId },
    sharedPhone: {
      storeIds: ['1499', '1500'],
      store1499Identity: requiredCases.sharedPhone.store1499.sections.identity.data.storeId,
      store1500Identity: requiredCases.sharedPhone.store1500.sections.identity.data.storeId,
      financialStatuses: [requiredCases.sharedPhone.store1499.sections.finance.status, requiredCases.sharedPhone.store1500.sections.finance.status],
    },
  },
};

console.log(JSON.stringify(result, null, 2));
await db.close();
