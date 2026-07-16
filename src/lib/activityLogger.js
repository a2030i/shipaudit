// activityLogger (§1.36) — تسجيل تحركات الموظف عبر edge function track-activity
// (تلتقط IP والدولة سيرفرياً). fire-and-forget: الفشل صامت ولا يعطّل الواجهة.
// الأنواع: login (دخول) · page (تنقّل) · denied (محاولة ممنوعة) · export · action
import { supabase } from './supabase.js';

let lastPageKey = ''; // منع تكرار تسجيل نفس الصفحة عند إعادة الرسم

export function logActivity(kind, action, detail = null, path = null) {
  try {
    supabase.functions.invoke('track-activity', {
      body: {
        kind,
        action,
        detail,
        path: path ?? (typeof window !== 'undefined' ? window.location.pathname : null),
        ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
      },
    }).catch(() => {});
  } catch { /* لا شيء — السجل لا يعطّل العمل */ }
}

// تنقّل: يسجَّل مرة لكل مسار متتالٍ (لا سبام عند re-render)
export function logPageView(path) {
  if (!path || path === lastPageKey) return;
  lastPageKey = path;
  logActivity('page', 'زيارة صفحة', null, path);
}

// محاولة فتح صفحة بلا صلاحية — الأهم رقابياً
export function logDenied(path, permKey) {
  logActivity('denied', 'محاولة فتح صفحة بلا صلاحية', { perm: permKey || null }, path);
}

// دخول: مرة واحدة لكل جلسة متصفح
let loginLogged = false;
export function logLogin() {
  if (loginLogged) return;
  loginLogged = true;
  logActivity('login', 'تسجيل دخول / بدء جلسة', null, '/');
}
