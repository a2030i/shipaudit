const HOUR = 60 * 60 * 1000;

const validTime = value => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

export function assessZohoHealth(zoho, now = Date.now()) {
  if (!zoho) {
    return {
      status: 'unavailable', healthy: false, syncFresh: false,
      syncAt: null, syncAge: Infinity, webhookReady: false,
      reasons: ['تعذّر التحقق من مصدر Zoho Books'],
    };
  }

  const syncAt = zoho.lastSyncAt || null;
  const syncTime = validTime(syncAt);
  const syncAge = syncTime == null ? Infinity : Math.max(0, now - syncTime);
  const syncFresh = syncAge <= 2 * HOUR;
  const webhookReady = Boolean(zoho.webhookReady);
  const reasons = [];
  if (!syncFresh) reasons.push(syncTime == null ? 'وقت مزامنة Zoho غير متاح' : 'مزامنة Zoho أقدم من ساعتين');
  if (!webhookReady) reasons.push('الاستقبال الفوري من Zoho غير مؤكد');

  return {
    status: reasons.length ? 'attention' : 'healthy',
    healthy: reasons.length === 0,
    syncFresh, syncAt, syncAge, webhookReady, reasons,
  };
}

export function assessHatifHealth({ delivery, callSync, zoho } = {}, now = Date.now()) {
  const total = Number(delivery?.total) || 0;
  const pending = Number(delivery?.pending) || 0;
  const observed = Math.max(0, total - pending);
  const failed = Number(delivery?.failed) || 0;
  const coverage = total ? Math.round((observed / total) * 100) : null;
  const failureRate = total ? Math.round((failed / total) * 100) : null;
  const syncAt = callSync?.synced_at || null;
  const syncTime = validTime(syncAt);
  const syncAge = syncTime == null ? Infinity : Math.max(0, now - syncTime);
  const syncFresh = syncAge <= 12 * HOUR;
  const zohoHealth = assessZohoHealth(zoho, now);
  const hasEvidence = Boolean(syncAt || total || zoho);
  const reasons = [];

  if (!syncFresh) reasons.push(syncTime == null ? 'آخر سحب لمكالمات هاتف غير متاح' : 'آخر سحب لمكالمات هاتف أقدم من 12 ساعة');
  if (coverage != null && coverage < 60) reasons.push(`تغطية حالات واتساب منخفضة (${coverage}%)`);
  if (failureRate != null && failureRate > 10) reasons.push(`نسبة فشل الرسائل مرتفعة (${failureRate}%)`);
  reasons.push(...zohoHealth.reasons);

  const status = !hasEvidence ? 'unavailable' : reasons.length ? 'attention' : 'healthy';
  return {
    status, healthy: status === 'healthy', reasons,
    total, pending, observed, failed, coverage, failureRate,
    syncAt, syncAge, syncFresh, zoho: zohoHealth,
  };
}
