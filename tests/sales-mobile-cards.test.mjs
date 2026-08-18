import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('sales records use a dedicated mobile card instead of the global table-card fallback', async () => {
  const [retargeting, crm, merchants] = await Promise.all([
    read('src/pages/Retargeting.jsx'),
    read('src/pages/CrmWorkspace.jsx'),
    read('src/pages/Merchants.jsx'),
  ]);

  for (const source of [retargeting, crm, merchants]) {
    assert.match(source, /useMobileLayout\(\)/);
    assert.match(source, /<SalesMobileList>/);
    assert.match(source, /<SalesMobileCard/);
  }

  assert.match(retargeting, /actionLabel="متابعة"/);
  assert.match(crm, /selection=\{can\('crm\.assign'\)/);
  assert.match(merchants, /metrics=\{\[/);
});

test('mobile sales cards keep a compact two-column hierarchy and accessible interaction', async () => {
  const [component, css, hook] = await Promise.all([
    read('src/components/SalesMobileCard.jsx'),
    read('src/components/sales-mobile-card.css'),
    read('src/lib/useMobileLayout.js'),
  ]);

  assert.match(component, /role=\{interactive \? 'button'/);
  assert.match(component, /onKeyDown=\{openFromKeyboard\}/);
  assert.match(css, /\.sales-mobile__metrics\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.sales-mobile__metric\.is-wide\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(hook, /\(max-width: 768px\)/);
  assert.match(hook, /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/);
  assert.match(hook, /const subscribers = new Set\(\)/);
  assert.match(hook, /subscribers\.size === 1/);
  assert.match(css, /\.sales-mobile-card\s*\{[\s\S]*content-visibility:\s*auto/);
  assert.match(css, /contain-intrinsic-size:\s*auto 280px/);
});

test('Arabic merchant insight headings remove tracked uppercase styling on mobile', async () => {
  const [merchants, css] = await Promise.all([
    read('src/pages/Merchants.jsx'),
    read('src/components/sales-mobile-card.css'),
  ]);

  assert.match(merchants, /className="merchant-insight-title"/);
  assert.match(merchants, /className="merchant-insight-value-label"/);
  assert.match(css, /\.merchant-insight-title,[\s\S]*\.merchant-insight-value-label\s*\{[\s\S]*letter-spacing:\s*0 !important/);
  assert.match(css, /\.merchant-insights-panels\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) !important/);
});
