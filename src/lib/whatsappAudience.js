const validPhone = (phone) => String(phone || '').length >= 11;

export function whatsappRecipientKey(recipient, index) {
  const storeId = String(recipient?.storeId ?? '').trim();
  return storeId ? `s${storeId}` : `${recipient?.to || 'x'}#${index}`;
}

export function prepareWhatsAppAudienceRows(recipients = []) {
  return recipients.map((recipient, index) => ({
    ...recipient,
    _rk: whatsappRecipientKey(recipient, index),
  }));
}

const EXCLUSION_LABELS = [
  ['missingPhone', 'بلا هاتف'],
  ['duplicatePhone', 'هاتف مكرر'],
  ['noWhatsapp', 'بلا واتساب/محظور'],
  ['hatifTouched', 'يتابعهم فريق هاتف'],
  ['weakNumber', 'رقم ضعيف'],
  ['debtor', 'موقوف مالياً'],
  ['previousCampaign', 'من حملات مستثناة'],
];

export function whatsappAudienceExclusionBreakdown(counts = {}) {
  return EXCLUSION_LABELS
    .map(([key, label]) => ({ key, label, count: Number(counts[key]) || 0 }))
    .filter(reason => reason.count > 0);
}

// One deterministic audience gate for every campaign surface. Each row belongs to
// exactly one exclusion reason so the displayed equation always reconciles:
// source rows = ready rows + excluded rows.
export function summarizeWhatsAppAudience({
  rows = [],
  perStore = false,
  noWhatsapp = new Set(),
  excludedPhones = new Set(),
  hatifTouched = new Map(),
  weakPhones = new Set(),
  debtorPhones = new Set(),
} = {}) {
  const seen = new Set();
  const uniqueValidPhoneRows = [];
  let missingPhone = 0;
  let duplicatePhone = 0;

  for (const row of rows) {
    if (!validPhone(row.to)) {
      missingPhone += 1;
      continue;
    }
    const dedupKey = perStore ? row._rk : row.to;
    if (seen.has(dedupKey)) {
      duplicatePhone += 1;
      continue;
    }
    seen.add(dedupKey);
    uniqueValidPhoneRows.push(row);
  }

  const counts = {
    missingPhone,
    duplicatePhone,
    noWhatsapp: 0,
    previousCampaign: 0,
    hatifTouched: 0,
    weakNumber: 0,
    debtor: 0,
  };
  const ready = [];

  for (const row of uniqueValidPhoneRows) {
    if (noWhatsapp.has(row.to)) counts.noWhatsapp += 1;
    else if (excludedPhones.has(row.to)) counts.previousCampaign += 1;
    else if (hatifTouched.has(row.to)) counts.hatifTouched += 1;
    else if (weakPhones.has(row.to)) counts.weakNumber += 1;
    else if (debtorPhones.has(row.to)) counts.debtor += 1;
    else ready.push(row);
  }

  const excluded = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    source: rows.length,
    ready,
    uniqueValidPhoneRows,
    excluded,
    counts,
  };
}
