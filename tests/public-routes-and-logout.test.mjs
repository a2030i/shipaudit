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

test('logout remains a named visible action in the global navigation hub', async () => {
  const app = await read('src/App.jsx');
  const hub = await read('src/components/NavigationHub.jsx');
  const css = await read('src/navigation-hub.css');

  assert.match(app, /onSignOut=\{signOut\}/);
  assert.match(hub, /className="navigation-hub__logout" onClick=\{onSignOut\} aria-label="تسجيل الخروج"/);
  assert.match(hub, /<span>خروج<\/span>/);
  assert.match(css, /\.navigation-hub__logout,[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.navigation-hub__logout\s*\{[\s\S]*color:\s*var\(--sa-danger/);
});

test('sign out clears sensitive browser state before ending the Supabase session', async () => {
  const auth = await read('src/lib/auth.jsx');
  const clearAt = auth.indexOf('clearSensitiveBrowserState();');
  const signOutAt = auth.indexOf('await supabase.auth.signOut();');
  assert.ok(clearAt > -1 && signOutAt > clearAt);
});
