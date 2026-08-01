// منسّقات التاريخ/الوقت بتوقيت السعودية (Asia/Riyadh) — نقطة الحقيقة الوحيدة.
// قاعدة البيانات تخزّن UTC دائماً؛ هذه الدوال تعرض بتوقيت الرياض **مهما كان جهاز
// المتصفّح** (لا تعتمد على toLocaleString بلا timeZone الذي يتبع جهاز المستخدم).
// القاعدة: أي عرض تاريخ/وقت جديد يستعمل هذه — لا toLocaleString مضمّناً بلا timeZone.
const TZ = 'Asia/Riyadh';

// تاريخ + وقت مختصر: «٢٣ يوليو ٠٧:٢٩»
export const saDateTime = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(d).slice(0, 16); }
};
// تاريخ فقط: «٢٣ يوليو ٢٠٢٦»
export const saDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return String(d).slice(0, 10); }
};
// تاريخ قصير بلا سنة: «٢٣ يوليو»
export const saDateShort = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: TZ, day: 'numeric', month: 'short' }); }
  catch { return String(d).slice(0, 10); }
};
// وقت فقط: «٠٧:٢٩»
export const saTime = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleTimeString('ar-SA-u-ca-gregory-nu-latn', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};
// مفتاح تاريخ YYYY-MM-DD بتوقيت الرياض (بدل en-CA بلا timeZone الذي قد يزيح اليوم قرب
// منتصف الليل UTC — الفرق 3 ساعات) — للمقارنات والمفاتيح والمدخلات.
export const saDateKey = (d) => {
  try { return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); }
  catch { return ''; }
};
