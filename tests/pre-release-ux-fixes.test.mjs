import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('customer directory search is semantic, keyboard navigable and URL-backed', async () => {
  const source = await read('src/pages/CustomerWatch.jsx');
  const css = await read('src/design-v5.css');
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(source, /event\.key === 'ArrowUp'/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /params\.set\('search'/);
  assert.match(source, /params\.set\('returnTo'/);
  assert.match(source, /get\('open'\) === '1' \? params\.get\('customer'\)/);
  assert.match(source, /get\('open'\) === '1'\) return;[\s\S]*setOpenCustomer\(null\)/);
  assert.match(css, /\.customer-search-hero[\s\S]*content-visibility: visible !important/);
});

test('sales growth profile closes before full customer navigation and inactive routes clear dialogs', async () => {
  const source = await read('src/pages/NextActions.jsx');
  const handler = source.slice(source.indexOf('onOpenFull={() =>'), source.indexOf('}/> : null}', source.indexOf('onOpenFull={() =>')));
  assert.match(handler, /setProfileRow\(null\)/);
  assert.match(handler, /setProfileData\(null\)/);
  assert.match(handler, /returnTo=/);
  assert.match(source, /if \(isActive\) return;[\s\S]*setProfileRow\(null\)/);
});

test('home separates availability, freshness and accounting-cycle close readiness', async () => {
  const service = await read('src/lib/overviewService.js');
  const view = await read('src/components/operations/FigmaCommandCenter.jsx');
  assert.match(service, /loadAccountingCycle\(thisPeriod\)/);
  assert.match(service, /accountingCycle\?\.prerequisiteComplete/);
  assert.match(service, /closeReadiness/);
  assert.match(view, /توفر المصادر/);
  assert.match(view, /حداثة البيانات/);
  assert.match(view, /جاهزية الإقفال/);
  assert.doesNotMatch(view, /const closePercent/);
});

test('modified sales and collections workspaces use canonical view and preserve legacy tab links', async () => {
  const sales = await read('src/pages/SalesHub.jsx');
  const collections = await read('src/pages/CollectionsHub.jsx');
  for (const source of [sales, collections]) {
    assert.match(source, /params\.get\('view'\) \|\| params\.get\('tab'\)/);
    assert.match(source, /params\.set\('view', next\)/);
    assert.match(source, /params\.delete\('tab'\)/);
  }
});

test('mobile pre-release rules keep aging options readable and loading compact', async () => {
  const css = await read('src/workspace-layout.css');
  assert.match(css, /\.collection-aging-options[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.collection-aging-option[\s\S]*min-height: 42px/);
  assert.match(css, /\.customer-money-page \.workspace-loading-state\.is-informative[\s\S]*min-height: 132px/);
  assert.match(css, /\.next-actions-context/);
});

test('shared modal has focus entry, focus containment and focus restoration', async () => {
  const source = await read('src/components/UI.jsx');
  assert.match(source, /closeButtonRef\.current\?\.focus/);
  assert.match(source, /e\.key !== 'Tab'/);
  assert.match(source, /previousFocus instanceof HTMLElement/);
});
