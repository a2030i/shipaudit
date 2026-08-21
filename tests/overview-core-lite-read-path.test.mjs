import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  loadOverviewRead,
  loadOverviewLiteLazy,
  mergeOverviewLiteLazy,
} from '../src/lib/overviewService.js';

const sql = await readFile(new URL('../supabase/migrations/20260821213856_overview_core_lite.sql', import.meta.url), 'utf8');
const lazySql = await readFile(new URL('../supabase/migrations/20260821215657_overview_core_lite_lazy_sections.sql', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/lib/overviewService.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/Overview.jsx', import.meta.url), 'utf8');

test('overview core lite is additive, read-only and permission guarded', () => {
  assert.match(sql, /create or replace function public\.overview_core_lite/);
  assert.match(sql, /stable\s+security invoker/i);
  assert.match(sql, /crm_has_permission\('overview\.view'\)/);
  assert.match(sql, /revoke all on function public\.overview_core_lite\(text\) from public, anon/);
  assert.match(sql, /grant execute on function public\.overview_core_lite\(text\) to authenticated, service_role/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge|truncate)\b\s+(into|public\.|from)/i);
  assert.doesNotMatch(sql, /http|net\.|functions\.invoke|dblink/i);
});

test('overview core lite returns first-screen aggregates rather than detail collections', () => {
  assert.match(sql, /'financial',v_financial/);
  assert.match(sql, /'vat',v_vat/);
  assert.match(sql, /'actions',v_actions/);
  assert.match(sql, /'closeReadiness',v_close/);
  assert.match(sql, /'sources',v_sources/);
  assert.doesNotMatch(sql, /'customers'\s*,/);
  assert.doesNotMatch(sql, /'merchant(s)?'\s*,\s*coalesce\s*\(\s*\(select jsonb_agg/i);
  assert.doesNotMatch(sql, /'auditShipments'|'lamhaShipments'|'events'\s*,\s*coalesce\s*\(\s*\(select jsonb_agg/i);
});

test('overview core lite preserves the current receivables bucket boundaries', () => {
  assert.match(sql, /age_days between 0 and 15/);
  assert.match(sql, /age_days between 16 and 30/);
  assert.match(sql, /age_days between 31 and 60/);
  assert.match(sql, /age_days between 61 and 90/);
  assert.match(sql, /age_days > 90/);
  assert.match(sql, /line_kind='opening_balance'/);
  assert.match(sql, /greatest\(b90p-opening_balance,0\)/);
});

test('the production cutover uses one core request followed by two local lazy summaries', () => {
  assert.match(service, /VITE_OVERVIEW_READ_MODE \|\| 'lite'/);
  assert.match(service, /client\.rpc\('overview_core_lite'/);
  assert.match(service, /Promise\.all\(\[/);
  assert.match(service, /client\.rpc\('overview_merchant_pulse_lite'/);
  assert.match(service, /client\.rpc\('overview_cash_lite'/);
  assert.match(page, /requestIdleCallback/);
  assert.match(page, /mode: 'legacy'/);
  assert.doesNotMatch(lazySql, /http|net\.|functions\.invoke|dblink/i);
});

test('lazy summaries are additive, invoker-safe, permission scoped and contain no detail arrays', () => {
  for (const name of ['overview_merchant_pulse_lite', 'overview_cash_lite']) {
    assert.match(lazySql, new RegExp(`create or replace function public\\.${name}`));
    assert.match(lazySql, new RegExp(`revoke all on function public\\.${name}`));
    assert.match(lazySql, new RegExp(`grant execute on function public\\.${name}[^;]+to authenticated, service_role`));
  }
  assert.match(lazySql, /stable\s+security invoker/i);
  assert.match(lazySql, /crm_has_permission\('overview\.view'\)/);
  assert.doesNotMatch(lazySql, /jsonb_agg\([^)]*(merchant|customer|payment|bank_balance_log)/i);
  assert.doesNotMatch(lazySql, /\b(insert|update|delete|merge|truncate)\b\s+(into|public\.|from)/i);
});

test('lite adapter paints from one core call and reaches the complete page in exactly three calls', async () => {
  const calls = [];
  const client = {
    async rpc(name) {
      calls.push(name);
      if (name === 'overview_core_lite') return { data: {
        period: '2026-08', generatedAt: '2026-08-22T00:00:00Z',
        financial: { collectibleDue: 100, aging: { b0_15: 10, b16_30: 20, b31_60: 30, b61_90: 15, b90p: 25, total: 100 } },
        actions: { stopPostpaid: { count: 2, amount: 55 }, deductPrepaid: { count: 1, amount: 10 }, activatePostpaid: { count: 3 }, zatca: { count: 0, amount: 0, available: true }, draftInvoices: { count: 0, amount: 0 } },
        closeReadiness: { ready: false, completed: 2, required: 6, blockers: [] },
        sources: { finance: { status: 'fresh' }, merchants: { status: 'fresh' }, vat: { status: 'fresh' }, accountingCycle: { status: 'fresh' } },
        vat: null, drilldowns: {},
      }, error: null };
      if (name === 'overview_merchant_pulse_lite') return { data: { generatedAt: '2026-08-22T00:00:01Z', merchantPulse: { available: true, total: 10 }, lamhaUploads: {}, source: { status: 'fresh' } }, error: null };
      if (name === 'overview_cash_lite') return { data: { generatedAt: '2026-08-22T00:00:01Z', cashPosition: { bankBalance: 50, totalAP: 20 }, source: { status: 'fresh' } }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  };

  const initial = await loadOverviewRead({ period: '2026-08', mode: 'lite', client });
  assert.deepEqual(calls, ['overview_core_lite']);
  assert.equal(initial.overview.cashPosition.totalAR, 100);
  assert.equal(initial.overview.lazyStatus, 'pending');

  const lazy = await loadOverviewLiteLazy({ period: '2026-08', client });
  const complete = mergeOverviewLiteLazy(initial.overview, lazy.merchant, lazy.cash);
  assert.deepEqual(calls, ['overview_core_lite', 'overview_merchant_pulse_lite', 'overview_cash_lite']);
  assert.equal(complete.cashPosition.net, 130);
  assert.equal(complete.merchantPulse.total, 10);
  assert.equal(complete.lazyStatus, 'ready');
});
