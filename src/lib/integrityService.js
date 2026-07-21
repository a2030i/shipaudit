// فحص السلامة الذاتي — wraps the integrity_check() RPC (Postgres does the
// heavy lifting) and decorates each check with Arabic labels, severity and
// a suggested destination/fix. A check with item_count=0 is healthy.

import { supabase } from './supabase.js';

// Metadata per check_key. `fix` names an auto-fix this service can run.
export const CHECK_META = {
  audit_no_ledger: {
    label: 'مراجعة معتمدة بلا أثر في الدفتر',
    desc:  'اعتُمدت لكن لا قيد INV ولا ربط بفاتورة RV — مبلغها غائب عن رصيد الناقل.',
    severity: 'red', goto: '/audits',
  },
  export_no_file: {
    label: 'سحبة مسجَّلة بلا ملف محفوظ',
    desc:  'سجل تصدير حالته «تم» لكن لا ملف في التخزين — لا يمكن إعادة تحميله.',
    severity: 'amber', goto: '/internal-exports',
  },
  weights_wrongly_skipped: {
    label: 'مراجعات مُتخطّاة رغم وجود أوزان',
    desc:  'عُلِّمت «بلا أوزان» لكن شحناتها الموزونة موجودة — أوزانها لن تصل للنظام الداخلي.',
    severity: 'amber', goto: '/internal-exports',
    fix: 'resetWronglySkipped', fixLabel: 'إرجاعها «جاهزة للسحب»',
  },
  cod_not_extracted: {
    label: 'اعتماد بلا تحصيل مستخرَج',
    desc:  'مراجعة ناقل تحصيله ضمن الفاتورة (audit_with_cod) اعتُمدت دون صفوف تحصيل — إن لم يكن التحصيل مرفوعاً يدوياً فهو مفقود من التسويات.',
    severity: 'amber', goto: '/cod-settlements',
  },
  cod_ledger_double: {
    label: 'قيد COD مزدوج مع إشعارات الكشف',
    desc:  'الناقل يحوّل تحصيله كإشعارات دائنة داخل كشفه، وقيد COD دفتري إضافي يكرّر الائتمان ويخفض الرصيد غلطاً.',
    severity: 'red', goto: '/ledger',
  },
  stale_unaudited_rv: {
    label: 'فواتير قديمة بلا تدقيق (+45 يوم)',
    desc:  'فواتير في الدفتر تجاوزت ٤٥ يوماً دون ربطها بمراجعة — قد تُسدَّد دون تحقق.',
    severity: 'amber', goto: '/ledger',
  },
  pay_no_bank_trace: {
    label: 'قيد سداد بلا أثر بنكي',
    desc:  'قيد PAY في الدفتر لا يقابله أي تحويل بنكي بنفس المبلغ (±0.5 ر.س، ±3 أيام) ضمن فترة كشوف البنك — سداد وهمي أو مكرر؟ فصّله من تقرير «المطابقة البنكية» في مركز التقارير.',
    severity: 'red', goto: '/reports',
  },
  carrier_cod_no_invoice: {
    label: 'ناقل يحصّل COD بلا أي فاتورة مدقَّقة',
    desc:  'الناقل عليه تحصيل COD نشط (آخر 60 يوماً) لكن لا فاتورة شحن واحدة مسجّلة في الدفتر — فواتيره تُدفع بلا تدقيق سعري (سمسا مثالاً). ارفع كشفه ودقّقه.',
    severity: 'red', goto: '/aramex-statements',
  },
  zoho_debt_no_invoices: {
    label: 'دين يعترف به زوهو بلا فواتير في المرآة',
    desc:  'زوهو يسجّل رصيداً مستحقاً على العميل لكن لا فواتير مفتوحة تقابله في مرآتنا — لا تراه أي حملة تحصيل. قد يكون رصيداً افتتاحياً يحتاج فوترة، أو إشعاراً عالقاً.',
    severity: 'amber', goto: '/customer-money',
  },
  audit_no_shipments: {
    label: 'مراجعة معتمدة بلا تفاصيل شحنات',
    desc:  'مراجعة قديمة معتمدة برقم صفوف لكن صفر شحنات محفوظة — لا يمكن مراجعة تفاصيلها. أعد بناءها من الملف الأصلي عند الحاجة.',
    severity: 'amber', goto: '/audits',
  },
};

export async function loadIntegrityChecks() {
  const { data, error } = await supabase.rpc('integrity_check');
  if (error) throw error;
  return (data ?? []).map(r => ({
    key:     r.check_key,
    count:   Number(r.item_count) || 0,
    total:   Number(r.total) || 0,
    samples: (r.sample_ids || '').split(',').map(s => s.trim()).filter(Boolean),
    ...(CHECK_META[r.check_key] || { label: r.check_key, desc: '', severity: 'amber', goto: null }),
  })).sort((a, b) => b.count - a.count);
}

// ── Auto-fixes ──────────────────────────────────────────────────────────────
// Reset wrongly-skipped audits back to pending so the next weights pull
// picks them up. Mirrors the manual repair of 2026-06-12: an audit is only
// reset when it really has weighted non-COD shipment rows.
export async function resetWronglySkipped(auditIds) {
  if (!auditIds?.length) return 0;
  const { data, error } = await supabase
    .from('audits')
    .update({ weight_billing_status: 'pending' })
    .in('id', auditIds)
    .eq('weight_billing_status', 'skipped')
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

export const FIXES = { resetWronglySkipped };
