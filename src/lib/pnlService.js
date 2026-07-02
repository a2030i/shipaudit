// pnlService — قائمة الدخل من Zoho Books عبر edge function `zoho-sync`.
//
// المصدر الحي: action=pnl_month (يجلب من زوهو، يحلّل، ويخزّن في pnl_snapshots).
// القراءة اليومية من الكاش (pnl_snapshots — صف لكل شهر) فلا نستهلك حصة
// الـAPI إلا عند التحديث الصريح أو غياب الشهر.
//
// القاعدة المحاسبية (من خطة الوكلاء): أرقام الربح من زوهو حصراً —
// «تحصيل COD ليس دخلاً، أمانة التجار تمرّ عبرنا».

import { supabase } from './supabase.js';

export const currentPnlPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const prevPnlPeriod = (p) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// كل الشهور المخزَّنة، الأحدث أولاً.
export async function loadPnlSnapshots() {
  const { data, error } = await supabase
    .from('pnl_snapshots')
    .select('*')
    .order('period', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// جلب/تحديث شهر من زوهو مباشرة (يكتب الكاش ويرجع الصف).
export async function refreshPnlMonth(period) {
  const { data, error } = await supabase.functions.invoke('zoho-sync', {
    body: { action: 'pnl_month', period },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || 'فشل جلب قائمة الدخل');
  return data.snapshot;
}

// حالة الربط (لبانر «غير مربوط» إن انقطع).
export async function loadZohoStatus() {
  const { data, error } = await supabase.functions.invoke('zoho-sync', {
    body: { action: 'status' },
  });
  if (error) return { connected: false };
  return data || { connected: false };
}

// تجميع ربع سنوي من snapshots المتوفرة. quarterOf('2026-05') = '2026-Q2'
export const quarterOf = (period) => {
  const [y, m] = period.split('-').map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
};
export function quarterTotals(snaps) {
  const q = new Map();   // '2026-Q2' → { net, income, months: [] }
  for (const s of snaps || []) {
    const k = quarterOf(s.period);
    if (!q.has(k)) q.set(k, { quarter: k, net: 0, income: 0, months: [] });
    const row = q.get(k);
    row.net += Number(s.net) || 0;
    row.income += Number(s.income) || 0;
    row.months.push(s.period);
  }
  return [...q.values()]
    .map(r => ({ ...r, net: +r.net.toFixed(2), income: +r.income.toFixed(2), complete: r.months.length === 3 }))
    .sort((a, b) => b.quarter.localeCompare(a.quarter));
}
