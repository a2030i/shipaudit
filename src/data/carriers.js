// ─── Storage keys ──────────────────────────────────────────────────────────────
const CARRIERS_KEY  = 'shipaudit_carriers_v2';
const SETTINGS_KEY  = 'shipaudit_settings_v1';
const AUDITS_KEY    = 'shipaudit_audits_v2';
const ARAMEX_APPROVED_FROM = '2026-07-01';
const ARAMEX_APPROVED_TO = '2026-07-31';
const ARAMEX_NAME_RE = /aramex|أرامكس|ارامكس/i;

// ─── Seed data ─────────────────────────────────────────────────────────────────
export const SEED_CARRIERS = [
  {
    id: 'smsa',
    name: 'سمسا SMSA',
    logo: '📦',
    color: '#D97706',
    contracts: [
      {
        id: 'smsa_c1',
        label: 'عقد 2025',
        startDate: '2025-01-01',
        endDate: null,
        rss: 0.16,
        rssStartDate: '2026-03-01',
        fuelPct: 0.15,
        pricing: {
          'United Arab Emirates': [
            { upTo: 1.0,  price: 28 },
            { upTo: null, pricePerUnit: 10, unitKg: 0.5 },
          ],
          'Kuwait': [
            { upTo: 1.0,  price: 28 },
            { upTo: null, pricePerUnit: 10, unitKg: 0.5 },
          ],
          'Bahrain': [
            { upTo: 1.0,  price: 28 },
            { upTo: null, pricePerUnit: 10, unitKg: 0.5 },
          ],
          'Qatar': [
            { upTo: 0.5,  price: 35 },
            { upTo: null, pricePerUnit: 14, unitKg: 0.5 },
          ],
          'Oman': [
            { upTo: 0.5,  price: 35 },
            { upTo: null, pricePerUnit: 14, unitKg: 0.5 },
          ],
        },
        notes: 'الوقود المتوقع 15% — الفعلي المفوتر 29.5%',
      },
    ],
  },
  {
    id: 'aramex',
    name: 'أرامكس Aramex',
    logo: '🚚',
    color: '#e2231a',
    contracts: [
      {
        id: 'aramex_domestic_2026',
        label: 'عقد محلي 2026',
        startDate: '2026-01-01',
        endDate: null,
        rss: 0,
        fuelPct: 0.10,
        // رسم خدمة "الدفع عند الاستلام" — فاتورة منفصلة (Billing Type=ZDCF)
        // مبلغ ثابت لكل شحنة، لا يتأثر بالوزن، ولا يحمّل وقود/RSS فوقه. الضريبة
        // تُضاف في طبقة المقارنة مع كشف الحساب (شامل ضريبة) — هنا نخزن المبلغ
        // الصافي قبل الضريبة فقط.
        codFee: 3,
        pricing: {
          'Saudi Arabia': [
            { upTo: 10,   price: 13 },                       // أول 10 كغ ثابت
            { upTo: null, pricePerUnit: 1, unitKg: 1 },      // 1 ر.س لكل كيلو إضافي
          ],
        },
        notes: 'تسعير محلي ثابت لكل المملكة. التصنيف عبر Billing Type=ZDOI أو AWB يبدأ بـ 5. ZDCF=رسم تحصيل دفع عند الاستلام (3 ر.س ثابت). الوقود 10%.',
      },
    ],
  },
];

// ─── Carriers CRUD ─────────────────────────────────────────────────────────────
export function applyApprovedAramexTerms(carriers = []) {
  return carriers.map(carrier => {
    if (!ARAMEX_NAME_RE.test(`${carrier?.id || ''} ${carrier?.name || ''}`)) return carrier;
    return {
      ...carrier,
      contracts: (carrier.contracts || []).map(contract => {
        const startsBeforePeriodEnds = (contract.startDate || '0000-01-01') <= ARAMEX_APPROVED_TO;
        const endsAfterPeriodStarts = !contract.endDate || contract.endDate >= ARAMEX_APPROVED_FROM;
        if (!startsBeforePeriodEnds || !endsAfterPeriodStarts) return contract;
        return { ...contract, fuelPct: 0.10, codFee: 3 };
      }),
    };
  });
}

export function loadCarriers() {
  try {
    const raw = localStorage.getItem(CARRIERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const normalized = applyApprovedAramexTerms(parsed);
      if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
        localStorage.setItem(CARRIERS_KEY, JSON.stringify(normalized));
      }
      return normalized;
    }
  } catch {}
  return SEED_CARRIERS;
}

export function saveCarriers(carriers) {
  localStorage.setItem(CARRIERS_KEY, JSON.stringify(carriers));
}

export function addCarrier(carriers, carrier) {
  return [...carriers, { ...carrier, id: carrier.id || `c_${Date.now()}` }];
}

export function updateCarrier(carriers, updated) {
  return carriers.map(c => c.id === updated.id ? updated : c);
}

export function deleteCarrier(carriers, id) {
  return carriers.filter(c => c.id !== id);
}

// ─── Contract helpers ──────────────────────────────────────────────────────────
export function getActiveContract(carrier, forDate) {
  const d = forDate || new Date().toISOString().slice(0, 10);
  const sorted = [...(carrier.contracts || [])].sort((a, b) =>
    (b.startDate || '').localeCompare(a.startDate || '')
  );
  return sorted.find(c => (c.startDate || '0000') <= d && (!c.endDate || c.endDate >= d))
    || sorted[0]
    || null;
}

// ─── Audits storage ────────────────────────────────────────────────────────────
export function loadAudits() {
  try {
    const raw = localStorage.getItem(AUDITS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function saveAudit(audit) {
  const audits = loadAudits();
  const idx = audits.findIndex(a => a.id === audit.id);
  if (idx >= 0) audits[idx] = audit;
  else audits.unshift(audit);
  // Keep last 50
  localStorage.setItem(AUDITS_KEY, JSON.stringify(audits.slice(0, 50)));
  return audits;
}

export function deleteAudit(id) {
  const audits = loadAudits().filter(a => a.id !== id);
  localStorage.setItem(AUDITS_KEY, JSON.stringify(audits));
  return audits;
}

// ─── Settings ──────────────────────────────────────────────────────────────────
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Object.prototype.hasOwnProperty.call(parsed || {}, 'openrouterKey')) {
        delete parsed.openrouterKey;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
      }
      return { ...parsed, openrouterKey: '' };
    }
  } catch {}
  return { openrouterKey: '', openrouterModel: 'google/gemini-2.0-flash-001' };
}

export function saveSettings(s) {
  const { openrouterKey: _discardedSecret, ...safe } = s || {};
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe));
}

// ─── Country list ──────────────────────────────────────────────────────────────
export const COUNTRIES = [
  'United Arab Emirates', 'Qatar', 'Kuwait', 'Oman', 'Bahrain',
  'Saudi Arabia', 'Egypt', 'Jordan', 'Turkey', 'Iraq', 'Lebanon',
  'Yemen', 'Libya', 'Sudan', 'Morocco', 'Tunisia', 'Other',
];
