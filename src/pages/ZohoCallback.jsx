// صفحة هبوط موافقة زوهو (OAuth redirect) — تلتقط ?code= من العنوان وتبادله
// عبر edge function zoho-sync (exchange_web) بمفتاح دائم، ثم تعرض النتيجة.
// المستخدم لا يرى أي كود ولا ينسخ شيئاً — «Accept ثم ✅».
//
// - الحارس CONSUMED_ZOHO_CODES على مستوى الـmodule (§2.2 StrictMode —
//   الكود يُستهلك مرة واحدة؛ التكرار يفشل عند زوهو رغم نجاح الأولى).
// - effect يعتمد على location (§2.1 — PageSlot لا يفصل المكوّن).

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Card, Btn, Spinner } from '../components/UI.jsx';
import { supabase } from '../lib/supabase.js';

const CONSUMED_ZOHO_CODES = new Set();

export default function ZohoCallback({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState('working');   // working | done | error
  const [detail, setDetail] = useState('');

  useEffect(() => {
    if (!isActive || location.pathname !== '/zoho-callback') return;
    const code = new URLSearchParams(location.search).get('code');
    if (!code) { setState('error'); setDetail('لا يوجد كود في الرابط — افتح رابط الموافقة من جديد'); return; }
    if (CONSUMED_ZOHO_CODES.has(code)) return;
    CONSUMED_ZOHO_CODES.add(code);
    // امسح الكود من شريط العنوان فوراً — لا يبقى في تاريخ المتصفح/الـReferer
    try { window.history.replaceState({}, '', '/zoho-callback'); } catch { /* غير قاتل */ }

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('zoho-sync', {
          body: { action: 'exchange_web', code },
        });
        if (error) throw new Error(error.message);
        if (data?.ok) {
          setDetail(data.orgName ? `مؤسسة: ${data.orgName}` : '');
          setState('done');
        } else {
          // ربما نجح تبادل سابق (StrictMode/إعادة تحميل) — افحص الحالة قبل إعلان الفشل
          const { data: st } = await supabase.functions.invoke('zoho-sync', { body: { action: 'status' } });
          if (st?.connected) { setState('done'); setDetail(''); }
          else { setState('error'); setDetail(data?.error || 'فشل التبادل'); }
        }
      } catch (e) {
        setState('error'); setDetail(e.message);
      }
    })();
  }, [isActive, location.pathname, location.search]);

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ maxWidth: 440, width: '100%', textAlign: 'center', padding: 36 }}>
        {state === 'working' && (<>
          <Spinner size={30}/>
          <div style={{ fontWeight: 800, fontSize: 16, marginTop: 16 }}>جارٍ إتمام الربط مع زوهو…</div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 6 }}>ثوانٍ — نبادل الموافقة بمفتاح دائم</div>
        </>)}
        {state === 'done' && (<>
          <CheckCircle2 size={44} color="var(--green)" style={{ margin: '0 auto' }}/>
          <div style={{ fontWeight: 800, fontSize: 17, marginTop: 14 }}>✅ تم الربط مع Zoho Books</div>
          {detail && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>{detail}</div>}
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
            المفتاح دائم — لن تكرر هذه الخطوة أبداً. تطبيقكم القديم وربط النظام الداخلي لم يُمَسّا.
          </div>
          <Btn variant="accent" style={{ marginTop: 18 }} onClick={() => navigate('/overview')}>الذهاب للرئيسية</Btn>
        </>)}
        {state === 'error' && (<>
          <XCircle size={44} color="var(--red)" style={{ margin: '0 auto' }}/>
          <div style={{ fontWeight: 800, fontSize: 16, marginTop: 14 }}>تعذّر إتمام الربط</div>
          <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 8, direction: 'ltr', wordBreak: 'break-all' }}>{detail}</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
            كود الموافقة يعمل مرة واحدة لدقائق — افتح رابط الموافقة من جديد واضغط Accept مرة أخرى.
          </div>
        </>)}
      </Card>
    </div>
  );
}
