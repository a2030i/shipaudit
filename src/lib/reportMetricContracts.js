// Presentation-only registry for Phase 6 Batch 5.
// These records describe existing report metrics; they never calculate them.
// Formula ownership stays in the listed read model/service or legacy report view.

const metric = (id, name, definition, source, period, filters, aggregation, nullBehavior, valueType, legacyScreen) => ({
  id, name, definition, source, period, filters, aggregation, nullBehavior, valueType, legacyScreen,
});

export const REPORT_METRIC_CONTRACTS = [
  metric('ar_total', 'ذمم العملاء', 'إجمالي الرصيد المدين المفتوح للعملاء كما تعيده مرآة Zoho.', 'loadZohoFinancialHealth.ar.total', 'لقطة المصدر الحالية', 'صلاحية التقرير ومصدر Zoho', 'قيمة المصدر الجاهزة', 'المصدر غير متاح؛ لا صفر بديل', 'monetary', '/reports'),
  metric('ar_customers', 'عملاء لديهم ذمم', 'عدد العملاء الداخلين في ملخص الذمم المفتوحة.', 'loadZohoFinancialHealth.ar.customers', 'لقطة المصدر الحالية', 'مرآة Zoho الحالية', 'قيمة المصدر الجاهزة', 'المصدر غير متاح', 'count', '/reports'),
  metric('ar_over_90', 'ذمم العملاء +90', 'جزء ذمم العملاء المصنف أكبر من 90 يومًا في المصدر.', 'loadZohoFinancialHealth.ar.over_90', 'لقطة المصدر الحالية', 'قواعد aging الحالية', 'قيمة المصدر الجاهزة', 'المصدر غير متاح', 'monetary', '/reports'),
  metric('ap_total', 'ذمم الموردين', 'إجمالي الرصيد المفتوح للموردين كما تعيده مرآة Zoho.', 'loadZohoFinancialHealth.ap.total', 'لقطة المصدر الحالية', 'صلاحية التقرير ومصدر Zoho', 'قيمة المصدر الجاهزة', 'المصدر غير متاح؛ لا صفر بديل', 'monetary', '/reports'),
  metric('ap_vendors', 'موردون لديهم ذمم', 'عدد الموردين الداخلين في ملخص الذمم المفتوحة.', 'loadZohoFinancialHealth.ap.vendors', 'لقطة المصدر الحالية', 'مرآة Zoho الحالية', 'قيمة المصدر الجاهزة', 'المصدر غير متاح', 'count', '/reports'),
  metric('ap_over_90', 'ذمم الموردين +90', 'جزء ذمم الموردين المصنف أكبر من 90 يومًا في المصدر.', 'loadZohoFinancialHealth.ap.over_90', 'لقطة المصدر الحالية', 'قواعد aging الحالية', 'قيمة المصدر الجاهزة', 'المصدر غير متاح', 'monetary', '/reports'),
  metric('vat_net_due', 'صافي ضريبة القيمة المضافة', 'صافي الضريبة المستحقة كما تعيده لقطة VAT.', 'loadZohoFinancialHealth.vat.net_due', 'لقطة VAT الحالية', 'الفترة المحاسبية في المصدر', 'قيمة المصدر الجاهزة', 'المصدر غير متاح', 'monetary', '/reports'),
  metric('zoho_api_calls', 'استهلاك Zoho API اليوم', 'عدد طلبات Zoho المسجلة لليوم.', 'loadZohoFinancialHealth.api.calls', 'اليوم التشغيلي الحالي', 'سياسة مراقبة API الحالية', 'قيمة المصدر الجاهزة', 'المصدر غير متاح', 'count', '/reports'),

  metric('monthly_billed', 'المفوتر الشهري', 'إجمالي الحركات المدينة المصنفة مفوتر لكل ناقل وشهر.', 'monthlyReportService.rows.billed', 'الشهر المختار', 'month', 'sum(rows.billed)', 'الصفر يظهر شرطة في التقرير القديم', 'monetary', '/monthly-report'),
  metric('monthly_cod', 'تحصيل COD الشهري', 'إجمالي حركات COD الداخلة في صف الناقل للشهر.', 'monthlyReportService.rows.cod', 'الشهر المختار', 'month', 'sum(rows.cod)', 'الصفر يظهر شرطة', 'monetary', '/monthly-report'),
  metric('monthly_credits', 'المبالغ المرجعة والخصومات', 'إجمالي credit notes/adjustments التي يعيدها read model.', 'monthlyReportService.rows.creditNotes', 'الشهر المختار', 'month', 'sum(rows.creditNotes)', 'الصفر يظهر شرطة', 'monetary', '/monthly-report'),
  metric('monthly_payments', 'مدفوعات الناقلين', 'إجمالي المدفوعات الداخلة في صف الناقل للشهر.', 'monthlyReportService.rows.payments', 'الشهر المختار', 'month', 'sum(rows.payments)', 'الصفر يظهر شرطة', 'monetary', '/monthly-report'),
  metric('monthly_net', 'COD ناقص الفواتير', 'صافي الحركة الجاهز في read model؛ لا يعاد احتسابه في العرض.', 'monthlyReportService.rows.net', 'الشهر المختار', 'month', 'sum(rows.net)', 'الصفر يظهر شرطة', 'monetary', '/monthly-report'),
  metric('monthly_audits', 'المراجعات', 'عدد المراجعات المعتمدة في صف الناقل والشهر.', 'monthlyReportService.rows.auditCount', 'الشهر المختار', 'month', 'sum(rows.auditCount)', 'الصفر يظهر شرطة', 'count', '/monthly-report'),
  metric('monthly_audit_diff', 'فرق التدقيق', 'مجموع فروقات المراجعات المعتمدة.', 'monthlyReportService.rows.auditDiff', 'الشهر المختار', 'month', 'sum(rows.auditDiff)', 'الصفر يظهر شرطة', 'monetary', '/monthly-report'),
  metric('monthly_mismatch', 'شحنات فيها فرق', 'عدد الشحنات المصنفة mismatch في المراجعات المعتمدة.', 'monthlyReportService.rows.mismatch', 'الشهر المختار', 'month', 'sum(rows.mismatch)', 'الصفر بلا شارة فرق', 'count', '/monthly-report'),
  metric('monthly_delta', 'التغير عن الشهر السابق', 'نسبة تغير المفوتر مقابل صف الناقل في الشهر السابق.', 'MonthlyReport.deltaOf', 'الشهر المختار مقابل السابق', 'month وcarrier', '(current - previous) / previous × 100', 'null إذا غاب السابق أو كان غير موجب', 'percentage', '/monthly-report'),

  metric('forecast_inflow', 'متوقع يدخل', 'إجمالي أحداث التدفق الداخل ضمن الأفق.', 'forecastService.inflowTotal', 'الأفق 7/14/30/60 يومًا', 'horizonDays', 'قيمة read model', 'المصدر غير متاح', 'monetary', '/forecast'),
  metric('forecast_outflow', 'متوقع يخرج', 'إجمالي أحداث التدفق الخارج ضمن الأفق.', 'forecastService.outflowTotal', 'الأفق المختار', 'horizonDays', 'قيمة read model', 'المصدر غير متاح', 'monetary', '/forecast'),
  metric('forecast_net', 'صافي الأفق', 'الصافي المتوقع ضمن الأفق.', 'forecastService.netInHorizon', 'الأفق المختار', 'horizonDays', 'قيمة read model', 'المصدر غير متاح', 'monetary', '/forecast'),
  metric('forecast_bank', 'الرصيد البنكي الحالي', 'رصيد البنك الذي يعيده مصدر التوقع.', 'forecastService.bankBalance', 'لقطة المصدر الحالية', 'حسابات البنك الحالية', 'قيمة read model', 'null يخفي إسقاط الرصيد', 'monetary', '/forecast'),
  metric('forecast_projected', 'الرصيد المتوقع', 'الرصيد المتوقع في نهاية الأفق.', 'forecastService.projectedBalance', 'نهاية الأفق المختار', 'horizonDays', 'قيمة read model', 'null إذا غاب رصيد البنك', 'monetary', '/forecast'),
  metric('forecast_minimum', 'أدنى رصيد متوقع', 'أدنى نقطة في مسار الرصيد المتوقع.', 'forecastService.minProjected', 'داخل الأفق المختار', 'horizonDays', 'قيمة read model', 'null إذا تعذر الإسقاط', 'monetary', '/forecast'),
  metric('forecast_cod_transit', 'COD في الطريق', 'قيمة COD قيد التحويل كما يعيدها التوقع.', 'forecastService.codInTransit', 'لقطة المصدر الحالية', 'horizonDays', 'قيمة read model', 'المصدر غير متاح', 'monetary', '/forecast'),
  metric('forecast_customer_inflow', 'متوقع من العملاء', 'قيمة التحصيل المتوقعة من العملاء ضمن الأفق.', 'forecastService.customerInflow', 'الأفق المختار', 'horizonDays وقواعد التحصيل الحالية', 'قيمة read model', 'الصفر يخفي القسم', 'monetary', '/forecast'),
  metric('forecast_receivables_overdue', 'متأخر قابل للتحصيل', 'قيمة الذمم المتأخرة القابلة للتحصيل في التوقع.', 'forecastService.receivablesOverdue', 'لقطة المصدر الحالية', 'قواعد التحصيل الحالية', 'قيمة read model', 'الصفر يخفي التنبيه', 'monetary', '/forecast'),

  metric('carrier_ops', 'حركات الناقلين', 'عدد حركات دفتر الناقل في تقرير الأداء.', 'loadCarrierKpis.ops', 'كل التاريخ المتاح', 'carrier', 'sum(k.ops)', 'لا بيانات = EmptyState', 'count', '/carrier-kpi'),
  metric('carrier_ledger_net', 'صافي حركة دفتر الناقلين', 'مجموع صافي حركات الناقلين المعاد من الخدمة.', 'loadCarrierKpis.totalBilled', 'كل التاريخ المتاح', 'carrier', 'sum(k.totalBilled)', 'لا بيانات = EmptyState', 'monetary', '/carrier-kpi'),
  metric('carrier_recovery', 'استرداد عبر التدقيق', 'مجموع قيمة الفروقات الزائدة المكتشفة.', 'loadCarrierKpis.overchargeAmount', 'كل المراجعات المتاحة', 'carrier', 'sum(k.overchargeAmount)', 'لا بيانات = EmptyState', 'monetary', '/carrier-kpi'),
  metric('carrier_disputes', 'نزاعات مفتوحة', 'عدد النزاعات التي لم تغلق.', 'loadCarrierKpis.disputesOpen', 'لقطة المصدر الحالية', 'carrier', 'sum(k.disputesOpen)', 'لا بيانات = EmptyState', 'count', '/carrier-kpi'),
  metric('carrier_score', 'تقييم الناقل', 'الدرجة الموحّدة من coverage وmismatch ومدة النزاع والسداد مع إعادة توزيع وزن المكوّن غير المتاح.', 'carrierScore', 'كل التاريخ المتاح', 'carrier', 'carrierScore contract', 'المكوّن غير المتاح يستبعد ولا يعد كاملًا', 'percentage', '/carrier-kpi'),
  metric('carrier_coverage', 'تغطية التدقيق', 'نسبة فواتير الدفتر المغطاة بمراجعة.', 'loadCarrierKpis.auditCoverage', 'كل التاريخ المتاح', 'carrier', 'قيمة الخدمة', 'غير متاح عند غياب المقام', 'percentage', '/carrier-kpi'),
  metric('carrier_mismatch', 'نسبة الفواتير بفروق', 'نسبة المراجعات التي تحتوي فروقًا.', 'loadCarrierKpis.mismatchRate', 'كل المراجعات المتاحة', 'carrier', 'قيمة الخدمة', 'غير متاح عند غياب المراجعات', 'percentage', '/carrier-kpi'),
  metric('carrier_dispute_days', 'متوسط مدة حل النزاع', 'متوسط الأيام للنزاعات المحلولة.', 'loadCarrierKpis.avgDisputeDays', 'النزاعات المحلولة', 'carrier', 'قيمة الخدمة', 'لا يعرض عند عدم وجود نزاع محلول', 'duration', '/carrier-kpi'),
  metric('carrier_on_time', 'السداد في الموعد', 'نسبة المدفوعات في الموعد من المدفوعات المصنفة.', 'loadCarrierKpis.paidOnTime/paidLate', 'كل المدفوعات المصنفة', 'carrier', 'paidOnTime / (paidOnTime + paidLate)', 'شرطة عند غياب المدفوعات', 'percentage', '/carrier-kpi'),
  metric('carrier_pay_days', 'متوسط أيام السداد', 'متوسط فرق الأيام عن تاريخ الاستحقاق.', 'loadCarrierKpis.avgPayDays', 'كل المدفوعات المصنفة', 'carrier', 'قيمة الخدمة', 'لا يعرض عند غياب المدفوعات', 'duration', '/carrier-kpi'),

  metric('platform_lamha_count', 'ناقلو لمحة النشطون', 'عدد شركات لمحة النشطة غير المصنفة منافسًا فقط.', 'PlatformCarriers.platCounts.lamha', 'لقطة العقود الحالية', 'isActive وcompetitorOnly', 'count', '0 عند عدم وجود صفوف', 'count', '/platform-carriers'),
  metric('platform_auto_count', 'ناقلو أوتو ذوو سعر', 'عدد الشركات النشطة ذات سعر أوتو مدخل.', 'PlatformCarriers.platCounts.auto', 'لقطة الأسعار الحالية', 'isActive وsellAuto', 'count', '0 عند عدم وجود صفوف', 'count', '/platform-carriers'),
  metric('platform_torod_count', 'ناقلو طرود ذوو سعر', 'عدد الشركات النشطة ذات سعر طرود مدخل.', 'PlatformCarriers.platCounts.torod', 'لقطة الأسعار الحالية', 'isActive وsellTorod', 'count', '0 عند عدم وجود صفوف', 'count', '/platform-carriers'),
  metric('platform_profit', 'ربح لمحة', 'سعر بيع لمحة ناقص costPrice الجاهز في الصف.', 'PlatformCarriers row', 'لقطة العقد والسعر الحالية', 'carrier', 'sellPrice - costPrice', 'شرطة إذا غاب أحد السعرين', 'monetary', '/platform-carriers'),
  metric('platform_best', 'أفضل سعر', 'أقل سعر فقط عندما يوجد سعران صالحان فأكثر.', 'PlatformCarriers row', 'لقطة الأسعار الحالية', 'carrier وأسعار المنصات المتاحة', 'min(prices) بشرط count >= 2', 'لا فائز عند سعر واحد أو غياب الأسعار', 'monetary', '/platform-carriers'),

  metric('sales_hot', 'لايف جديد عالي النية', 'عدد فرص المنصة في bucket الحالي نفسه.', 'retargetingService.hot_live_new', 'لقطة pipeline الحالية', 'فلاتر pipeline', 'قيمة الخدمة', '0', 'count', '/workspace/sales'),
  metric('sales_recent_stop', 'توقف أكثر من 5 أيام', 'عدد فرص recent_stop حسب التصنيف الحالي.', 'retargetingService.recent_stop', 'لقطة pipeline الحالية', 'فلاتر pipeline', 'قيمة الخدمة', '0', 'count', '/workspace/sales'),
  metric('sales_wallet', 'رصيد يحتاج حلًا', 'عدد فرص wallet_stranded حسب التصنيف الحالي.', 'retargetingService.wallet_stranded', 'لقطة pipeline الحالية', 'فلاتر pipeline', 'قيمة الخدمة', '0', 'count', '/workspace/sales'),
  metric('sales_live_inactive', 'ربط لايف غير نشط', 'عدد فرص live_inactive حسب التصنيف الحالي.', 'retargetingService.live_inactive', 'لقطة pipeline الحالية', 'فلاتر pipeline', 'قيمة الخدمة', '0', 'count', '/workspace/sales'),
  metric('sales_collection_hold', 'محولون للتحصيل', 'عدد السجلات المحجوبة عن المبيعات بسبب مسار التحصيل.', 'retargetingService.collections_hold', 'لقطة pipeline الحالية', 'فلاتر pipeline', 'قيمة الخدمة', '0', 'count', '/workspace/sales'),

  metric('campaign_drafts', 'مسودات الحملات', 'عدد الحملات ذات الحالة draft في الملخص الحالي.', 'smartCampaignService campaign summary', 'كل السجل الحالي', 'فلاتر سجل الحملات', 'count by stored status', '0', 'count', '/workspace/campaigns'),
  metric('campaign_scheduled', 'حملات مجدولة', 'عدد الحملات ذات الحالة scheduled.', 'smartCampaignService campaign summary', 'كل السجل الحالي', 'فلاتر سجل الحملات', 'count by stored status', '0', 'count', '/workspace/campaigns'),
  metric('campaign_running', 'حملات تعمل الآن', 'عدد الحملات المصنفة running من المصدر.', 'smartCampaignService campaign summary', 'لقطة المصدر الحالية', 'فلاتر سجل الحملات', 'count by stored status', '0', 'count', '/workspace/campaigns'),
  metric('campaign_decision', 'حملات تحتاج قرارًا', 'عدد الحملات التي أعاد المصدر أنها تحتاج قرارًا.', 'smartCampaignService campaign summary', 'لقطة المصدر الحالية', 'فلاتر سجل الحملات', 'قيمة المصدر', '0', 'count', '/workspace/campaigns'),
  metric('audience_matched', 'إجمالي الجمهور المطابق', 'عدد السجلات التي طابقت مصادر وفلاتر الجمهور.', 'summarizeWhatsAppAudience.total', 'لحظة بناء الجمهور', 'كل فلاتر الجمهور', 'قيمة العقد الحالي', '0', 'count', '/workspace/campaigns'),
  metric('audience_eligible', 'الجمهور المؤهل', 'السجلات الجاهزة وفق safeguards الحالية.', 'summarizeWhatsAppAudience.ready', 'لحظة preflight', 'القناة والحماية والاستبعادات', 'قيمة العقد الحالي', '0', 'count', '/workspace/campaigns'),
  metric('audience_excluded', 'غير مؤهل أو مستبعد', 'السجلات التي أعاد عقد الجمهور سبب استبعادها.', 'summarizeWhatsAppAudience.excluded', 'لحظة preflight', 'قواعد exclusion/suppression الحالية', 'قيمة العقد الحالي', '0', 'count', '/workspace/campaigns'),
  metric('audience_review', 'يحتاج مراجعة', 'السجلات التي لا تمنح أهلية عند عدم اكتمال safeguards.', 'SmartCampaignCenter protection state', 'لحظة preflight', 'اكتمال مصادر الحماية', 'fail-closed presentation of existing readiness', '0 بعد اكتمال الحماية', 'count', '/workspace/campaigns'),
];

export const reportMetricContractById = id => REPORT_METRIC_CONTRACTS.find(contract => contract.id === id) || null;
