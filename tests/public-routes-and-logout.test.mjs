import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public tools bypass the authenticated workspace with or without a trailing slash', async () => {
  const app = await read('src/App.jsx');

  assert.ok(app.includes("const normalizePublicPath = (pathname = '/') => pathname.replace(/\\/+$/, '') || '/';"));
  assert.match(app, /\['\/short-address', PublicShortAddress\]/);
  assert.match(app, /\['\/national-address', PublicShortAddress\]/);
  assert.match(app, /\['\/international-rates', PublicInternationalRates\]/);
  assert.match(app, /const PublicPage = PUBLIC_ROUTES\.get\(normalizePublicPath\(location\.pathname\)\)/);
  assert.match(app, /if \(PublicPage\)[\s\S]*<PublicPage\/>[\s\S]*return <AppInner/);
});

test('logout remains a named visible action in expanded and collapsed navigation', async () => {
  const app = await read('src/App.jsx');
  const css = await read('src/shipaudit-os-v2.css');

  assert.match(app, /sidebar-account\$\{collapsed \? ' is-collapsed' : ''\}/);
  assert.match(app, /className="sidebar-logout-action" onClick=\{signOut\}/);
  assert.match(app, /<span>تسجيل الخروج<\/span>/);
  assert.match(css, /sidebar-footer > \.sidebar-account > \.sidebar-logout-action\s*\{[\s\S]*display:\s*flex\s*!important/);
  assert.match(css, /\.sidebar\.collapsed \.sidebar-account__identity\s*\{[\s\S]*justify-content:\s*center\s*!important/);
});

test('sign out clears sensitive browser state before ending the Supabase session', async () => {
  const auth = await read('src/lib/auth.jsx');
  const clearAt = auth.indexOf('clearSensitiveBrowserState();');
  const signOutAt = auth.indexOf('await supabase.auth.signOut();');
  assert.ok(clearAt > -1 && signOutAt > clearAt);
});
