const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const documentedDue = (row) => {
  const residual = money(row.balance_residual);
  const smallVerifiedResidual = Math.abs(residual) <= 0.5
    ? Math.max(money(row.balance_sync_gap), 0)
    : 0;
  return money(row.invoiced_due) + money(row.opening_due) + smallVerifiedResidual;
};

// رصيد Zoho القابل للمطابقة مع المستندات المتاحة في المرآة الحالية:
// فواتير مفتوحة + رصيد افتتاحي موثق + فروقات تقريب صغيرة (<= 0.50 ر.س).
// الفجوات المادية لا تُعرض كرصيد مطابق حتى لا يوحي الرقم أن لها مستندًا.
export function calculateZohoDocumentBackedBalance(rows = []) {
  const total = rows.reduce((sum, row) => sum + documentedDue(row), 0);
  return Number(total.toFixed(2));
}

export function calculateZohoDocumentBackedCreditOffset(rows = []) {
  const total = rows.reduce((sum, row) => sum
    + Math.min(Math.max(documentedDue(row), 0), Math.max(money(row.unused_credits), 0)), 0);
  return Number(total.toFixed(2));
}
