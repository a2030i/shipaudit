// crmLeadsService.js — external ecommerce leads for sales CRM.
//
// This importer is intentionally stricter than the old upload:
// - Phones are normalized to the Saudi international form: 966...
// - Exact repeated leads are skipped, but same-phone/different-store rows
//   are kept and clearly flagged for the sales team.
// - Leads whose phone already exists in the platform merchants snapshot
//   are retained with matched_store_* metadata instead of being hidden.

import { supabase } from './supabase.js';
import { normalizeName } from './crmService.js';
import { loadLatestMerchants } from './merchantsService.js';

const PAGE = 50;   // كان 500 — جلب/رسم 500 صفّ×33 عمود = بطء شديد على 51 ألف
const SUPABASE_PAGE = 1000;
const CACHE_TTL_MS = 2 * 60 * 1000;
const META_CACHE_TTL_MS = 5 * 60 * 1000;
const LEAD_COLUMNS = [
  'id', 'name', 'name_normalized', 'name_en',
  'phone', 'phone_normalized', 'whatsapp', 'whatsapp_normalized', 'email',
  'city', 'category', 'address', 'website', 'platform', 'store_url',
  'social_links', 'notes', 'source', 'snapshot_id', 'status',
  'owner_id', 'created_by', 'created_at', 'updated_at',
  'duplicate_key', 'duplicate_count', 'duplicate_names',
  'matched_store_id', 'matched_store_name', 'matched_store_status',
  'matched_store_billing_type', 'matched_store_shipments',
  'matched_store_last_shipment_at', 'matched_store_wallet',
  // من view crm_leads_campaign: آخر حملة واتساب لكل جهة (2026-07-16)
  'last_campaign_at', 'last_campaign_status', 'last_campaign_template', 'last_campaign_replied_at',
].join(',');

const listCache = new Map();
let metaCache = { at: 0, data: null, promise: null };

function cacheKey(parts) {
  return JSON.stringify(parts || {});
}

export function invalidateLeadCaches() {
  listCache.clear();
  metaCache = { at: 0, data: null, promise: null };
}

async function selectAllRows(makeQuery, pageSize = SUPABASE_PAGE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    // فخّ §6: ترتيب غير فريد (created_at وحده) يُكرّر صفوفاً بين الصفحات على
    // جدول 51K+ صف. نفرض id كـtiebreaker هنا فرضاً لا اتفاقاً — يُلحَق بعد
    // ترتيب الـcaller فلا يغيّر الفرز الظاهر، فقط يجعله حتمياً.
    const { data, error } = await makeQuery().order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

function toText(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function toPhoneString(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return String(Math.round(v));
  return String(v).trim() || null;
}

function toAsciiDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

export function normalizeSaudiPhone(v) {
  let s = toAsciiDigits(toPhoneString(v) || '').replace(/\D/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('9660')) s = `966${s.slice(4)}`;
  else if (s.startsWith('0')) s = `966${s.slice(1)}`;
  else if (!s.startsWith('966')) s = `966${s}`;
  // Keep common Saudi phone forms only. This accepts mobile, landline,
  // and unified numbers after country prefix, while rejecting short junk.
  if (!/^966\d{8,10}$/.test(s)) return null;
  return s;
}

// جوال سعودي حقيقي لصفحة «ليسوا عملاء لنا»: يجب أن يبدأ بـ 9665 ثم 8 أرقام
// (12 رقماً إجمالاً)، ويرفض الأرقام الوهمية (كل أرقام المشترك متطابقة مثل
// 966500000000 / 966555555555). يُستخدَم في الرفع والإضافة والتعديل.
export function isRealSaudiMobile(v) {
  const s = normalizeSaudiPhone(v);
  if (!s || !/^9665\d{8}$/.test(s)) return false;   // 9665 + 8 أرقام
  if (/^(\d)\1{7}$/.test(s.slice(4))) return false; // أرقام المشترك كلها متطابقة = وهمي
  if (/(\d)\1{5}$/.test(s)) return false;           // ينتهي بـ6 خانات متطابقة (…000000) = placeholder
  if (s === '966512345678') return false;           // placeholder «اكتب أي رقم» شائع
  return true;
}

// اسم جهة وهمي/سبام يُرفَض عند الرفع والإضافة (قواعد التنظيف الصارمة 2026-07-22).
// نصوص العرض فقط — لا يمسّ الأرقام. مبنيّ على فحص 89,671 صفاً فعلياً.
// جوهر اسم الجهة لغرض إزالة التكرار: يزيل بادئات عامة (متجر/محل/شركة/مؤسسة/
// سوق/ستور/store/shop/the) من الاسم **المطبَّع** فيتساوى «تراكيب» و«متجر تراكيب».
// يُطبَّق على طرفي المقارنة (الموجود + الجديد). فراغ بعد التجريد → يرجع الأصل
// (كي لا تتصادم كل «متجر X» ذات الجوهر الفارغ).
const LEAD_PREFIX_RE = /^(?:متجر|محل|شركه|مؤسسه|موسسه|سوق|ستور|store|shop|the)\s+/;
function dedupCore(norm) {
  let s = String(norm || '');
  let prev;
  do { prev = s; s = s.replace(LEAD_PREFIX_RE, ''); } while (s !== prev);
  return s.trim() || String(norm || '').trim();
}

// توحيد المنصّة: الإنجليزي = العربي (Salla→سلة · Zid→زد). يطابق canon SQL.
export function canonPlatform(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (/^salla$/i.test(s) || s === 'سلة') return 'سلة';
  if (/^zid$/i.test(s) || s === 'زد') return 'زد';
  return s || null;
}
// دمج الأقسام لـ11 رئيسياً — يأخذ ما قبل «—» ثم يطابق بالكلمة المفتاحية.
// نسخة JS من canon_lead_category (SQL) — تبقيان متطابقتين.
export function canonLeadCategory(c) {
  if (!c) return null;
  const head = String(c).replace(/[—–-]/g, '—').split('—')[0].replace(/\s+/g, ' ').trim();
  if (!head) return null;
  if (/تسويق|حلول إلكتروني|تصميم|طباعة|تصوير|لوجست|إدار|خدمات الأعمال|دراسات|استشار|برمج|تقني|موقع/.test(head)) return 'خدمات الأعمال';
  if (/مستلزمات المرأة|كوافير|تجميل|عناية|عطور|صحة|لياقة|الجمال/.test(head)) return 'الجمال والصحة';
  if (/مطبخ|مخبوز|قهوة|مشروب|أطعم|اطعم|طعام|حلوي|بن|تمر/.test(head)) return 'أطعمة ومشروبات';
  if (/إلكترون|الكترون|اكسسوار|جوال|كمبيوتر|تقنية/.test(head)) return 'إلكترونيات';
  if (/أثاث|اثاث|ديكور|منزل|مفروش/.test(head)) return 'المنزل';
  if (/حرف|يدوي|هدايا|هديه|متسوق|ورد|زهور/.test(head)) return 'هدايا';
  if (/مناسبات|حفل|تنسيق|فعاليات/.test(head)) return 'حفلات';
  if (/أكاديمي|اكاديمي|تعليم|دورات|تدريب|مدرس/.test(head)) return 'التعليم';
  if (/عقار/.test(head)) return 'العقارات';
  if (/سيارات|سياره|مركبات/.test(head)) return 'السيارات';
  if (/أزياء|ازياء|ملابس|موضة|عباي|أحذية|حقائب/.test(head)) return 'أزياء';
  if (/أطفال|اطفال|مواليد|ألعاب|العاب/.test(head)) return 'أطفال وألعاب';
  if (head === 'أخرى' || head === 'اخرى') return 'أخرى';
  return head;
}

export function isJunkLeadName(name) {
  const raw = String(name ?? '').trim();
  if (raw.replace(/\s/g, '').length <= 1) return true;               // فارغ/حرف واحد
  const digits = toAsciiDigits(raw);
  if (/^[0-9\s+._\-()]+$/.test(digits)) return true;                 // أرقام/رموز فقط (لا اسم)
  if (/(test|dummy|asdf|xxx|تجربة|تجريبي|وهمي|لا ?يوجد|بلا اسم)/i.test(raw)) return true; // اختبار
  if (/(استثمر|عملات رقمية|العملات الرقمية|ارباح يومي|أرباح يومي|راس مالك|رأس مالك|فوركس|forex|تداول الذهب|بيع عملات)/i.test(raw)) return true; // سبام مالي
  if (/(أرامكو|ارامكو|صندوق الاستثمارات العامة)/.test(raw)) return true; // انتحال جهة رسمية
  return false;
}

function pickFirstPhone(...values) {
  for (const v of values) {
    const p = normalizeSaudiPhone(v);
    if (p) return p;
  }
  return null;
}

function normalizeHeader(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ـًٌٍُِّْ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// المرادفات تشمل صيغة تصدير دليل سلة العام (nameAr/whatsup/businessType.name/
// address.city.name…) — تُطابَق بعد normalizeHeader (يُبقي النقاط، يخفض الحالة).
const HEADER_KEYS = {
  rowNo:        ['#', 'م', 'serial'],
  category:     ['القسم', 'التصنيف', 'category', 'businesstype.name', 'businesstype'],
  subCategory:  ['businesssubtype.name', 'businesssubtype', 'subcategory'],
  name:         ['اسم المتجر - عربي', 'اسم المتجر', 'المتجر', 'الجهة', 'namear', 'name ar', 'name', 'store name', 'merchant'],
  nameEn:       ['اسم المتجر - انجليزي', 'اسم المتجر - إنجليزي', 'nameen', 'english name', 'name en'],
  phone:        ['رقم الجوال', 'الجوال', 'mobile', 'contactdetails.customerservicenumber', 'customerservicenumber', 'customer service number'],
  phoneAlt:     ['رقم الهاتف', 'الهاتف', 'phone'],
  unifiedPhone: ['الرقم الموحد', 'unified'],
  whatsapp:     ['رقم واتس آب', 'رقم واتساب', 'whatsapp number', 'whatsup', 'whatsapp'],
  whatsappLink: ['رابط واتساب', 'رابط واتس آب', 'whatsapp link'],
  address:      ['عنوان المتجر', 'العنوان', 'address'],
  city:         ['address.city.name', 'المدينة', 'city'],
  region:       ['address.region.name', 'المنطقة', 'region'],
  district:     ['address.district.name', 'الحي', 'district'],
  street:       ['address.streetname', 'الشارع', 'streetname', 'street'],
  email:        ['البريد الإلكتروني', 'الايميل', 'الإيميل', 'contactdetails.email', 'email', 'e-mail'],
  website:      ['الموقع الإلكتروني', 'الموقع الالكتروني', 'website', 'site'],
  platform:     ['salla / zid', 'salla/zid', 'سلة / زد', 'منصة', 'platform'],
  rating:       ['rating', 'التقييم'],
  reviews:      ['totalreviews', 'total reviews', 'عدد التقييمات'],
  instagram:    ['إنستجرام', 'انستجرام', 'instagram'],
  facebook:     ['فيس بوك', 'facebook'],
  twitter:      ['تويتر', 'twitter'],
  telegram:     ['تليجرام', 'telegram'],
  snapchat:     ['سناب شات', 'سناب', 'snapchat'],
  tiktok:       ['تيك توك', 'tiktok'],
  googlePlay:   ['رابط التطبيق جوجل بلاي', 'google play', 'android_app', 'android app'],
  appStore:     ['رابط التطبيق آبل ستور', 'app store', 'apple store', 'apple_app', 'apple app'],
  storeUrl:     ['رابط المتجر', 'store url', 'store link', 'zid store', 'url'],
  notes:        ['ملاحظات', 'notes', 'note'],
  description:  ['description', 'الوصف', 'وصف'],
};

function findIdx(header, keys) {
  const norm = header.map(normalizeHeader);
  for (const key of keys) {
    const k = normalizeHeader(key);
    const exact = norm.findIndex(h => h === k);
    if (exact >= 0) return exact;
    const loose = norm.findIndex(h => h.includes(k));
    if (loose >= 0) return loose;
  }
  return -1;
}

function detectHeaderRow(allRows) {
  // نختار صف الترويسة = الأكثر أعمدةً معروفة (بلا اشتراط عمود الاسم — كي يعمل
  // مُعيّن الأعمدة اليدوي حتى حين يفشل التعرّف على الاسم تلقائياً).
  let best = { idx: -1, score: -1, cols: {} };
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i] || [];
    const cols = {};
    let score = 0;
    for (const [field, keys] of Object.entries(HEADER_KEYS)) {
      cols[field] = findIdx(row, keys);
      if (cols[field] >= 0) score++;
    }
    if (score > best.score) best = { idx: i, score, cols };
  }
  return best;
}

// كاشف الأعمدة — يُرجِع صف الترويسة المكتشَف + الربط التلقائي + كل عناوين
// الأعمدة (لواجهة مُعيّن الأعمدة الذكي). لا يرمي خطأً حتى لو لم يُكتشف الاسم.
export function detectLeadColumns(allRows) {
  if (!Array.isArray(allRows) || !allRows.length) return { headerIdx: -1, headers: [], cols: {} };
  const { idx, cols } = detectHeaderRow(allRows);
  const headerRow = idx >= 0 ? (allRows[idx] || []) : (allRows[0] || []);
  const headers = headerRow.map((h, i) => ({ idx: i, label: String(h ?? '').trim() || `عمود ${i + 1}` }));
  return { headerIdx: idx >= 0 ? idx : 0, headers, cols };
}

function cell(row, idx) {
  return idx >= 0 ? row[idx] : null;
}

function rawObject(header, row) {
  const out = {};
  for (let i = 0; i < header.length; i++) {
    const key = String(header[i] ?? '').trim();
    if (!key) continue;
    const v = row[i];
    if (v == null || v === '') continue;
    out[key] = v;
  }
  return out;
}

function duplicateDiagnostics(rows) {
  const byPhone = new Map();
  for (const r of rows) {
    if (!r.phoneNormalized) continue;
    if (!byPhone.has(r.phoneNormalized)) byPhone.set(r.phoneNormalized, []);
    byPhone.get(r.phoneNormalized).push(r);
  }
  for (const r of rows) {
    const peers = r.phoneNormalized ? byPhone.get(r.phoneNormalized) || [] : [];
    r.duplicateKey = peers.length > 1 ? r.phoneNormalized : null;
    r.duplicateCount = Math.max(1, peers.length);
    r.duplicateNames = peers.length > 1
      ? [...new Set(peers.map(x => x.name).filter(Boolean))].slice(0, 12)
      : [];
  }
  return {
    duplicatePhones: [...byPhone.values()].filter(list => list.length > 1).length,
    duplicateRows: [...byPhone.values()].filter(list => list.length > 1).reduce((s, list) => s + list.length, 0),
  };
}

// colsOverride: ربط يدوي اختياري {field: columnIndex} من مُعيّن الأعمدة الذكي —
// يُدمَج فوق الربط التلقائي (قيمة -1 = «لا شيء» تُعطّل الحقل). يجعل أي صيغة ملف
// قابلة للرفع دون توسيع HEADER_KEYS.
export function parseLeadsRows(allRows, colsOverride = null) {
  if (!Array.isArray(allRows) || allRows.length < 2) throw new Error('الملف فارغ أو غير معتاد');
  const { idx: detectedIdx, cols: autoCols } = detectHeaderRow(allRows);
  const headerIdx = detectedIdx >= 0 ? detectedIdx : 0;
  const cols = colsOverride ? { ...autoCols, ...colsOverride } : autoCols;
  if (cols.name == null || cols.name < 0) throw new Error('لم يُعثر على عمود اسم المتجر — عيّنه يدوياً من مُعيّن الأعمدة');

  const header = allRows[headerIdx] || [];
  // كشف المنصّة من أعمدة مميّزة (لا عمود منصّة صريح في هذه التصديرات):
  //  • سلة: أعمدة منقّطة `contactDetails.*`/`businessType.name`
  //  • زد: عمود `zid store`
  //  • معروف: دليل عام (منصّة المتجر مجهولة) → لا نضع منصّة افتراضية
  // ملاحظة: `nameAr` وحده ليس مميّزاً (معروف يحمله أيضاً) فأُسقط من علامة سلة.
  const normHeader = header.map(normalizeHeader);
  const isZidFormat = normHeader.includes('zid store');
  const isSallaFormat = normHeader.includes('contactdetails.customerservicenumber')
    || normHeader.includes('businesstype.name');
  const defaultPlatform = isZidFormat ? 'زد' : isSallaFormat ? 'سلة' : null;
  const rows = [];
  let invalidPhone = 0;
  let blankName = 0;
  let junkName = 0;

  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r) continue;
    const name = toText(cell(r, cols.name));
    if (!name) { blankName++; continue; }
    // قواعد التنظيف الصارمة: اسم وهمي/سبام/أرقام-فقط يُرفَض (لا يدخل القاعدة)
    if (isJunkLeadName(name)) { junkName++; continue; }

    const whatsappNorm = normalizeSaudiPhone(cell(r, cols.whatsapp));
    let phoneNorm = pickFirstPhone(
      cell(r, cols.whatsapp),
      cell(r, cols.phone),
      cell(r, cols.phoneAlt),
      cell(r, cols.unifiedPhone),
    );
    // يُقبل فقط جوال سعودي حقيقي (9665+8 أرقام، لا وهمي) — غيره يُتخطّى عند الرفع
    if (phoneNorm && !isRealSaudiMobile(phoneNorm)) phoneNorm = null;
    if (!phoneNorm) invalidPhone++;

    // القسم يُدمَج لـ11 رئيسياً (canonLeadCategory) — النوع الفرعي يُطوى في الرئيسي
    const cat = toText(cell(r, cols.category));
    const subCat = toText(cell(r, cols.subCategory));
    const category = canonLeadCategory(cat && subCat ? `${cat} — ${subCat}` : (cat || subCat));
    // العنوان: عمود صريح، وإلا يُركَّب من (حي/مدينة/منطقة) عند غيابه (صيغة سلة)
    const city = toText(cell(r, cols.city));
    let address = toText(cell(r, cols.address));
    if (!address) {
      address = [cell(r, cols.street), cell(r, cols.district), city, cell(r, cols.region)]
        .map(v => toText(v)).filter(Boolean).join('، ') || null;
    }

    rows.push({
      rowNumber: i + 1,
      name,
      nameNormalized: normalizeName(name),
      nameEn: toText(cell(r, cols.nameEn)),
      category,
      phone: phoneNorm,
      phoneNormalized: phoneNorm,
      whatsapp: whatsappNorm || phoneNorm,
      whatsappNormalized: whatsappNorm || phoneNorm,
      email: toText(cell(r, cols.email)),
      city,
      address,
      website: toText(cell(r, cols.website)),
      platform: canonPlatform(toText(cell(r, cols.platform)) || defaultPlatform),
      storeUrl: toText(cell(r, cols.storeUrl)),
      socialLinks: {
        whatsapp: toText(cell(r, cols.whatsappLink)),
        instagram: toText(cell(r, cols.instagram)),
        facebook: toText(cell(r, cols.facebook)),
        twitter: toText(cell(r, cols.twitter)),
        telegram: toText(cell(r, cols.telegram)),
        snapchat: toText(cell(r, cols.snapchat)),
        tiktok: toText(cell(r, cols.tiktok)),
        googlePlay: toText(cell(r, cols.googlePlay)),
        appStore: toText(cell(r, cols.appStore)),
      },
      notes: toText(cell(r, cols.notes)),
      rawPayload: rawObject(header, r),
    });
  }

  const duplicateStats = duplicateDiagnostics(rows);
  const categories = [...new Set(rows.map(r => r.category).filter(Boolean))].sort();
  const platforms = [...new Set(rows.map(r => r.platform).filter(Boolean))].sort();

  return {
    rows,
    headerRow: headerIdx,
    detectedColumns: cols,
    ignoredColumns: header.filter((_, idx) => !Object.values(cols).includes(idx)).map(String),
    stats: {
      totalRows: rows.length,
      blankName,
      junkName,
      invalidPhone,
      withPhone: rows.filter(r => r.phoneNormalized).length,
      categories: categories.length,
      platforms: platforms.length,
      ...duplicateStats,
    },
    categories,
    platforms,
  };
}

function matchPlatformByPhone(rows, merchants = []) {
  const byPhone = new Map();
  for (const m of merchants || []) {
    const phone = normalizeSaudiPhone(m.phone);
    if (!phone || byPhone.has(phone)) continue;
    byPhone.set(phone, m);
  }
  let matched = 0;
  for (const r of rows) {
    const m = r.phoneNormalized ? byPhone.get(r.phoneNormalized) : null;
    if (!m) continue;
    matched++;
    r.matchedStore = {
      storeId: m.store_id,
      storeName: m.store_name,
      status: m.status,
      billingType: m.billing_type,
      shipmentCount: Number(m.shipment_count) || 0,
      lastShipmentAt: m.last_shipment_at,
      walletBalance: Number(m.wallet_balance) || 0,
    };
  }
  return matched;
}

function asParsed(input) {
  return Array.isArray(input) ? { rows: input, stats: {} } : (input || { rows: [], stats: {} });
}

function cleanSocialLinks(v) {
  const obj = v && typeof v === 'object' ? v : {};
  return Object.fromEntries(Object.entries(obj).filter(([, val]) => val != null && val !== ''));
}

// Upload a cleaned snapshot. Exact duplicate identity = same normalized
// phone + same normalized name. Same phone with different names is not
// removed; it is inserted with duplicate_count so the team can decide.
export async function uploadLeadsSnapshot({
  rows,
  userId = null,
  ownerId = null,
  assigneeIds = [],
  platformMerchants = null,
} = {}) {
  const parsed = asParsed(rows);
  const inputRows = parsed.rows || [];
  if (!inputRows.length) return { added: 0, skipped: 0, skippedExact: 0, skippedInvalidPhone: 0, matchedPlatform: 0 };

  const snapshotId = `lead_${Date.now()}`;
  const merchants = platformMerchants || (await loadLatestMerchants().catch(() => ({ merchants: [] }))).merchants || [];
  const matchedPlatform = matchPlatformByPhone(inputRows, merchants);

  const existing = await selectAllRows(() => supabase
    .from('crm_leads')
    .select('name_normalized, phone, phone_normalized')
    .order('created_at', { ascending: true }));
  const existingIdentities = new Set();
  const existingPhones = new Map();
  for (const r of existing || []) {
    const phone = normalizeSaudiPhone(r.phone_normalized || r.phone);
    const norm = dedupCore(r.name_normalized || '');   // «تراكيب» = «متجر تراكيب»
    if (phone && norm) existingIdentities.add(`${phone}|${norm}`);
    if (phone) existingPhones.set(phone, (existingPhones.get(phone) || 0) + 1);
  }

  const owners = Array.isArray(assigneeIds) && assigneeIds.length
    ? assigneeIds.filter(Boolean)
    : [ownerId || userId].filter(Boolean);

  const toInsert = [];
  let skippedExact = 0;
  let skippedInvalidPhone = 0;
  let skippedNoName = 0;
  const batchSeen = new Set();

  for (const r of inputRows) {
    const nameNorm = r.nameNormalized || normalizeName(r.name);
    if (!nameNorm) { skippedNoName++; continue; }
    if (!r.phoneNormalized) { skippedInvalidPhone++; continue; }
    const identity = `${r.phoneNormalized}|${dedupCore(nameNorm)}`;
    if (existingIdentities.has(identity) || batchSeen.has(identity)) { skippedExact++; continue; }
    batchSeen.add(identity);

    const owner = owners.length ? owners[toInsert.length % owners.length] : null;
    const priorPhoneCount = existingPhones.get(r.phoneNormalized) || 0;
    const duplicateCount = Math.max(Number(r.duplicateCount) || 1, priorPhoneCount + Number(r.duplicateCount || 1));
    const matched = r.matchedStore || null;
    toInsert.push({
      name: r.name,
      name_normalized: nameNorm,
      name_en: r.nameEn || null,
      phone: r.phoneNormalized,
      phone_normalized: r.phoneNormalized,
      whatsapp: r.whatsappNormalized || r.phoneNormalized,
      whatsapp_normalized: r.whatsappNormalized || r.phoneNormalized,
      email: r.email || null,
      city: r.city || null,
      category: r.category || null,
      address: r.address || null,
      website: r.website || null,
      platform: r.platform || null,
      store_url: r.storeUrl || null,
      social_links: cleanSocialLinks(r.socialLinks),
      raw_payload: r.rawPayload || {},
      notes: r.notes || null,
      source: 'external_directory',
      snapshot_id: snapshotId,
      source_row_number: r.rowNumber || null,
      duplicate_key: duplicateCount > 1 ? r.phoneNormalized : null,
      duplicate_count: duplicateCount,
      duplicate_names: duplicateCount > 1 ? (r.duplicateNames || []).slice(0, 12) : [],
      matched_store_id: matched?.storeId || null,
      matched_store_name: matched?.storeName || null,
      matched_store_status: matched?.status || null,
      matched_store_billing_type: matched?.billingType || null,
      matched_store_shipments: matched?.shipmentCount ?? null,
      matched_store_last_shipment_at: matched?.lastShipmentAt || null,
      matched_store_wallet: matched?.walletBalance ?? null,
      status: matched ? 'existing_customer' : 'new',
      owner_id: owner,
      created_by: userId,
    });
  }

  let added = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error } = await supabase.from('crm_leads').insert(chunk);
    if (error) throw error;
    added += chunk.length;
  }
  if (added) invalidateLeadCaches();

  return {
    added,
    skipped: skippedExact + skippedInvalidPhone + skippedNoName,
    skippedExact,
    skippedInvalidPhone,
    skippedNoName,
    matchedPlatform,
    duplicatePhones: parsed.stats?.duplicatePhones || 0,
    duplicateRows: parsed.stats?.duplicateRows || 0,
    snapshotId,
  };
}

export async function loadLeads({
  status = null,
  ownerId = null,
  q = '',
  category = '',
  platform = '',
  duplicateOnly = false,
  matchedOnly = false,
  matched = '',          // '' الكل | 'yes' موجود في المنصّة | 'no' خارجها (طلب المستخدم 2026-07-16)
  campaign = '',         // '' الكل | 'none' بلا حملة | 'within7' | 'within30' | 'older30'
  unassignedOnly = false,
  page = 0,
  limit = PAGE,
  force = false,
} = {}) {
  const key = cacheKey({ status, ownerId, q, category, platform, duplicateOnly, matchedOnly, matched, campaign, unassignedOnly, page, limit });
  const cached = listCache.get(key);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const from = Math.max(0, page) * limit;
  const to = from + limit - 1;
  // القراءة من view crm_leads_campaign (crm_leads + آخر حملة واتساب lateral) —
  // security_invoker فيحترم RLS. الكتابة تبقى على crm_leads الأساسي.
  let query = supabase
    .from('crm_leads_campaign')
    .select(LEAD_COLUMNS, { count: 'exact' })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })   // قاعدة §6: tiebreaker فريد لكل .range()
    .range(from, to);

  if (status) query = query.eq('status', status);
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (unassignedOnly) query = query.is('owner_id', null);
  if (category) query = query.eq('category', category);
  // '__none__' = غير سلة ولا زد (فارغ أو منصّة أخرى) — يشمل null والفراغ
  if (platform === '__none__') query = query.or('platform.is.null,platform.not.in.(Salla,Zid)');
  else if (platform) query = query.eq('platform', platform);
  if (duplicateOnly) query = query.gt('duplicate_count', 1);
  if (matched === 'yes' || matchedOnly) query = query.not('matched_store_id', 'is', null);
  else if (matched === 'no') query = query.is('matched_store_id', null);
  // فلتر آخر حملة واتساب — على الخادم (view) فلا حدود للعدد
  if (campaign) {
    const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
    if (campaign === 'none') query = query.is('last_campaign_at', null);
    else if (campaign === 'within7') query = query.gte('last_campaign_at', daysAgo(7));
    else if (campaign === 'within30') query = query.gte('last_campaign_at', daysAgo(30));
    else if (campaign === 'older30') query = query.not('last_campaign_at', 'is', null).lt('last_campaign_at', daysAgo(30));
  }
  const term = q.trim();
  if (term) {
    const phone = normalizeSaudiPhone(term);
    query = phone
      ? query.or(`phone_normalized.eq.${phone},whatsapp_normalized.eq.${phone}`)
      : query.or(`name.ilike.%${term}%,name_en.ilike.%${term}%,email.ilike.%${term}%,category.ilike.%${term}%,platform.ilike.%${term}%,website.ilike.%${term}%,store_url.ilike.%${term}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const result = { rows: data || [], count: count || 0, page, limit };
  listCache.set(key, { at: Date.now(), data: result });
  return result;
}

function normalizeMeta(data) {
  const payload = data || {};
  return {
    stats: {
      total: Number(payload.stats?.total) || 0,
      newCount: Number(payload.stats?.newCount) || 0,
      existingCustomers: Number(payload.stats?.existingCustomers) || 0,
      duplicateRows: Number(payload.stats?.duplicateRows) || 0,
      unassigned: Number(payload.stats?.unassigned) || 0,
      converted: Number(payload.stats?.converted) || 0,
    },
    options: {
      categories: Array.isArray(payload.options?.categories) ? payload.options.categories : [],
      platforms: Array.isArray(payload.options?.platforms) ? payload.options.platforms : [],
      statuses: Array.isArray(payload.options?.statuses) ? payload.options.statuses : [],
    },
  };
}

async function loadLeadMeta({ force = false } = {}) {
  if (!force && metaCache.data && Date.now() - metaCache.at < META_CACHE_TTL_MS) return metaCache.data;
  if (!force && metaCache.promise) return metaCache.promise;

  metaCache.promise = (async () => {
    const { data, error } = await supabase.rpc('crm_leads_dashboard_meta');
    if (error) throw error;
    const normalized = normalizeMeta(data);
    metaCache = { at: Date.now(), data: normalized, promise: null };
    return normalized;
  })().catch(async (rpcError) => {
    metaCache.promise = null;
    console.warn('crm_leads_dashboard_meta failed, falling back to client aggregation', rpcError);
    const rows = await selectAllRows(() => supabase
      .from('crm_leads')
      .select('status, owner_id, duplicate_count, matched_store_id, category, platform')
      .order('created_at', { ascending: false }));
    const fallback = normalizeMeta({
      stats: {
        total: rows.length,
        newCount: rows.filter(r => r.status === 'new').length,
        existingCustomers: rows.filter(r => r.matched_store_id || r.status === 'existing_customer').length,
        duplicateRows: rows.filter(r => Number(r.duplicate_count) > 1).length,
        unassigned: rows.filter(r => !r.owner_id).length,
        converted: rows.filter(r => r.status === 'converted').length,
      },
      options: {
        categories: [...new Set((rows || []).map(r => r.category).filter(Boolean))].sort(),
        platforms: [...new Set((rows || []).map(r => r.platform).filter(Boolean))].sort(),
        statuses: [...new Set((rows || []).map(r => r.status).filter(Boolean))].sort(),
      },
    });
    metaCache = { at: Date.now(), data: fallback, promise: null };
    return fallback;
  });
  return metaCache.promise;
}

export async function loadLeadOptions(options = {}) {
  const meta = await loadLeadMeta(options);
  return meta.options;
}

export async function loadLeadStats(options = {}) {
  const meta = await loadLeadMeta(options);
  return meta.stats;
}

export async function loadLeadOptionsLegacy() {
  const data = await selectAllRows(() => supabase
    .from('crm_leads')
    .select('category, platform, status')
    .order('created_at', { ascending: false }));
  return {
    categories: [...new Set((data || []).map(r => r.category).filter(Boolean))].sort(),
    platforms: [...new Set((data || []).map(r => r.platform).filter(Boolean))].sort(),
    statuses: [...new Set((data || []).map(r => r.status).filter(Boolean))].sort(),
  };
}

export async function loadLeadStatsLegacy() {
  const data = await selectAllRows(() => supabase
    .from('crm_leads')
    .select('status, owner_id, duplicate_count, matched_store_id, created_at')
    .order('created_at', { ascending: false }));
  const rows = data || [];
  return {
    total: rows.length,
    newCount: rows.filter(r => r.status === 'new').length,
    existingCustomers: rows.filter(r => r.matched_store_id || r.status === 'existing_customer').length,
    duplicateRows: rows.filter(r => Number(r.duplicate_count) > 1).length,
    unassigned: rows.filter(r => !r.owner_id).length,
    converted: rows.filter(r => r.status === 'converted').length,
  };
}

export async function createLead({
  name, nameEn = null, phone = null, whatsapp = null, email = null, city = null,
  category = null, website = null, platform = null, storeUrl = null,
  instagram = null, socialLinks = null, notes = null,
  ownerId = null, userId = null,
}) {
  if (!name?.trim()) throw new Error('الاسم مطلوب');
  if (!isRealSaudiMobile(phone)) throw new Error('رقم الجوال غير صالح — يجب أن يبدأ بـ 9665 ويتكوّن من 12 رقماً (9665 ثم 8 أرقام)، وألّا يكون رقماً وهمياً');
  const phoneNorm = normalizeSaudiPhone(phone);
  const waNorm = normalizeSaudiPhone(whatsapp) || phoneNorm;
  const links = cleanSocialLinks({ ...(socialLinks || {}), instagram });
  const { data, error } = await supabase.from('crm_leads').insert({
    name: name.trim(),
    name_normalized: normalizeName(name),
    name_en: nameEn || null,
    phone: phoneNorm,
    phone_normalized: phoneNorm,
    whatsapp: waNorm,
    whatsapp_normalized: waNorm,
    email,
    city,
    category,
    website,
    platform,
    store_url: storeUrl || null,
    social_links: links,
    notes,
    source: 'manual',
    status: 'new',
    owner_id: ownerId,
    created_by: userId,
  }).select(LEAD_COLUMNS).single();
  if (error) throw error;
  invalidateLeadCaches();
  return data;
}

// تحويل جماعي لكل النتائج المطابقة للفلاتر — عملية واحدة على الخادم
// (لا حلقة 7000 طلب). نفس شروط loadLeads بالضبط، ثم update واحد.
export async function bulkAssignLeads({
  status = null, ownerId = null, q = '', category = '', platform = '',
  duplicateOnly = false, matched = '', campaign = '', unassignedOnly = false,
  newOwnerId,
} = {}) {
  // فلتر الحملة يعيش في الـview فقط (لا يُفلتَر به update على الجدول الأساسي):
  // نجمع المعرّفات المطابقة من الـview صفحات-صفحات ثم نحدّث بدفعات ids.
  if (campaign) {
    const ids = [];
    for (let off = 0; off < 40000; off += 1000) {
      const r = await loadLeads({ status, ownerId, q, category, platform, duplicateOnly, matched, campaign, unassignedOnly, page: off / 1000, limit: 1000, force: true });
      ids.push(...r.rows.map(x => x.id));
      if (r.rows.length < 1000 || ids.length >= r.count) break;
    }
    let done = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error } = await supabase.from('crm_leads').update({ owner_id: newOwnerId || null }).in('id', chunk);
      if (error) throw error;
      done += chunk.length;
    }
    listCache.clear();
    return done;
  }
  let query = supabase.from('crm_leads').update({ owner_id: newOwnerId || null });
  if (status) query = query.eq('status', status);
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (unassignedOnly) query = query.is('owner_id', null);
  if (category) query = query.eq('category', category);
  // '__none__' = غير سلة ولا زد (فارغ أو منصّة أخرى) — يشمل null والفراغ
  if (platform === '__none__') query = query.or('platform.is.null,platform.not.in.(Salla,Zid)');
  else if (platform) query = query.eq('platform', platform);
  if (duplicateOnly) query = query.gt('duplicate_count', 1);
  if (matched === 'yes') query = query.not('matched_store_id', 'is', null);
  else if (matched === 'no') query = query.is('matched_store_id', null);
  const term = (q || '').trim();
  if (term) {
    const phone = normalizeSaudiPhone(term);
    query = phone
      ? query.or(`phone_normalized.eq.${phone},whatsapp_normalized.eq.${phone}`)
      : query.or(`name.ilike.%${term}%,name_en.ilike.%${term}%,email.ilike.%${term}%,category.ilike.%${term}%,platform.ilike.%${term}%,website.ilike.%${term}%,store_url.ilike.%${term}%`);
  }
  // حارس ضد التحويل الأعمى: لا update بلا أي شرط إطلاقاً (كل الجدول!)
  if (!status && !ownerId && !unassignedOnly && !category && !platform && !duplicateOnly && !matched && !term) {
    query = query.gte('created_at', '1970-01-01'); // شرط صوري يبقي العملية صريحة القصد
  }
  const { data, error } = await query.select('id');
  if (error) throw error;
  listCache.clear();
  return data?.length || 0;
}

export async function updateLead(id, patch) {
  if (!id) throw new Error('id مطلوب');
  const normalized = { ...patch, updated_at: new Date().toISOString() };
  if ('phone' in normalized) {
    if (!isRealSaudiMobile(normalized.phone)) throw new Error('رقم الجوال غير صالح — يجب أن يبدأ بـ 9665 ويتكوّن من 12 رقماً، وألّا يكون رقماً وهمياً');
    normalized.phone_normalized = normalizeSaudiPhone(normalized.phone);
    normalized.phone = normalized.phone_normalized;
  }
  if ('whatsapp' in normalized) {
    normalized.whatsapp_normalized = normalizeSaudiPhone(normalized.whatsapp);
    normalized.whatsapp = normalized.whatsapp_normalized;
  }
  const { data, error } = await supabase.from('crm_leads')
    .update(normalized).eq('id', id).select(LEAD_COLUMNS).single();
  if (error) throw error;
  invalidateLeadCaches();
  return data;
}

export async function updateLeadStatus(id, status) {
  return updateLead(id, { status });
}

// كل الجهات على نفس الرقم — جلب حيّ (لا يعتمد على duplicate_names المخزَّنة
// التي تلتقط تكرار داخل الملف فقط؛ التكرار عبر الرفعات لا يظهر فيها). يستبعد
// الصفّ الحالي. يُستخدَم في بطاقة الجهة لعرض «متاجر أخرى بنفس الرقم».
export async function loadLeadsByPhone(phone, excludeId = null) {
  const p = normalizeSaudiPhone(phone);
  if (!p) return [];
  let q = supabase.from('crm_leads')
    .select('id, name, name_en, category, city, platform, status, store_url, website')
    .or(`phone_normalized.eq.${p},whatsapp_normalized.eq.${p}`)
    .order('name');
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q;
  if (error) return [];
  return data || [];
}

export async function convertLead(id, { customerName = null, storeId = null } = {}) {
  if (!id) throw new Error('id مطلوب');
  return updateLead(id, {
    status: 'converted',
    converted_at: new Date().toISOString(),
    converted_customer: customerName,
    converted_store_id: storeId,
  });
}

export async function deleteLead(id) {
  if (!id) throw new Error('id مطلوب');
  const { error } = await supabase.from('crm_leads').delete().eq('id', id);
  if (error) throw error;
  invalidateLeadCaches();
  return { ok: true };
}
