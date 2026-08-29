import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Excel stays behind the explicit export action', () => {
  const service = read('src/lib/internalExportsService.js');
  assert.doesNotMatch(service, /^import\s+\*\s+as\s+XLSX\s+from\s+['"]xlsx['"]/m);
  assert.match(service, /xlsxPromise\s*\|\|=\s*import\(['"]xlsx['"]\)/);
  assert.match(service, /const XLSX = await loadXlsx\(\)/);
});

test('the shared export service has one static import contract', () => {
  for (const path of [
    'src/pages/HatifLeads.jsx',
    'src/pages/Overview.jsx',
    'src/pages/PlatformCarriers.jsx',
    'src/lib/carrierSoaExport.js',
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /import\(['"].*internalExportsService\.js['"]\)/, path);
    assert.match(source, /import\s*\{[^}]*persistAndDownloadExport[^}]*\}\s*from\s*['"].*internalExportsService\.js['"]/, path);
  }
});

test('large route-only vendors are isolated and guarded by explicit budgets', () => {
  const config = read('vite.config.js');
  assert.match(config, /shipaudit-bundle-size-budgets/);
  assert.match(config, /prefix:\s*['"]maplibre-['"],\s*max:\s*980_000/);
  assert.match(config, /p\.includes\(['"]\/maplibre-gl\/['"]\)\) return ['"]maplibre['"]/);
  assert.match(config, /this\.error\(`Bundle size budget exceeded:/);
});
