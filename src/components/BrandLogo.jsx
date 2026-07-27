// شعار لمحة الرسمي (LAMHA LOGO GUIDE — 2026-07-27).
//
// الأصول في `public/` (مستخرجة من ملفات الهوية الرسمية):
//   • lamha-icon.png        — الأيقونة (سداسية بخطوط سرعة، أزرق #2B68DE + تركواز #31D5E1)
//   • lamha-logo-color.png  — الشعار الأفقي الكامل الملوّن (للخلفيات الفاتحة)
//   • lamha-logo-white.png  — الشعار الأفقي الأبيض (للسايدبار الكحلي #333062 وكل الداكن)
//
// عند فقدان ملف يسقط المكوّن لرسم SVG بألوان الهوية الرسمية فلا تنكسر الواجهة.

import { useState } from 'react';

const MARK_SRC       = '/lamha-icon.png';
const LOGO_COLOR_SRC = '/lamha-logo-color.png';
const LOGO_WHITE_SRC = '/lamha-logo-white.png';

// أيقونة احتياطية بألوان الهوية الرسمية (سداسيتان متداخلتان + خطوط سرعة)
function FallbackMark({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 48" fill="none" aria-label="Lamha">
      {/* خطوط السرعة */}
      <line x1="2"  y1="12" x2="18" y2="12" stroke="#2B68DE" strokeWidth="4.5" strokeLinecap="round"/>
      <line x1="6"  y1="24" x2="16" y2="24" stroke="#2B68DE" strokeWidth="4.5" strokeLinecap="round"/>
      <line x1="2"  y1="36" x2="18" y2="36" stroke="#2B68DE" strokeWidth="4.5" strokeLinecap="round"/>
      {/* السداسية الخارجية (تركواز) */}
      <path d="M38 4 L54 4 L62 24 L54 44 L38 44 L30 24 Z" stroke="#31D5E1" strokeWidth="4.5" strokeLinejoin="round" fill="none"/>
      {/* السداسية الداخلية (أزرق) */}
      <path d="M26 4 L40 24 L26 44 L20 44 L20 4 Z" stroke="#2B68DE" strokeWidth="4.5" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

export function LamhaMark({ size = 32 }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <FallbackMark size={size}/>;
  return (
    <img
      src={MARK_SRC}
      alt="Lamha"
      width={size}
      height={size}
      onError={() => setBroken(true)}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}

// الشعار الأفقي الكامل — variant='color' للخلفيات الفاتحة (الافتراضي)،
// variant='white' للكحلي/الداكن (السايدبار، رؤوس البوابة الداكنة).
export function LamhaLogo({ height = 32, variant = 'color' }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, lineHeight: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: height * 0.78, fontWeight: 800, color: variant === 'white' ? '#FFFFFF' : 'var(--brand-navy)', letterSpacing: '-.5px', lineHeight: 1 }}>لمحة</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: height * 0.32, color: variant === 'white' ? 'rgba(255,255,255,.75)' : 'var(--brand-teal-2)', letterSpacing: 3, fontWeight: 600, textTransform: 'uppercase', lineHeight: 1 }}>LAMHA</span>
        </div>
        <FallbackMark size={height + 4}/>
      </div>
    );
  }

  return (
    <img
      src={variant === 'white' ? LOGO_WHITE_SRC : LOGO_COLOR_SRC}
      alt="Lamha"
      height={height}
      onError={() => setBroken(true)}
      style={{ display: 'block', height, width: 'auto', objectFit: 'contain' }}
    />
  );
}
