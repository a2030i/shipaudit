// مستندات لمحة الرسمية بصيغة PDF — الإقرار الضريبي وقائمة الدخل.
//
// الأسلوب: نبني صفحة HTML كاملة بهوية لمحة ونفتحها في نافذة طباعة، فيحفظها
// المستخدم PDF. لماذا لا jsPDF/pdfmake؟ كلاهما يحتاج تضمين خط عربي كامل
// (مئات الكيلوبايتات في الحزمة) ويكسر تشكيل الحروف واتجاه RTL في الجداول.
// محرّك طباعة المتصفح يرسم العربية مثالياً ويحترم @page — وهو نفس النهج
// المعتمد في التقرير الشهري (§1.21).
//
// الهوية الرسمية (§1.33): كحلي #333062 · أزرق ملكي #2B68DE · تركواز #31D5E1.

const NAVY  = '#333062';
const BLUE  = '#2B68DE';
const TEAL  = '#31D5E1';
const INK   = '#1F2430';
const MUTED = '#6B7280';
const LINE  = '#E3E6F0';

const money = (v) => (v == null || v === '' || Number.isNaN(Number(v)))
  ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const arDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${+d} ${names[+m - 1] || m} ${y}`;
};

// ── الهيكل المشترك: ترويسة بالشعار + محتوى + تذييل بالتوقيع ──
function shell({ title, subtitle, periodLine, bodyHtml, footNote }) {
  const origin = window.location.origin;
  const stamp = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  /* هوامش ضيّقة + مقاسات مضغوطة كي يقع الإقرار في **صفحة واحدة**
     (كان يفيض بضعة بكسلات فتُطبَع صفحة ثانية فارغة — بلاغ 2026-07-28) */
  @page { size: A4; margin: 8mm 5mm 7mm; }
  * { box-sizing: border-box; }
  html, body { height: auto; }
  body {
    margin: 0; color: ${INK};
    font-family: 'PingARLT','Janna LT','IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;
    font-size: 10.8px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .hdr {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    padding: 11px 15px; border-radius: 10px; color: #fff;
    background: linear-gradient(120deg, ${NAVY} 0%, #2E3F9E 60%, ${BLUE} 130%);
  }
  .hdr h1 { margin: 0; font-size: 15.5px; font-weight: 800; letter-spacing: 0; }
  .hdr .sub { font-size: 10.5px; opacity: .82; margin-top: 2px; }
  .hdr .period { font-size: 11px; color: ${TEAL}; font-weight: 700; margin-top: 3px; }
  .hdr img { height: 30px; }
  .sec { margin-top: 11px; }
  .sec h2 {
    font-size: 11.5px; font-weight: 800; color: ${NAVY}; margin: 0 0 5px;
    padding-inline-start: 8px; border-inline-start: 3px solid ${BLUE};
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 3.6px 8px; border-bottom: 1px solid ${LINE}; text-align: right; vertical-align: top; }
  thead th {
    background: #F3F5FB; color: ${NAVY}; font-size: 10px; font-weight: 800;
    border-bottom: 1.5px solid ${LINE};
  }
  td.num, th.num { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.box { color: ${MUTED}; font-weight: 700; width: 38px; }
  tr.zero td { color: #9AA1AF; }
  tr.total td { font-weight: 800; background: #FAFBFF; border-top: 1.5px solid ${LINE}; }
  .net {
    margin-top: 11px; padding: 9px 14px; border-radius: 10px;
    background: color-mix(in srgb, ${BLUE} 7%, #fff); border: 1.5px solid color-mix(in srgb, ${BLUE} 28%, #fff);
    display: flex; align-items: center; justify-content: space-between;
  }
  .net .lbl { font-weight: 800; color: ${NAVY}; font-size: 12.5px; }
  .net .val { font-weight: 800; font-size: 18px; color: ${BLUE}; font-variant-numeric: tabular-nums; }
  .net .val.credit { color: #059669; }
  .foot {
    margin-top: 12px; padding-top: 7px; border-top: 1px solid ${LINE};
    color: ${MUTED}; font-size: 9.5px; display: flex; justify-content: space-between; gap: 12px;
  }
  .sign { margin-top: 14px; display: flex; gap: 40px; }
  .sign div { flex: 1; }
  .sign .line { margin-top: 22px; border-top: 1px solid #B9BEE3; padding-top: 4px; font-size: 9.5px; color: ${MUTED}; }
  .note { margin-top: 7px; font-size: 9.5px; color: ${MUTED}; }
  @media print {
    .noprint { display: none !important; }
    /* لا صفحة ثانية فارغة: آخر عنصر بلا هامش سفلي ولا فاصل بعده،
       والكتل لا تُقسَّم بين صفحتين. */
    body > *:last-child { margin-bottom: 0 !important; page-break-after: avoid; }
    .sec, .net, .sign, table { page-break-inside: avoid; }
    tr { page-break-inside: avoid; }
  }
  .noprint {
    position: fixed; inset-block-start: 10px; inset-inline-start: 10px;
    background: ${BLUE}; color: #fff; border: 0; border-radius: 9px;
    padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer;
    font-family: inherit; box-shadow: 0 6px 18px rgba(43,104,222,.35);
  }
</style>
</head>
<body>
  <button class="noprint" onclick="window.print()">🖨 حفظ PDF / طباعة</button>
  <div class="hdr">
    <div>
      <h1>${esc(title)}</h1>
      <div class="sub">${esc(subtitle)}</div>
      <div class="period">${esc(periodLine)}</div>
    </div>
    <img src="${origin}/lamha-logo-white.png" alt="لمحة"
         onerror="this.style.display='none'">
  </div>
  ${bodyHtml}
  <div class="sign">
    <div><div class="line">المحاسب — الاسم والتوقيع</div></div>
    <div><div class="line">المدير المسؤول — الاسم والتوقيع</div></div>
  </div>
  <div class="foot">
    <span>${esc(footNote || '')}</span>
    <span>صدر من نظام لمحة · ${esc(stamp)}</span>
  </div>
</body></html>`;
}

function openPrint(html, fallbackName) {
  const w = window.open('', '_blank');
  if (!w) {
    // حاجب النوافذ المنبثقة — ننزّل الملف بدل الفشل الصامت
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fallbackName}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // ننتظر تحميل الشعار قبل فتح حوار الطباعة كي يظهر في الـPDF
  w.onload = () => setTimeout(() => w.focus(), 350);
  return true;
}

// ── الإقرار الضريبي ────────────────────────────────────────────────────
export function printVatReturn(r, { orgName = 'شركة لمحة' } = {}) {
  const rows = (list) => list.map(b => `
    <tr class="${(b.amount || b.tax) ? '' : 'zero'} ${['6','12'].includes(String(b.boxNo)) ? 'total' : ''}">
      <td class="box">${esc(b.boxNo)}</td>
      <td>${esc(b.label)}</td>
      <td class="num">${money(b.amount)}</td>
      <td class="num">${money(b.filingTax ?? b.tax)}</td>
      <td class="num">${money(b.adjustment)}</td>
    </tr>`).join('');

  const head = `<thead><tr>
      <th class="box">الخانة</th><th>البيان</th>
      <th class="num">المبلغ (قبل الضريبة)</th><th class="num">الضريبة</th><th class="num">التعديلات</th>
    </tr></thead>`;

  const due = r.totals.filingNetDue
    ?? r.totals.netDue
    ?? (r.totals.outputTax - r.totals.inputTax);
  const credit = due < 0;
  const rec = r.reconciliation;
  const reconciliationNote = rec?.hasMismatch ? `
    <div class="note" style="border:1px solid #F2B84B;background:#FFF8E8;color:#704A00">
      مطابقة زاتكا: صافي زوهو ${money(rec.zoho.netDue)} ر.س ·
      المتوقع عند الإيداع ${money(rec.filing.netDue)} ر.س ·
      الفرق ${money(rec.variance.netDue)} ر.س.
      أُعيد احتساب الخانتين 1 و7 فقط بنسبة 15%، وبقية التصنيف بقي كما هو من زوهو.
    </div>` : '';

  const body = `
    <div class="sec">
      <h2>المخرجات — المبيعات</h2>
      <table>${head}<tbody>${rows(r.output)}</tbody></table>
    </div>
    <div class="sec">
      <h2>المدخلات — المشتريات</h2>
      <table>${head}<tbody>${rows(r.input)}</tbody></table>
    </div>
    <div class="sec">
      <h2>صافي الضريبة</h2>
      <table><thead><tr><th class="box">الخانة</th><th>البيان</th><th class="num">المبلغ</th></tr></thead>
      <tbody>${r.net.map(b => `
        <tr class="${b.tax ? '' : 'zero'}">
          <td class="box">${esc(b.boxNo)}</td><td>${esc(b.label)}</td><td class="num">${money(b.filingTax ?? b.tax)}</td>
        </tr>`).join('')}</tbody></table>
    </div>
    <div class="net">
      <span class="lbl">${credit ? 'رصيد ضريبي دائن (لصالح المنشأة)' : 'صافي الضريبة المستحقة للهيئة'}</span>
      <span class="val ${credit ? 'credit' : ''}">${money(Math.abs(due))} ر.س</span>
    </div>
    <div class="note">
      ضريبة المخرجات للإيداع ${money(r.totals.filingOutputTax ?? r.totals.outputTax)} ر.س على مبيعات ${money(r.totals.outputAmount)} ر.س ·
      ضريبة المدخلات للإيداع ${money(r.totals.filingInputTax ?? r.totals.inputTax)} ر.س على مشتريات ${money(r.totals.inputAmount)} ر.س.
    </div>
    ${reconciliationNote}`;

  const html = shell({
    title: 'مسودة الإقرار الضريبي — ضريبة القيمة المضافة',
    subtitle: orgName,
    periodLine: `الفترة الضريبية: ${arDate(r.from)} — ${arDate(r.to)}`,
    bodyHtml: body,
    footNote: 'المصدر: زوهو بوكس · مطابقة حسابية مستقلة للخانتين 1 و7 قبل الإيداع في زاتكا',
  });
  return openPrint(html, `الإقرار_الضريبي_${r.from}_${r.to}`);
}

// ── قائمة الدخل ───────────────────────────────────────────────────────
export function printPnl({ from, to, sections }, { orgName = 'شركة لمحة' } = {}) {
  const out = [];
  let net = null;
  const walk = (secs, depth) => {
    for (const s of secs || []) {
      const name = s.name || s.total_label || '';
      const total = Number(s.total);
      const isNet = /صافي/.test(name);
      if (isNet && Number.isFinite(total) && net == null) net = total;
      if (name) {
        out.push(`<tr class="${depth === 0 ? 'total' : ''}">
          <td style="padding-inline-start:${9 + depth * 18}px">${esc(name)}</td>
          <td class="num">${Number.isFinite(total) ? money(total) : ''}</td>
        </tr>`);
      }
      if (s.account_transactions?.length) walk(s.account_transactions, depth + 1);
    }
  };
  walk(sections, 0);

  const body = `
    <div class="sec">
      <h2>قائمة الدخل</h2>
      <table>
        <thead><tr><th>البند</th><th class="num">المبلغ (ر.س)</th></tr></thead>
        <tbody>${out.join('')}</tbody>
      </table>
    </div>
    ${net != null ? `<div class="net">
      <span class="lbl">${net >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</span>
      <span class="val ${net >= 0 ? 'credit' : ''}">${money(Math.abs(net))} ر.س</span>
    </div>` : ''}`;

  const html = shell({
    title: 'قائمة الدخل (الأرباح والخسائر)',
    subtitle: orgName,
    periodLine: `الفترة: ${arDate(from)} — ${arDate(to)}`,
    bodyHtml: body,
    footNote: 'المصدر: زوهو بوكس — أساس الاستحقاق (accrual)',
  });
  return openPrint(html, `قائمة_الدخل_${from}_${to}`);
}
