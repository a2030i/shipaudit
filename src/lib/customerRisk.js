// Customer risk scoring — turns the scattered anomaly flags into ONE
// 0–100 risk score per customer + an explicit "stop now" signal.
//
// The anomaly tags (prepaid_with_debt, negative_wallet, …) answer "what is
// wrong"; the risk score answers "how bad / who first"; `shouldStop`
// answers the operator's real question: "who do I suspend BEFORE the debt
// grows more?" (an active post-paid customer whose debt is already overdue
// or over-limit keeps shipping = keeps adding debt — stop the bleeding).
//
// Input `c` is a receivables customer row enriched with `merchant`:
//   c.total, c.daysOutstanding, c.overLimit, c.anomaly, c.anomalyExtras
//   c.merchant: { billingType, platformStatus, lastShipmentAt, walletBalance }

export function riskLevel(score) {
  if (score >= 70) return { key: 'critical', label: 'حرج',   color: '#DC2626' };
  if (score >= 45) return { key: 'high',     label: 'مرتفع', color: '#F97316' };
  if (score >= 25) return { key: 'medium',   label: 'متوسط', color: '#F59E0B' };
  return                  { key: 'low',      label: 'منخفض', color: '#10B981' };
}

export function computeRisk(c, { now = Date.now() } = {}) {
  const m     = c?.merchant || {};
  const debt  = Number(c?.total) || 0;
  const days  = Number(c?.daysOutstanding) || 0;
  const flags = new Set([c?.anomaly, ...(c?.anomalyExtras || [])].filter(Boolean));

  const reasons = [];
  let score = 0;
  const add = (pts, label) => { if (pts > 0) { score += pts; reasons.push({ label, points: pts }); } };

  // 1) Debt magnitude (0–25)
  if      (debt >= 50000) add(25, 'دين ضخم (≥50K)');
  else if (debt >= 20000) add(20, 'دين كبير (≥20K)');
  else if (debt >= 10000) add(14, 'دين مرتفع (≥10K)');
  else if (debt >= 3000)  add(8,  'دين متوسط (≥3K)');
  else if (debt > 0.5)    add(3,  'دين بسيط');

  // 2) Aging (0–25) — older debt is far harder to collect
  if      (days > 120) add(25, 'متأخّر +120 يوم');
  else if (days > 90)  add(20, 'متأخّر +90 يوم');
  else if (days > 60)  add(14, 'متأخّر +60 يوم');
  else if (days > 30)  add(7,  'متأخّر +30 يوم');

  // 3) Anomaly severity (0–30) — independent technical/financial red flags
  if (flags.has('prepaid_with_debt')) add(18, 'دفع مسبق وعليه دين (خلل تقني)');
  if (flags.has('negative_wallet'))   add(14, 'محفظة سالبة');
  if (flags.has('over_credit_limit')) add(14, 'تجاوز حد الائتمان');
  if (flags.has('inactive_with_debt'))add(12, 'موقوف بالمنصّة وعليه دين');

  // 4) Collectability (0–10) — a stopped store is gone; collect or write off
  if (m.platformStatus === 'غير نشط' && debt > 0.5) add(10, 'متجر موقوف — صعوبة التحصيل');

  score = Math.min(100, Math.round(score));

  // ── "Stop now" signal — the prevent-accumulation list ──
  const daysSinceShip = m.lastShipmentAt
    ? Math.floor((now - new Date(m.lastShipmentAt).getTime()) / 86_400_000)
    : null;
  const stillActive = m.platformStatus === 'نشط'
    || (daysSinceShip != null && daysSinceShip <= 14);
  const shouldStop = stillActive
    && m.billingType === 'دفع لاحق'
    && debt > 0.5
    && (days > 60 || !!c.overLimit);
  const stopReason = !shouldStop ? null
    : c.overLimit ? 'نشط + تجاوز حد الائتمان — الدين يتراكم'
    : 'نشط + متأخّر +60 يوم — الدين يتراكم';

  return { score, level: riskLevel(score), reasons, shouldStop, stopReason, daysSinceShip };
}

// Convenience: enrich a list and sort by risk desc.
export function rankByRisk(customers, opts) {
  return (customers || [])
    .map(c => ({ ...c, risk: computeRisk(c, opts) }))
    .sort((a, b) => b.risk.score - a.risk.score);
}
