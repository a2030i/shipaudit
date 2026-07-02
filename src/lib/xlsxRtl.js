// xlsxRtl.js — كل مصنّفات التطبيق عربية، لكن Excel يفتحها LTR افتراضياً
// فتظهر الأعمدة معكوسة للقارئ العربي. علم RTL على مستوى المصنّف يصحّح
// اتجاه العرض فقط — لا يغيّر أي بيانات ولا ترتيب أعمدة (metadata عرض).
//
// الاستخدام: XLSX.writeFile(rtl(wb), ...) أو XLSX.write(rtl(wb), ...)
// استثناء مقصود: generateCleanExcel (كشف البنك الصافي) — بنيته مثبّتة
// لنظام خارجي (§1.15) فلا نضيف له أي metadata احتياطاً.
export function rtl(wb) {
  wb.Workbook = wb.Workbook || {};
  if (!Array.isArray(wb.Workbook.Views) || !wb.Workbook.Views.length) wb.Workbook.Views = [{}];
  wb.Workbook.Views[0].RTL = true;
  return wb;
}
