import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizePhoneForDisplay } from '../src/lib/presentationFormatters.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('RLA-03: confirmed Excel phone artifact is removed for presentation only', () => {
  assert.equal(normalizePhoneForDisplay("'+966508184944"), '+966508184944');
  assert.equal(normalizePhoneForDisplay('+966508184944'), '+966508184944');
  assert.equal(normalizePhoneForDisplay('0508184944'), '0508184944');
  assert.equal(normalizePhoneForDisplay(null), '');
  assert.equal(normalizePhoneForDisplay(undefined), '');
  assert.equal(normalizePhoneForDisplay(''), '');
});

test('RLA-03: LamhaStorePerformance renders phones through the central design-system formatter', async () => {
  const component = await source('src/components/LamhaStorePerformance.jsx');
  const designSystem = await source('src/design-system/EnterpriseUI.jsx');

  assert.match(component, /import \{ DataTable, PhoneNumber \} from '\.\.\/design-system\/EnterpriseUI\.jsx'/);
  assert.match(component, /row\.phone \? <PhoneNumber value=\{row\.phone\}\/> : null/);
  assert.doesNotMatch(component, /<span dir="ltr">\{row\.phone\}<\/span>/);
  assert.match(designSystem, /export function PhoneNumber\(\{ value, className = '' \}\)/);
  assert.match(designSystem, /normalizePhoneForDisplay\(value\)/);
});
