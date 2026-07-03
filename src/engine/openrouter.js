import { loadSettings } from '../data/carriers.js';

const OR_BASE = 'https://openrouter.ai/api/v1';

export const OR_MODELS = [
  {
    id:    'google/gemini-2.0-flash-001',
    label: 'Gemini 2.0 Flash',
    cost:  '$0.10 / $0.40 لكل مليون رمز',
    note:  'الأسرع والأرخص — مناسب لأي حجم ملف',
    best:  true,
  },
  {
    id:    'google/gemini-2.5-flash-preview',
    label: 'Gemini 2.5 Flash',
    cost:  '$0.15 / $0.60 لكل مليون رمز',
    note:  'أذكى من 2.0 Flash بنفس السرعة تقريباً',
  },
  {
    id:    'google/gemini-2.5-pro-preview-06-05',
    label: 'Gemini 2.5 Pro',
    cost:  '$1.25 / $10 لكل مليون رمز',
    note:  'دقة قصوى — للملفات الكبيرة والمعقدة',
  },
  {
    id:    'openai/gpt-4o-mini',
    label: 'GPT-4o Mini',
    cost:  '$0.15 / $0.60 لكل مليون رمز',
    note:  'موثوق واقتصادي للملفات الصغيرة',
  },
  {
    id:    'openai/gpt-4o',
    label: 'GPT-4o',
    cost:  '$5 / $15 لكل مليون رمز',
    note:  'للبيانات المعقدة وأعمدة غير معيارية',
  },
  {
    id:    'anthropic/claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    cost:  '$3 / $15 لكل مليون رمز',
    note:  'ممتاز للتحليل العميق وكتابة التقارير',
  },
  {
    id:    'meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B',
    cost:  'مجاني (حد يومي)',
    note:  'للاختبار والاستخدام المحدود فقط',
  },
];

// Fallback models tried automatically on 429 (rate limit)
const FALLBACK_MODELS = [
  'google/gemini-2.0-flash-001',
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.3-70b-instruct',
];

class RateLimitError extends Error {
  constructor(model) {
    super(`تجاوزت الحد المسموح للنموذج "${model}" — يُجرَّب نموذج احتياطي`);
    this.isRateLimit = true;
    this.model = model;
  }
}

async function callOne(messages, model, maxTokens, signal) {
  const settings = loadSettings();
  const key = settings.openrouterKey;
  if (!key) throw new Error('أدخل OpenRouter API Key في الإعدادات أولاً');

  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://shipaudit.local',
      'X-Title':       'ShipAudit Pro',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });

  if (res.status === 429) throw new RateLimitError(model);

  if (!res.ok) {
    let errMsg = `[${res.status}]`;
    try {
      const body = await res.json();
      errMsg += ' ' + (body?.error?.message || body?.message || '');
    } catch {}
    throw new Error(errMsg.trim());
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content && data.error) throw new Error(data.error.message || 'لا يوجد رد من النموذج');
  return content ?? '';
}

async function callOR(messages, { model, maxTokens = 1500, signal } = {}) {
  const settings  = loadSettings();
  const primary   = model || settings.openrouterModel || OR_MODELS[0].id;
  const toTry     = [primary, ...FALLBACK_MODELS.filter(m => m !== primary)];

  let lastErr;
  for (const m of toTry) {
    try {
      return await callOne(messages, m, maxTokens, signal);
    } catch (e) {
      lastErr = e;
      if (e.isRateLimit) continue;   // try next model
      throw e;                        // real error → stop
    }
  }
  throw new Error(`جميع النماذج تجاوزت الحد المسموح — انتظر دقيقة ثم أعد المحاولة`);
}

export async function testConnection() {
  const settings = loadSettings();
  if (!settings.openrouterKey) throw new Error('لا يوجد API Key محفوظ');
  const reply = await callOR([{ role: 'user', content: 'قل "OK" فقط' }], { maxTokens: 10 });
  if (!reply) throw new Error('النموذج لم يرد');
  return true;
}

// ─── Full file analysis via AI ────────────────────────────────────────────────
// Sends first N rows of raw data (2D array) to AI so it can detect:
//   - Which row is the actual header row
//   - Column-to-field mapping
//   - Which fields are missing
export async function aiAnalyzeFile(allRows) {
  // Build a tab-separated preview of first 25 rows
  const preview = allRows.slice(0, 25)
    .map((row, i) =>
      `[${i}]\t` + row.map(v => (v === null || v === undefined || v === '') ? '—' : String(v)).join('\t')
    )
    .join('\n');

  const prompt = `أنت خبير في تحليل ملفات Excel لشركات الشحن.

البيانات التالية هي أول 25 صف من الملف (الأرقام بين [] هي أرقام الصفوف):
\`\`\`
${preview}
\`\`\`

مهمتك:
1. حدد رقم الصف (0-indexed من القائمة أعلاه) الذي يحتوي على عناوين الأعمدة الفعلية
2. عيّن كل عمود للحقل المناسب من القائمة:
   - awb        : رقم الشحنة / البوليصة / AWB / Airway Bill No.
   - shipDate   : تاريخ الشحن / Pick up Date
   - dest       : الدولة المقصودة (أو رمز الدولة AE/BH/KW/QA/OM/EG/JO إذا الملف دولي)
   - destCity   : المدينة (اختياري)
   - weight     : الوزن بالكيلوغرام. ⚠️ **مهم لشركة أرامكس**: لو وُجدت أعمدة متعددة فيها كلمة "weight" (مثل Net weight و Chargeable Weight و Actual weight)، اختر **Chargeable Weight** دائماً — هذا الوزن المُسعَّر اللي يفوتر عليه أرامكس
   - deliveryCharges : رسوم التوصيل / الشحن الأساسية / Base Charge
   - rss        : رسوم المناطق النائية RSS / Remote Area
   - fuelSurcharge   : رسوم الوقود / Fuel Surcharge / Other Charge (في فواتير أرامكس عادة Other Charge يحتوي الفيول + RSS)
   - codAmount  : الدفع عند الاستلام COD (اختياري)
   - serviceType: نوع الخدمة / Service Type / Road / Air / Express (اختياري)
   - billingType: نوع الفوترة / Billing Type (للتمييز بين محلي ودولي في أرامكس: ZDOI=محلي، ZIBI/ZOBI=دولي)

3. إذا لم يكن الحقل موجوداً في الملف اجعل قيمته null

أجب بـ JSON فقط بدون أي نص خارجه:
{
  "headerRow": 3,
  "colMap": {
    "awb": "AWB Number",
    "shipDate": "Shipment Date",
    "dest": "Country",
    "destCity": null,
    "weight": "Chargeable Weight",
    "deliveryCharges": "Base Charge",
    "rss": null,
    "fuelSurcharge": "Other Charge",
    "codAmount": null,
    "serviceType": null,
    "billingType": "Billing Type"
  },
  "missingFields": ["rss", "codAmount", "serviceType"],
  "notes": "ملاحظة مختصرة إذا وجدت شيء مهم"
}`;

  const raw = await callOR([{ role: 'user', content: prompt }], { maxTokens: 600 });
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const obj = JSON.parse(clean);
    return {
      headerRow:     typeof obj.headerRow === 'number' ? obj.headerRow : 0,
      colMap:        obj.colMap || {},
      missingFields: obj.missingFields || [],
      notes:         obj.notes || '',
    };
  } catch {
    return null;
  }
}

// ─── Column mapping via AI (headers-only fallback) ─────────────────────────────
export async function aiMapColumns(headers) {
  const prompt = `أنت خبير في تحليل ملفات Excel لشركات الشحن.
الأعمدة الموجودة: ${JSON.stringify(headers)}

عيّن كل حقل للعمود المناسب (null إذا غير موجود):
awb, shipDate, dest, destCity, weight, deliveryCharges, rss, fuelSurcharge, codAmount

أجب بـ JSON فقط:
{"awb":"...","shipDate":"...","dest":"...","destCity":null,"weight":"...","deliveryCharges":"...","rss":null,"fuelSurcharge":null,"codAmount":null}`;

  const raw = await callOR([{ role: 'user', content: prompt }], { maxTokens: 300 });
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return {};
  }
}

// ─── Audit analysis ────────────────────────────────────────────────────────────
export async function aiAnalyzeAudit(summary, carrierName, period, signal) {
  const prompt = `أنت محاسب متخصص في مراجعة فواتير شركات الشحن.

راجعت فاتورة شركة "${carrierName}" للفترة "${period}":

📊 ملخص النتائج:
- إجمالي الشحنات: ${summary.total}
- مطابقة للعقد: ${summary.ok}
- بها فروق: ${summary.mismatch}
- غير معروفة: ${summary.unknown}
- إجمالي الفرق: ${summary.totalDiff.toFixed(2)} ر.س
- فرق رسوم الشحن: ${summary.deliveryDiff.toFixed(2)} ر.س
- فرق RSS: ${summary.rssDiff.toFixed(2)} ر.س
- فرق رسوم الوقود: ${summary.fuelDiff.toFixed(2)} ر.س

الفروق حسب الدولة:
${Object.entries(summary.byCountry).map(([c,v])=>`  • ${c}: ${v.count} شحنة، فرق ${v.diff.toFixed(2)} ر.س`).join('\n')}

اكتب تقريراً احترافياً موجزاً (3-5 أسطر) باللغة العربية يمكن إرساله لمدير حساب الشركة، يتضمن:
1. ملاحظة رئيسية عن أبرز الفروق
2. البنود الأكثر مشكلة
3. طلب المراجعة والتصحيح
لا تستخدم رموز تعبيرية مبالغ فيها، الأسلوب رسمي ومهني.`;

  return await callOR([{ role: 'user', content: prompt }], { maxTokens: 600, signal });
}

// ─── Chat with audit context ───────────────────────────────────────────────────
export async function aiChat(messages, context, signal) {
  const systemPrompt = `أنت مساعد ذكي متخصص في مراجعة فواتير شركات الشحن والخدمات اللوجستية.
لديك خلفية محاسبية وخبرة في عقود شركات الشحن الخليجية.
المستخدم يعمل على نظام ShipAudit Pro لمراقبة فواتير شركات الشحن.
${context ? `\nسياق الجلسة الحالية:\n${context}` : ''}
أجب بالعربية دائماً، كن دقيقاً ومختصراً.`;

  return await callOR(
    [{ role: 'system', content: systemPrompt }, ...messages],
    { maxTokens: 1000, signal }
  );
}

// ─── Contract parser (text OR image) ──────────────────────────────────────────
// input: { text?, imageBase64?, mimeType?, hint? }
export async function aiParseContract(input) {
  const hint = input.hint ? `\nملاحظة من المستخدم: ${input.hint}` : '';

  const instruction = `أنت خبير في قراءة عقود شركات الشحن الخليجية.${hint}

استخرج بيانات التسعير وحوّلها إلى JSON بالصياغة التالية فقط — بدون أي نص خارجه:
{
  "pricing": {
    "United Arab Emirates": [
      {"upTo": 1, "price": 28},
      {"upTo": null, "pricePerUnit": 10, "unitKg": 0.5}
    ],
    "Qatar": {
      "Road": [{"upTo": 2, "price": 25}, {"upTo": null, "pricePerUnit": 8, "unitKg": 1}],
      "Air":  [{"upTo": 0.5, "price": 35}, {"upTo": null, "pricePerUnit": 14, "unitKg": 0.5}]
    }
  },
  "rss": 0.16,
  "fuelPct": 0.15,
  "rssStartDate": "2026-03-01",
  "observations": [
    "⚠️ Qatar لها نوعان من الخدمة: Road وAir",
    "ℹ️ رسوم الوقود لم تُذكر صراحةً في العقد"
  ]
}

قواعد مهمة:
- أسماء الدول بالإنجليزية من: United Arab Emirates, Qatar, Kuwait, Oman, Bahrain, Saudi Arabia, Egypt, Jordan, Turkey, Iraq, Lebanon, Yemen
- إذا كانت الدولة لها نوع خدمة واحد فقط: قيمة الدولة = Array مباشرة
- إذا كانت الدولة لها نوعان أو أكثر (Road/Air/Express...): قيمة الدولة = Object { "Road": Array, "Air": Array }
- upTo: null = شريحة مفتوحة (آخر شريحة)
- rss وfuelPct أرقام عشرية (16% = 0.16) — إذا غير موجودة اجعلها 0
- rssStartDate: null إذا غير محدد
- fuelStartDate: null إذا غير محدد
- observations: قائمة بأي شيء غريب لاحظته (دولة مكررة، سعر شاذ، أنواع خدمة متعددة، بيانات ناقصة)
- إذا لم تلاحظ أي شيء غريب: observations = []`;

  let messageContent;
  if (input.imageBase64) {
    messageContent = [
      { type: 'text', text: instruction },
      { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` } },
    ];
  } else {
    messageContent = `${instruction}\n\nنص العقد:\n${input.text || ''}`;
  }

  const raw = await callOR([{ role: 'user', content: messageContent }], { maxTokens: 1500 });
  try {
    const obj = JSON.parse(raw.replace(/```json\s*|```/g, '').trim());
    return {
      pricing:      obj.pricing      || {},
      rss:          obj.rss          ?? 0,
      fuelPct:      obj.fuelPct      ?? 0,
      rssStartDate:  obj.rssStartDate  || null,
      fuelStartDate: obj.fuelStartDate || null,
      observations:  obj.observations  || [],
    };
  } catch {
    return null;
  }
}

// ─── Contract refinement via chat ──────────────────────────────────────────────
// chatHistory: [{role:'user'|'assistant', content:'...'}]
export async function aiRefineContract(currentParsed, chatHistory, userMessage) {
  const systemPrompt = `أنت مساعد متخصص في تصحيح بيانات عقود شركات الشحن.

البيانات المستخرجة حالياً:
\`\`\`json
${JSON.stringify(currentParsed, null, 2)}
\`\`\`

مهمتك: طبّق تعديل المستخدم على البيانات ثم أجب بـ JSON فقط:
{
  "message": "رد بالعربية يشرح ما تم تغييره",
  "updated": {
    "pricing": {...},
    "rss": 0.16,
    "fuelPct": 0.15,
    "rssStartDate": null,
    "observations": [...]
  }
}

إذا كان طلب المستخدم استفساراً وليس تعديلاً، أجب في "message" فقط واجعل "updated" = null.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory,
    { role: 'user', content: userMessage },
  ];

  const raw = await callOR(messages, { maxTokens: 1200 });
  try {
    const obj = JSON.parse(raw.replace(/```json\s*|```/g, '').trim());
    return { message: obj.message || '—', updated: obj.updated || null };
  } catch {
    return { message: raw, updated: null };
  }
}
