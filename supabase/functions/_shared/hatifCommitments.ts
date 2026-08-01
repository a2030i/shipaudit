const RIYADH_TZ = 'Asia/Riyadh';
const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

const MONTHS: Record<string, number> = {
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6,
  يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10,
  نوفمبر: 11, ديسمبر: 12,
};

export type HatifCommitmentExtraction = {
  sourceText: string;
  confidence: 'high' | 'medium' | 'review';
  status: 'pending' | 'needs_confirmation';
  windowStart: string | null;
  windowEnd: string | null;
};

const digits = (value: string) => value.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] || d);

function collectText(value: unknown, output: string[]) {
  if (typeof value === 'string') {
    const clean = value.trim();
    if (clean) output.push(clean);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.values(value as Record<string, unknown>).forEach((item) => collectText(item, output));
}

export function commitmentSourceText(aiSummary: unknown) {
  if (!aiSummary) return '';
  if (typeof aiSummary === 'string') return digits(aiSummary.trim());
  const root = aiSummary as Record<string, unknown>;
  const selected = [
    root.summary, root.next_steps, root.nextSteps,
    root.action_items, root.actionItems, root.notes,
  ];
  const output: string[] = [];
  selected.forEach((item) => collectText(item, output));
  return digits([...new Set(output)].join(' · ')).slice(0, 4000);
}

function riyadhParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function addDays(parts: { year: number; month: number; day: number }, count: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count, 12));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function riyadhIso(parts: { year: number; month: number; day: number }, hour: number, minute: number) {
  // السعودية ثابتة UTC+3 بلا توقيت صيفي.
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 3, minute, 0)).toISOString();
}

function explicitDate(text: string, sourceAt: string) {
  const iso = text.match(/\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

  const monthNames = Object.keys(MONTHS).join('|');
  const named = text.match(new RegExp(`(?:^|\\s)([0-3]?\\d)\\s+(${monthNames})(?:\\s+(20\\d{2}))?(?:$|\\s|[،,.])`));
  if (named) {
    const base = riyadhParts(sourceAt);
    return { year: Number(named[3]) || base.year, month: MONTHS[named[2]], day: Number(named[1]) };
  }
  const base = riyadhParts(sourceAt);
  if (/(?:^|\s)(?:ال?غد(?:ا|اً)?|بكر[هة])(?:$|\s|[،,.])/.test(text)) return addDays(base, 1);
  if (/(?:^|\s)اليوم(?:$|\s|[،,.])/.test(text)) return base;
  return null;
}

function periodAdjustedHour(hour: number, text: string) {
  if (/(?:مساء|المساء|بعد\s+الظهر)/.test(text) && hour < 12) return hour + 12;
  if (/(?:صباح|الصباح|قبل\s+الظهر)/.test(text) && hour === 12) return 12;
  return hour;
}

function timeWindow(text: string) {
  const rangePatterns = [
    /بين(?:\s+الساعة)?\s*(\d{1,2})(?::(\d{1,2}))?\s*(?:و|إلى|الى|حتى|-)\s*(\d{1,2})(?::(\d{1,2}))?/,
    /من(?:\s+الساعة)?\s*(\d{1,2})(?::(\d{1,2}))?\s*(?:إلى|الى|حتى|-)\s*(\d{1,2})(?::(\d{1,2}))?/,
  ];
  for (const pattern of rangePatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const startHour = periodAdjustedHour(Number(match[1]), text);
    const endHour = periodAdjustedHour(Number(match[3]), text);
    if (startHour > 23 || endHour > 24 || endHour <= startHour) return null;
    return {
      startHour, startMinute: Number(match[2]) || 0,
      endHour, endMinute: Number(match[4]) || 0,
      explicitRange: true,
    };
  }

  const exact = text.match(/(?:الساعة|الساعه)\s*(\d{1,2})(?::(\d{1,2}))?/);
  if (exact) {
    const startHour = periodAdjustedHour(Number(exact[1]), text);
    if (startHour > 23) return null;
    const startMinute = Number(exact[2]) || 0;
    const end = startHour * 60 + startMinute + 60;
    return {
      startHour, startMinute,
      endHour: Math.floor(end / 60), endMinute: end % 60,
      explicitRange: false,
    };
  }
  if (/(?:قبل\s+الظهر|صباح|الصباح)/.test(text)) {
    return { startHour: 9, startMinute: 0, endHour: 12, endMinute: 0, explicitRange: false };
  }
  if (/(?:بعد\s+الظهر)/.test(text)) {
    return { startHour: 13, startMinute: 0, endHour: 17, endMinute: 0, explicitRange: false };
  }
  if (/(?:مساء|المساء)/.test(text)) {
    return { startHour: 15, startMinute: 0, endHour: 21, endMinute: 0, explicitRange: false };
  }
  return null;
}

export function extractHatifCallbackCommitment(
  aiSummary: unknown,
  sourceAt: string,
): HatifCommitmentExtraction | null {
  const sourceText = commitmentSourceText(aiSummary);
  if (!sourceText) return null;
  const text = sourceText.replace(/\s+/g, ' ');
  const asksForCall = /(?:اتصال|التواصل|نتواصل|يتواصل|معاودة|مكالمة|اتصل|اتّصل|كلم|كلّم)/.test(text);
  const futureSignal = /(?:غد|بكر[هة]|اليوم|لاحق|موعد|صباح|مساء|الظهر|الساعة|الساعه|بين)/.test(text);
  if (!asksForCall || !futureSignal) return null;

  const date = explicitDate(text, sourceAt);
  const window = timeWindow(text);
  if (!date || !window) {
    return { sourceText, confidence: 'review', status: 'needs_confirmation', windowStart: null, windowEnd: null };
  }

  const windowStart = riyadhIso(date, window.startHour, window.startMinute);
  const windowEnd = riyadhIso(date, window.endHour, window.endMinute);
  if (new Date(windowEnd).getTime() <= new Date(sourceAt).getTime()) {
    return { sourceText, confidence: 'review', status: 'needs_confirmation', windowStart: null, windowEnd: null };
  }
  return {
    sourceText,
    confidence: window.explicitRange ? 'high' : 'medium',
    status: 'pending',
    windowStart,
    windowEnd,
  };
}
