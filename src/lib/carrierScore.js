// carrierScore.js — درجة صحة الناقل الموحّدة (0–100). نقطة الحقيقة الوحيدة.
//
// قبلها كانت معادلتان متناقضتان تعطيان درجتين مختلفتين لنفس الناقل:
//   • Overview (جدول «صحة الناقلين»): عقوبات drift/mismatch/firstPass، عتبات 90/70
//   • CarrierKpi (بطاقة «تقييم»): متوسط موزون coverage/mismatch/disputes/pay، عتبات 80/60
// فيرى المستخدم 88 أخضر هنا و61 أصفر هناك ويفقد الثقة بالأرقام كلها.
//
// التصميم (على نمط customerRisk.js §1.19):
//   مكوّنات 0..1، كلٌّ بوزنه — يُحتسب المتاح فقط ويُعاد توزيع أوزان الغائب،
//   فتعمل الدرجة بنفس المقياس مهما اختلفت المدخلات المتوفرة لكل شاشة.
//
// | المكوّن    | الوزن | المصدر                                   |
// |-----------|------|-------------------------------------------|
// | drift     | 0.30 | فرق الفوترة % (فلوس حقيقية — الأثقل)      |
// | mismatch  | 0.20 | شحنات غير مطابقة % (جودة بيانات)          |
// | coverage  | 0.20 | نسبة الفواتير المدقَّقة                    |
// | firstPass | 0.10 | قبول أول مرة %                            |
// | disputes  | 0.10 | سرعة حلّ النزاعات (يوم)                   |
// | pay       | 0.10 | انتظام السداد (متوسط تأخّر بالأيام)        |
//
// العتبات الموحّدة: ≥85 جيد (أخضر) · 65–84 مقبول (كهرماني) · <65 ضعيف (أحمر)

const WEIGHTS = {
  drift:     0.30,
  mismatch:  0.20,
  coverage:  0.20,
  firstPass: 0.10,
  disputes:  0.10,
  pay:       0.10,
};

export function scoreLevel(score) {
  if (score >= 85) return { key: 'good', label: 'جيد',   color: 'var(--green)',  bg: 'rgba(16,185,129,.14)' };
  if (score >= 65) return { key: 'warn', label: 'مقبول', color: 'var(--warn)',   bg: 'rgba(245,158,11,.14)' };
  return                  { key: 'bad',  label: 'ضعيف',  color: 'var(--red)',    bg: 'rgba(220,38,38,.14)' };
}

// m: { driftPct?, mismatchPct?, coverage?, firstPassRate?, avgDisputeDays?, avgPayDays? }
// مرّر فقط المتاح — undefined/null = المكوّن غائب فيُستبعَد ويُعاد توزيع وزنه.
export function carrierScore(m = {}) {
  const parts = {};
  const has = v => v != null && Number.isFinite(Number(v));

  if (has(m.driftPct))       parts.drift     = 1 - Math.min(Math.abs(m.driftPct), 20) / 20;   // 20%+ فرق = صفر
  if (has(m.mismatchPct))    parts.mismatch  = 1 - Math.min(m.mismatchPct, 25) / 25;
  if (has(m.coverage))       parts.coverage  = Math.min(1, Math.max(0, m.coverage));           // نسبة 0..1
  if (has(m.firstPassRate))  parts.firstPass = Math.min(100, Math.max(0, m.firstPassRate)) / 100;
  if (has(m.avgDisputeDays)) parts.disputes  = Math.max(0, 1 - m.avgDisputeDays / 60);         // 60ي+ = صفر
  if (has(m.avgPayDays))     parts.pay       = Math.max(0, 1 - Math.max(0, m.avgPayDays) / 30);

  const keys = Object.keys(parts);
  if (!keys.length) return { score: null, level: null, parts };

  const totalW = keys.reduce((s, k) => s + WEIGHTS[k], 0);
  const raw = keys.reduce((s, k) => s + parts[k] * WEIGHTS[k], 0) / totalW;
  const score = Math.round(raw * 100);
  return { score, level: scoreLevel(score), parts };
}
