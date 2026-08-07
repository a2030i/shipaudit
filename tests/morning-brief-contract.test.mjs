import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('morning brief preserves the six-variable template and adds an explicit expanded contract', async () => {
  const page = await read('src/pages/CustomerMoney.jsx');
  const service = await read('src/lib/whatsappService.js');
  const edge = await read('supabase/functions/morning-brief/index.ts');

  assert.match(page, /compact:\s*\['التاريخ'[\s\S]*'فواتير تنتظر نظرتك'\]/);
  assert.match(page, /expanded:\s*\[[\s\S]*'التكاملات وحداثة المصادر'/);
  assert.match(page, /تقرير إدارة موسّع/);
  assert.match(page, /brief-sections-grid/);
  assert.match(service, /reportMode:\s*'compact'/);
  assert.match(service, /report_mode:\s*cfg\.reportMode === 'expanded'/);
  assert.match(edge, /const compactVars = \[/);
  assert.match(edge, /const expandedVars = \[/);
  assert.match(edge, /cfg\?\.report_mode === 'expanded'/);
  assert.match(edge, /morning_brief_management_snapshot/);
});

test('expanded morning snapshot is read-only and callable only by service role', async () => {
  const sql = await read('supabase/migrations/20260807160357_expand_morning_management_brief.sql');

  assert.match(sql, /create or replace function public\.morning_brief_management_snapshot\(\)/i);
  assert.match(sql, /stable\s+security definer/i);
  assert.match(sql, /revoke all on function public\.morning_brief_management_snapshot\(\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.morning_brief_management_snapshot\(\) to service_role/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge)\s+(into|public\.)/i);
});

test('expanded morning brief has responsive dashboard layout', async () => {
  const css = await read('src/workspace-layout.css');

  assert.match(css, /\.morning-brief-dialog\s*\{[\s\S]*1080px/);
  assert.match(css, /\.brief-hero-metrics\s*\{[\s\S]*repeat\(4/);
  assert.match(css, /\.brief-sections-grid\s*\{[\s\S]*repeat\(2/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.brief-sections-grid[\s\S]*grid-template-columns:\s*1fr/);
});
