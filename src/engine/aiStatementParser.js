// ─────────────────────────────────────────────────────────────────────────────
//  AI-powered statement-of-account PDF parser.
//
//  Works for any carrier (DHL, FedEx, SMSA, etc.) by:
//    1. Extracting the page text from the PDF (pdfjs-dist).
//    2. Asking OpenRouter to return a strict JSON document with the same
//       shape as the Aramex parser:
//         { header, operations[], totals }
//    3. Validating + normalising the response.
//
//  We rely on the user's OpenRouter API key (already configured in Settings).
// ─────────────────────────────────────────────────────────────────────────────

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { loadSettings } from '../data/carriers.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const Y_TOL = 3;
const OR_BASE = 'https://openrouter.ai/api/v1';

// ─── PDF → text rows ───────────────────────────────────────────────────────
async function extractTextRows(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const items = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const it of content.items) {
      const str = (it.str ?? '').trim();
      if (str) items.push({ page: i, x: it.transform[4], y: it.transform[5], str });
    }
  }
  items.sort((a, b) => a.page - b.page || b.y - a.y);
  const rows = [];
  let cur = null;
  for (const it of items) {
    if (!cur || cur.page !== it.page || cur.y - it.y > Y_TOL) {
      cur = { page: it.page, y: it.y, items: [] };
      rows.push(cur);
    }
    cur.items.push(it);
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows.map(r => r.items.map(i => i.str).join(' | '));
}

// ─── OpenRouter call ───────────────────────────────────────────────────────
async function askOR({ model, prompt, maxTokens = 4000, signal }) {
  const settings = loadSettings();
  if (!settings.openrouterKey) throw new Error('أدخل OpenRouter API Key في الإعدادات أولاً');
  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${settings.openrouterKey}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://shipaudit.local',
      'X-Title':       'ShipAudit Pro · AI Statement Parser',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    let body = '';
    try { body = (await res.json())?.error?.message; } catch {}
    throw new Error(`AI خطأ ${res.status}: ${body || ''}`.trim());
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

// ─── JSON extraction helper ────────────────────────────────────────────────
function extractJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Find the first balanced { … }
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try { return JSON.parse(slice); } catch { return null; }
}

// ─── Prompt template ───────────────────────────────────────────────────────
function buildPrompt(textRows, carrierHint) {
  const text = textRows.slice(0, 400).join('\n'); // cap at 400 lines / ~50KB
  return `أنت محاسب خبير. مهمتك تحليل كشف حساب من شركة شحن واستخراج كل العمليات في صيغة JSON صارمة.

الشركة: ${carrierHint || 'غير معروفة'}

نص الكشف (سطر لكل صف، الأعمدة مفصولة بـ "|"):
\`\`\`
${text}
\`\`\`

استخرج البيانات في JSON بالضبط بهذه البنية، بدون أي نص قبله أو بعده:

{
  "header": {
    "accountNumber": "رقم الحساب أو null",
    "customer":      "اسم العميل أو null",
    "vatNo":         "الرقم الضريبي أو null",
    "creditTerms":   "مدة الاستحقاق (مثل '30 days') أو null",
    "periodFrom":    "YYYY-MM-DD أو null",
    "periodTo":      "YYYY-MM-DD أو null"
  },
  "operations": [
    {
      "docNo":        "رقم المستند (سلسلة أرقام)",
      "docType":      "RV | DR | DG | AB | INV | CN | DN — أنسب اختصار",
      "referenceNo":  "الرقم المرجعي إن وجد، وإلا نفس docNo",
      "docDate":      "YYYY-MM-DD",
      "dueDate":      "YYYY-MM-DD أو null",
      "dr":           رقم موجب (المبلغ المدين/الدين على العميل),
      "cr":           رقم سالب (المبلغ الدائن/إشعار دائن) أو 0,
      "balance":      رقم (الرصيد التراكمي بعد العملية),
      "shipmentType": "domestic | international_in | international_out | null"
    }
  ],
  "totals": {
    "totalBalance": رقم (الرصيد الإجمالي في نهاية الكشف),
    "aging": {
      "d0_30":  رقم أو null,
      "d31_60": رقم أو null,
      "d61_90": رقم أو null,
      "over90": رقم أو null
    }
  }
}

قواعد صارمة:
- التواريخ تحوّل إلى ISO YYYY-MM-DD حتى لو في النص مكتوبة DD.MM.YYYY أو غيره.
- المبالغ بصيغة رقمية فقط (بدون فواصل أو عملة).
- المبالغ بين أقواس مثل (1,234.00) تُعتبر سالبة → ضعها في cr كرقم سالب.
- لا تخمّن — لو الحقل غير موجود ضع null أو 0.
- شركات أرامكس تستخدم RV (فاتورة)، DG (دائن)، DR (مدين)، AB (تعديل).
- اقرأ كل العمليات في الكشف، لا تتوقف عند أول صفوف.
- أجب بـ JSON فقط، بدون \`\`\`json أو شرح.`;
}

// ─── Main entry ────────────────────────────────────────────────────────────
/**
 * Parse a generic carrier statement PDF using AI.
 * @param {ArrayBuffer} arrayBuffer  the PDF bytes
 * @param {{ carrierHint?: string, model?: string, signal?: AbortSignal }} opts
 * @returns {{ header, operations, totals }}
 */
export async function parseStatementWithAI(arrayBuffer, opts = {}) {
  const { carrierHint, model, signal } = opts;
  const settings = loadSettings();
  const chosenModel = model || settings.openrouterModel || 'google/gemini-2.0-flash-001';

  const textRows = await extractTextRows(arrayBuffer);
  if (!textRows.length) {
    throw new Error('تعذّر استخراج نص من الـ PDF (ربما صورة ممسوحة فقط)');
  }

  const raw = await askOR({
    model: chosenModel,
    prompt: buildPrompt(textRows, carrierHint),
    maxTokens: 4000,
    signal,
  });
  const parsed = extractJson(raw);
  if (!parsed) {
    throw new Error('لم يستطع AI إرجاع JSON صالح. جرّب نموذجاً أقوى من الإعدادات.');
  }

  // Normalise — coerce types defensively.
  const header = {
    accountNumber: parsed.header?.accountNumber ?? null,
    customer:      parsed.header?.customer      ?? null,
    vatNo:         parsed.header?.vatNo         ?? null,
    creditTerms:   parsed.header?.creditTerms   ?? null,
    periodFrom:    parsed.header?.periodFrom    ?? null,
    periodTo:      parsed.header?.periodTo      ?? null,
  };
  const operations = (parsed.operations ?? []).map(o => ({
    docNo:        String(o.docNo ?? '').trim(),
    docType:      String(o.docType ?? '').trim().toUpperCase(),
    referenceNo:  String(o.referenceNo ?? o.docNo ?? '').trim(),
    docDate:      o.docDate || null,
    dueDate:      o.dueDate || null,
    dr:           Number(o.dr) || 0,
    cr:           Number(o.cr) || 0,
    balance:      Number(o.balance) || 0,
    shipmentType: o.shipmentType || null,
  })).filter(o => o.docNo);

  const totals = {
    totalBalance: parsed.totals?.totalBalance ?? null,
    aging: {
      d0_30:  parsed.totals?.aging?.d0_30  ?? null,
      d31_60: parsed.totals?.aging?.d31_60 ?? null,
      d61_90: parsed.totals?.aging?.d61_90 ?? null,
      over90: parsed.totals?.aging?.over90 ?? null,
    },
  };
  return { header, operations, totals };
}
