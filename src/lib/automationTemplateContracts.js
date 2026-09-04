export const AUTOMATION_FIELD_LABELS = {
  'field:name': 'اسم المتجر/العميل من الربط الموثوق',
  'field:full_amount': 'إجمالي القابل للتحصيل تشغيليًا',
  'field:count': 'عدد الفواتير المطابقة',
  'field:filtered_overdue_amount': 'مبلغ الفواتير ضمن شرط العمر',
  'field:aging_filter': 'وصف شريحة عمر الدين',
  'field:last_shipment': 'تاريخ آخر شحنة',
};

export function normalizeTemplateContract(contract) {
  if (!contract) return null;
  return {
    ...contract,
    variable_contract: Array.isArray(contract.variable_contract)
      ? [...contract.variable_contract].sort((a, b) => Number(a.position) - Number(b.position))
      : [],
  };
}

export function variablesForContract(contract, existing = []) {
  const normalized = normalizeTemplateContract(contract);
  if (!normalized) return existing;
  const byPosition = new Map((existing || []).map(item => [Number(item.position), item]));
  return normalized.variable_contract.map(item => {
    const previous = byPosition.get(Number(item.position));
    if (item.mode === 'fixed') {
      return { position: Number(item.position), mode: 'fixed', value: previous?.mode === 'fixed' ? previous.value || '' : '' };
    }
    return { position: Number(item.position), mode: 'field', source: item.source, value: '' };
  });
}

export function templateContractIssue(contract, variables = []) {
  const normalized = normalizeTemplateContract(contract);
  if (!normalized) return 'عقد هذا القالب غير موثق للأتمتة.';
  if (!normalized.approved) return 'القالب غير معتمد للإرسال من هاتف.';
  if (variables.length !== normalized.variable_contract.length) return 'عدد المتغيرات لا يطابق عقد القالب.';
  for (const expected of normalized.variable_contract) {
    const actual = variables.find(item => Number(item.position) === Number(expected.position));
    if (!actual) return `المتغير {{${expected.position}}} غير مربوط.`;
    if (expected.mode === 'field' && (actual.mode !== 'field' || actual.source !== expected.source)) {
      return `مصدر المتغير {{${expected.position}}} لا يطابق عقد القالب.`;
    }
    if (expected.mode === 'fixed' && (actual.mode !== 'fixed' || !String(actual.value || '').trim())) {
      return `قيمة المتغير {{${expected.position}}} مطلوبة.`;
    }
  }
  return '';
}
