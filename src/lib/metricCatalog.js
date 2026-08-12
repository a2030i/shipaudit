export const METRIC_CATALOG = Object.freeze({
  carrier_spend: { label: 'تكلفة الشحن المعتمدة', source: 'مراجعات فواتير الناقلين', definition: 'إجمالي تكلفة الشحن المعتمدة للفترة المختارة.', drillPath: '/accounting-cycle' },
  cod_received: { label: 'تحصيل COD المستلم', source: 'ملفات تحصيل الناقلين', definition: 'مبالغ COD التي استلمتها الشركة في الفترة، وليست إيراداً.', drillPath: '/accounting-cycle' },
  carrier_cash_flow: { label: 'صافي حركة الناقلين', source: 'مراجعات الناقلين والتحصيل', definition: 'تحصيل COD المستلم ناقص تكلفة الشحن المعتمدة؛ تدفق نقدي وليس ربحاً.', drillPath: '/money' },
  collectible_ar: { label: 'الرصيد القابل للتحصيل', source: 'Zoho Books API', definition: 'الفواتير المفتوحة بعد خصم الرصيد الدائن القابل للتطبيق.', drillPath: '/customer-money' },
  bank_balance: { label: 'الرصيد البنكي', source: 'آخر كشف محفوظ لكل بنك', definition: 'مجموع آخر رصيد ختامي معروف لكل بنك مربوط؛ لا يُستنتج من الحركة عند نقص كشف.', drillPath: '/bank-accounts' },
  dso: { label: 'متوسط أيام التحصيل', source: 'فواتير ودفعات Zoho', definition: 'متوسط الأيام اللازمة لتحصيل مستحقات العملاء.', drillPath: '/customer-money' },
});

export const metricDefinition = (id) => METRIC_CATALOG[id] || null;
