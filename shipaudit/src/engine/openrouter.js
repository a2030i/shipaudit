import { loadSettings } from '../data/carriers.js';

const OR_BASE = 'https://openrouter.ai/api/v1';

export const OR_MODELS = [
  { id: 'google/gemini-2.0-flash-001',     label: 'Gemini 2.0 Flash (سريع)' },
  { id: 'google/gemini-2.5-pro-preview',   label: 'Gemini 2.5 Pro (دقيق)' },
  { id: 'anthropic/claude-sonnet-4-5',     label: 'Claude Sonnet 4.5' },
  { id: 'openai/gpt-4o-mini',              label: 'GPT-4o Mini (اقتصادي)' },
  { id: 'openai/gpt-4o',                   label: 'GPT-4o' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (مجاني)' },
];

async function callOR(messages, { model, maxTokens = 1500, signal } = {}) {
  const settings = loadSettings();
  const key = settings.openrouterKey;
  if (!key) throw new Error('أدخل OpenRouter API Key في الإعدادات أولاً');

  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://shipaudit.app',
      'X-Title':       'ShipAudit Pro',
    },
    body: JSON.stringify({
      model: model || settings.openrouterModel || OR_MODELS[0].id,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ─── Column mapping via AI ─────────────────────────────────────────────────────
export async function aiMapColumns(headers) {
  const prompt = `أنت خبير في تحليل ملفات Excel لشركات الشحن.
عندك هذه الأعمدة: ${JSON.stringify(headers)}

حدد لكل حقل من الحقول التالية أي عمود يناسبه بالضبط:
- awb: رقم الشحنة/البوليصة
- shipDate: تاريخ الشحن
- dest: الدولة المقصودة (ليس المدينة)
- weight: الوزن بالكيلوغرام
- deliveryCharges: رسوم التوصيل/الشحن الأساسية
- rss: رسوم المناطق النائية RSS
- fuelSurcharge: رسوم الوقود

أجب بـ JSON فقط بدون أي نص إضافي، مثال:
{"awb":"AWB","shipDate":"Ship Date","dest":"Dest","weight":"Weight","deliveryCharges":"Delivery Charges","rss":"RSS","fuelSurcharge":"Fuel Surcharge"}

إذا لم تجد عموداً مناسباً اترك القيمة null.`;

  const raw = await callOR([{ role: 'user', content: prompt }], { maxTokens: 400 });
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

// ─── Contract parser from text ─────────────────────────────────────────────────
export async function aiParseContract(text) {
  const prompt = `استخرج بيانات التسعير من نص العقد التالي وحوّلها إلى JSON منظم.

نص العقد:
${text}

الصياغة المطلوبة (مثال):
{
  "pricing": {
    "Qatar": [
      {"upTo": 0.5, "price": 35},
      {"upTo": null, "pricePerUnit": 14, "unitKg": 0.5}
    ]
  },
  "rss": 0.16,
  "fuelPct": 0.15,
  "rssStartDate": "2026-03-01"
}

أجب بـ JSON فقط.`;

  const raw = await callOR([{ role: 'user', content: prompt }], { maxTokens: 800 });
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}
