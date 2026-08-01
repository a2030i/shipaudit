// صفحة هبوط موافقة زوهو (OAuth redirect) — تلتقط ?code= من العنوان وتبادله
// عبر edge function zoho-sync (exchange_web) بمفتاح دائم، ثم تعرض النتيجة.
// المستخدم لا يرى أي كود ولا ينسخ شيئاً — «Accept ثم ✅».
//
// - الحارس CONSUMED_ZOHO_CODES على مستوى الـmodule (§2.2 StrictMode —
//   الكود يُستهلك مرة واحدة؛ التكرار يفشل عند زوهو رغم نجاح الأولى).
// - effect يعتمد على location (§2.1 — PageSlot لا يفصل المكوّن).

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { Card, Btn, Spinner } from '../components/UI.jsx';
import { supabase } from '../lib/supabase.js';

const CONSUMED_ZOHO_CODES = new Set();

async function invokeZoho(payload) {
  const res = await supabase.functions.invoke('zoho-sync', { body: payload });
  if (res.error?.context) {
    try {
      const body = await res.error.context.json();
      if (body) return { data: body, error: null };
    } catch { /* جسم غير JSON */ }
  }
  return res;
}

export default function ZohoCallback({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('working'); // working | replace | organization | done | error
  const [detail, setDetail] = useState('');
  const [replacement, setReplacement] = useState(null);
  const [organizationChoice, setOrganizationChoice] = useState(null);

  const requestOrganizationChoice = (data) => {
    const organizations = Array.isArray(data?.organizations) ? data.organizations : [];
    if (!data?.pending_id || !organizations.length) return false;
    const preferred = organizations.find(o => o.id === data.current_org_id)
      || organizations.find(o => o.isDefault)
      || organizations[0];
    setOrganizationChoice({
      pendingId: data.pending_id,
      organizations,
      selectedId: preferred?.id || '',
      expiresAt: data.expires_at || null,
    });
    setStatus('organization');
    return true;
  };

  useEffect(() => {
    if (!isActive || location.pathname !== '/zoho-callback') return;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const oauthState = params.get('state');
    const oauthError = params.get('error');
    if (oauthError) {
      setStatus('error');
      setDetail(oauthError === 'access_denied' ? 'أُلغيت الموافقة في زوهو ولم يتغير الربط الحالي.' : oauthError);
      return;
    }
    if (!code || !oauthState) {
      setStatus('error');
      setDetail('رابط الموافقة ناقص أو منتهي — ابدأ الربط من داخل النظام مرة أخرى.');
      return;
    }
    if (CONSUMED_ZOHO_CODES.has(code)) return;
    CONSUMED_ZOHO_CODES.add(code);
    // امسح الكود من شريط العنوان فوراً — لا يبقى في تاريخ المتصفح/الـReferer
    try { window.history.replaceState({}, '', '/zoho-callback'); } catch { /* غير قاتل */ }

    (async () => {
      try {
        const { data, error } = await invokeZoho({ action: 'exchange_web', code, state: oauthState });
        if (data?.error && String(data.error).includes('already_connected')) {
          setReplacement({ code, oauthState });
          setDetail(data.org_id ? `المؤسسة الحالية: ${data.org_id}` : 'يوجد ربط قائم الآن.');
          setStatus('replace');
          return;
        }
        if (data?.organization_required && requestOrganizationChoice(data)) return;
        if (error) throw new Error(error.message);
        if (data?.ok) {
          setDetail(data.orgName ? `مؤسسة: ${data.orgName}` : '');
          setStatus('done');
        } else {
          // ربما نجح تبادل سابق (StrictMode/إعادة تحميل) — افحص الحالة قبل إعلان الفشل
          const { data: st } = await supabase.functions.invoke('zoho-sync', { body: { action: 'status' } });
          if (st?.connected) { setStatus('done'); setDetail(''); }
          else { setStatus('error'); setDetail(data?.error || 'فشل التبادل'); }
        }
      } catch (e) {
        setStatus('error'); setDetail(e.message);
      }
    })();
  }, [isActive, location.pathname, location.search]);

  const confirmReplacement = async () => {
    if (!replacement) return;
    setStatus('working');
    setDetail('');
    try {
      const { data, error } = await invokeZoho({
        action: 'exchange_web',
        code: replacement.code,
        state: replacement.oauthState,
        force: true,
      });
      if (error) throw new Error(error.message);
      if (data?.organization_required && requestOrganizationChoice(data)) {
        setReplacement(null);
        return;
      }
      if (!data?.ok) throw new Error(data?.error || 'فشل استبدال الربط');
      setReplacement(null);
      setDetail(data.orgName ? `مؤسسة: ${data.orgName}` : '');
      setStatus('done');
    } catch (e) {
      setStatus('error');
      setDetail(e.message);
    }
  };

  const confirmOrganization = async () => {
    if (!organizationChoice?.pendingId || !organizationChoice.selectedId) return;
    setStatus('working');
    setDetail('');
    try {
      const { data, error } = await invokeZoho({
        action: 'finalize_organization',
        pending_id: organizationChoice.pendingId,
        organization_id: organizationChoice.selectedId,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'فشل تثبيت المؤسسة');
      setDetail(data.orgName ? `مؤسسة: ${data.orgName}` : '');
      setOrganizationChoice(null);
      setStatus('done');
    } catch (e) {
      setStatus('error');
      setDetail(e.message);
    }
  };

  const cancelOrganization = async () => {
    const pendingId = organizationChoice?.pendingId;
    setOrganizationChoice(null);
    if (pendingId) {
      try {
        await invokeZoho({ action: 'cancel_organization', pending_id: pendingId });
      } catch { /* التنظيف الدوري يحذف الطلب المنتهي كشبكة أمان */ }
    }
    navigate('/customer-money');
  };

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ maxWidth: 440, width: '100%', textAlign: 'center', padding: 36 }}>
        {status === 'working' && (<>
          <Spinner size={30}/>
          <div style={{ fontWeight: 800, fontSize: 16, marginTop: 16 }}>جارٍ إتمام الربط مع زوهو…</div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 6 }}>ثوانٍ — نبادل الموافقة بمفتاح دائم</div>
        </>)}
        {status === 'replace' && (<>
          <ShieldAlert size={44} color="var(--gold)" style={{ margin: '0 auto' }}/>
          <div style={{ fontWeight: 800, fontSize: 17, marginTop: 14 }}>الربط مع زوهو قائم بالفعل</div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 8, lineHeight: 1.8 }}>
            {detail}<br/>
            الاستبدال يغيّر مفتاح الربط فقط ويحافظ على مؤسسة زوهو الحالية. أكّده خلال دقيقتين من الموافقة.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            <Btn variant="ghost" onClick={() => navigate('/customer-money')}>إبقاء الربط الحالي</Btn>
            <Btn variant="accent" onClick={confirmReplacement}>تأكيد استبدال الربط</Btn>
          </div>
        </>)}
        {status === 'organization' && organizationChoice && (<>
          <Building2 size={44} color="var(--brand)" style={{ margin: '0 auto' }}/>
          <div style={{ fontWeight: 800, fontSize: 17, marginTop: 14 }}>اختر مؤسسة Zoho Books</div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 7, lineHeight: 1.7 }}>
            حساب زوهو يتيح أكثر من مؤسسة. اختر المؤسسة التي تخص لمحة؛ لن نحفظ الربط قبل تأكيدك.
          </div>
          <div role="radiogroup" aria-label="مؤسسات Zoho Books"
            style={{ display: 'grid', gap: 8, marginTop: 16, textAlign: 'right' }}>
            {organizationChoice.organizations.map(org => {
              const selected = organizationChoice.selectedId === org.id;
              return (
                <label key={org.id} style={{
                  display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'center',
                  padding: '11px 12px', borderRadius: 10, cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--brand)' : 'var(--border)'}`,
                  background: selected ? 'color-mix(in srgb, var(--brand) 8%, var(--surface))' : 'var(--surface2)',
                }}>
                  <input type="radio" name="zoho-organization" value={org.id} checked={selected}
                    onChange={() => setOrganizationChoice(v => ({ ...v, selectedId: org.id }))}/>
                  <span>
                    <b style={{ display: 'block', fontSize: 13.5 }}>{org.name}</b>
                    <small style={{ color: 'var(--muted)', fontSize: 11 }}>
                      {org.currency || 'عملة غير محددة'} · {org.id}{org.isDefault ? ' · الافتراضية' : ''}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            <Btn variant="ghost" onClick={cancelOrganization}>إلغاء</Btn>
            <Btn variant="accent" onClick={confirmOrganization}>تأكيد المؤسسة المختارة</Btn>
          </div>
        </>)}
        {status === 'done' && (<>
          <CheckCircle2 size={44} color="var(--green)" style={{ margin: '0 auto' }}/>
          <div style={{ fontWeight: 800, fontSize: 17, marginTop: 14 }}>✅ تم الربط مع Zoho Books</div>
          {detail && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>{detail}</div>}
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
            المفتاح دائم — لن تكرر هذه الخطوة أبداً. تطبيقكم القديم وربط النظام الداخلي لم يُمَسّا.
          </div>
          <Btn variant="accent" style={{ marginTop: 18 }} onClick={() => navigate('/overview')}>الذهاب للرئيسية</Btn>
        </>)}
        {status === 'error' && (<>
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
