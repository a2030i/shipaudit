// تحويل خطوط الهوية من OTF إلى WOFF2.
//
// لماذا: الخطوط الثلاثة المستعملة فعلاً (Regular/Bold/Heavy) كانت تُنزَّل
// بصيغة OTF بـ457KB على شاشة الدخول — أكبر من حزمة الجافاسكربت كلها.
// WOFF2 هو نفس الخط بترميز أكفأ (Brotli داخل غلاف الخط): صفر تغيير بصري،
// ~60% أقل حجماً.
//
// الاستعمال بعد أي تحديث لملفات OTF:
//   node tools/fonts-to-woff2.cjs
// ثم تحقّق أن `src/index.css` يذكر الـwoff2 **قبل** الـotf في نفس القاعدة.
//
// ملاحظة: هذا ضغط لا تجزئة (subsetting). التجزئة العربية تحتاج fonttools
// (Python) وتوفّر أكثر بكثير — تُنفَّذ متى توفّرت البيئة.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'fonts');
const PATTERN = /^PingARLT-.*\.otf$/;

(async () => {
  let woff2;
  try {
    woff2 = require('wawoff2');
  } catch {
    console.error('ينقص wawoff2 — شغّل:  npm i -D wawoff2');
    process.exit(1);
  }

  const files = fs.readdirSync(DIR).filter((f) => PATTERN.test(f));
  if (!files.length) {
    console.error('لا ملفات OTF مطابقة في', DIR);
    process.exit(1);
  }

  let before = 0;
  let after = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f));
    const out = Buffer.from(await woff2.compress(src));
    const name = f.replace(/\.otf$/, '.woff2');
    fs.writeFileSync(path.join(DIR, name), out);
    before += src.length;
    after += out.length;
    const pct = (100 - (out.length / src.length) * 100).toFixed(0);
    console.log(
      `${name.padEnd(26)} ${(src.length / 1024).toFixed(0)}KB → ${(out.length / 1024).toFixed(0)}KB  (−${pct}%)`,
    );
  }
  console.log(
    `\nالإجمالي: ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB ` +
    `(−${(100 - (after / before) * 100).toFixed(0)}%)`,
  );
})();
