// يتتبّع سلسلة الاستيراد الثابتة من نقطة الدخول إلى مكتبة ثقيلة.
const fs = require('fs');
const path = require('path');

const TARGETS = [/^xlsx$/, /^pdfjs-dist/];
const root = process.argv[2] || 'src/main.jsx';

const readImports = (f) => {
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch { return []; }
  const out = [];
  // الاستيراد الثابت فقط (السطر يبدأ بـimport) — الديناميكي await import() لا يُحسب
  const re = /^[ \t]*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
};

const norm = (p) => p.split(path.sep).join('/');

const resolve = (from, spec) => {
  if (!spec.startsWith('.')) return spec;
  const p = norm(path.join(path.dirname(from), spec));
  for (const c of [p, p + '.js', p + '.jsx', p + '/index.js', p + '/index.jsx']) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
};

const seen = new Set([root]);
const parent = {};
const q = [root];
let found = 0;

while (q.length) {
  const f = q.shift();
  for (const spec of readImports(f)) {
    if (TARGETS.some((t) => t.test(spec))) {
      const chain = [];
      let c = f;
      while (c) { chain.push(c); c = parent[c]; }
      console.log(`>>> ${spec}\n    ${chain.reverse().join('\n    → ')}`);
      found++;
      continue;
    }
    const r = resolve(f, spec);
    if (!r || seen.has(r)) continue;
    seen.add(r);
    parent[r] = f;
    q.push(r);
  }
}
if (!found) console.log('✅ لا سلسلة استيراد ثابتة من نقطة الدخول إلى المكتبات الثقيلة');
console.log(`(فُحص ${seen.size} ملفاً)`);
