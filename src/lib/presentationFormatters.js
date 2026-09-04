const SPREADSHEET_PHONE_ARTIFACT = /^[\u0027\u2019]\s*(?=\+?(?:00)?(?:966|0?5)[\d\s().-]{7,}$)/;

// Excel commonly prefixes phone-like text with an apostrophe. Strip it only
// when the remainder is recognisably a Saudi phone, never from arbitrary text.
export function normalizePhoneForDisplay(value) {
  const text = String(value ?? '').trim();
  return SPREADSHEET_PHONE_ARTIFACT.test(text) ? text.replace(/^[\u0027\u2019]\s*/, '') : text;
}

