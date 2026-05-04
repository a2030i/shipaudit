import { useState, useEffect } from 'react';
import { Spinner, Btn, toast } from '../../components/UI.jsx';
import { supabase } from '../../lib/supabase.js';

const REDIRECT_URI = 'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/gmail-callback';

// ── Small helpers ────────────────────────────────────────────────────────────

function StepBadge({ n, done, active }) {
  return (
    <div style={{
      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: done ? 14 : 13, fontWeight: 700,
      background: done ? 'rgba(52,211,153,.18)' : active ? 'rgba(56,189,248,.18)' : 'rgba(255,255,255,.04)',
      border: `1.5px solid ${done ? 'rgba(52,211,153,.4)' : active ? 'rgba(56,189,248,.4)' : 'var(--border2)'}`,
      color: done ? 'var(--green)' : active ? 'var(--accent)' : 'var(--muted)',
      transition: 'all .25s',
    }}>
      {done ? '✓' : n}
    </div>
  );
}

function GuideStep({ n, title, done, active, last, children }) {
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
        <StepBadge n={n} done={done} active={active}/>
        {!last && <div style={{ flex: 1, width: 2, background: 'var(--border)', margin: '4px 0', minHeight: 20 }}/>}
      </div>
      <div style={{ flex: 1, paddingBottom: last ? 0 : 20 }}>
        <div style={{
          fontWeight: 700, fontSize: 13, marginBottom: 10,
          color: done ? 'var(--green)' : active ? 'var(--text)' : 'var(--text2)',
        }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, text, sub }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
      <span style={{
        flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--accent)', minWidth: 18, marginTop: 1,
      }}>{icon}</span>
      <div>
        <span>{text}</span>
        {sub && (
          <div style={{
            marginTop: 4, padding: '4px 10px', borderRadius: 6,
            background: 'rgba(56,189,248,.06)', border: '1px solid rgba(56,189,248,.1)',
            fontSize: 11, color: 'var(--muted)',
          }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

function CopyBox({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  };
  return (
    <div>
      {label && <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 5 }}>{label}</div>}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(0,0,0,.35)', border: '1px solid var(--border2)',
        borderRadius: 8, padding: '8px 12px',
      }}>
        <code style={{
          flex: 1, fontSize: 11, color: 'var(--accent)',
          fontFamily: 'var(--font-mono)', wordBreak: 'break-all', lineHeight: 1.5,
        }}>{value}</code>
        <button onClick={copy} style={{
          flexShrink: 0,
          background: copied ? 'rgba(52,211,153,.15)' : 'var(--surface)',
          border: `1px solid ${copied ? 'rgba(52,211,153,.3)' : 'var(--border2)'}`,
          borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
          fontSize: 11, color: copied ? 'var(--green)' : 'var(--muted)',
          fontFamily: 'var(--font-sans)', transition: 'all .2s',
        }}>
          {copied ? '✓ تم النسخ' : 'نسخ'}
        </button>
      </div>
    </div>
  );
}

// ── Setup Guide ──────────────────────────────────────────────────────────────

function SetupGuide({ credsSaved, clientId, setClientId, clientSecret, setClientSecret,
  showSecret, setShowSecret, saving, saveCredentials }) {

  const inp = (extra = {}) => ({
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
    background: 'var(--surface)', border: '1.5px solid var(--border2)',
    color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'var(--font-mono)', transition: 'border-color .2s, box-shadow .2s',
    ...extra,
  });

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '22px 24px', marginBottom: 16,
    }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 22, lineHeight: 1.7 }}>
        اتبع هذه الخطوات مرة واحدة للحصول على بيانات Google اللازمة للربط.
      </p>

      {/* Step 1 */}
      <GuideStep n="1" title="افتح Google Cloud Console" done={credsSaved} active={!credsSaved}>
        <p style={{ marginBottom: 10 }}>سجّل الدخول بنفس حساب Gmail الذي تريد ربطه بالنظام:</p>
        <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(56,189,248,.1)', border: '1px solid rgba(56,189,248,.25)',
          color: 'var(--accent)', borderRadius: 7, padding: '6px 14px',
          fontSize: 12, textDecoration: 'none', fontWeight: 600,
        }}>
          🌐 console.cloud.google.com ↗
        </a>
      </GuideStep>

      {/* Step 2 */}
      <GuideStep n="2" title="أنشئ مشروعاً جديداً" done={credsSaved} active={!credsSaved}>
        <Row icon="①" text='من الشريط العلوي انقر على اسم المشروع الحالي'/>
        <Row icon="②" text='انقر "New Project" ثم أدخل اسماً مثل: ShipAudit'/>
        <Row icon="③" text='انقر "Create" وانتظر الانتهاء ثم افتح المشروع'/>
      </GuideStep>

      {/* Step 3 */}
      <GuideStep n="3" title="فعّل Gmail API" done={credsSaved} active={!credsSaved}>
        <Row icon="①" text='من القائمة الجانبية: APIs & Services → Library'/>
        <Row icon="②" text='ابحث عن "Gmail API" وانقر عليه'/>
        <Row icon="③" text='انقر "Enable" وتأكد أن الحالة أصبحت Enabled'/>
        <div style={{
          marginTop: 6, padding: '7px 11px', borderRadius: 7,
          background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.2)',
          fontSize: 11, color: 'var(--gold)',
        }}>
          ⚡ إذا طُلب منك تفعيل Billing، يمكنك استخدام النسخة المجانية
        </div>
      </GuideStep>

      {/* Step 4 */}
      <GuideStep n="4" title="اعدد OAuth Consent Screen" done={credsSaved} active={!credsSaved}>
        <Row icon="①" text='من القائمة: APIs & Services → OAuth consent screen'/>
        <Row icon="②" text='اختر "External" ثم انقر "Create"'/>
        <Row icon="③" text='أدخل اسم التطبيق مثل "ShipAudit" وأدخل بريدك الإلكتروني'/>
        <Row icon="④" text='انقر "Save and Continue" في جميع الخطوات حتى النهاية'/>
        <div style={{
          marginTop: 6, padding: '7px 11px', borderRadius: 7,
          background: 'rgba(56,189,248,.06)', border: '1px solid rgba(56,189,248,.15)',
          fontSize: 11, color: 'var(--text2)',
        }}>
          💡 لا حاجة لإضافة نطاقات (Scopes) الآن، سيتم طلبها تلقائياً عند الربط
        </div>
      </GuideStep>

      {/* Step 5 */}
      <GuideStep n="5" title="أنشئ OAuth 2.0 Client ID" done={credsSaved} active={!credsSaved}>
        <Row icon="①" text='من القائمة: APIs & Services → Credentials'/>
        <Row icon="②" text='"Create Credentials" ثم اختر "OAuth Client ID"'/>
        <Row icon="③" text='في "Application Type" اختر: Web application'/>
        <Row icon="④" text='في "Authorized redirect URIs" انقر "+ Add URI" وأضف الرابط التالي:'/>
        <div style={{ margin: '10px 0' }}>
          <CopyBox label="Redirect URI — انسخه والصقه في Google بالضبط" value={REDIRECT_URI}/>
        </div>
        <div style={{
          marginTop: 2, marginBottom: 10, padding: '7px 11px', borderRadius: 7,
          background: 'rgba(248,113,113,.07)', border: '1px solid rgba(248,113,113,.2)',
          fontSize: 11, color: 'var(--red)',
        }}>
          ⚠️ الرابط يجب أن يكون مطابقاً تماماً، أي حرف مختلف سيسبب خطأ
        </div>
        <Row icon="⑤" text='انقر "Create" — ستظهر نافذة تحتوي على Client ID و Client Secret'/>
        <Row icon="⑥" text='انسخهما وأدخلهما في الخانتين أدناه'/>
      </GuideStep>

      {/* Step 6 — input fields */}
      <GuideStep n="6" title={credsSaved ? 'البيانات محفوظة ✓' : 'أدخل البيانات واحفظها'}
        done={credsSaved} active={!credsSaved} last>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
            Client ID
          </label>
          <input
            value={clientId} onChange={e => setClientId(e.target.value)}
            placeholder="123456789-abc...apps.googleusercontent.com"
            style={inp()}
            onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px rgba(56,189,248,.12)'; }}
            onBlur={e  => { e.target.style.borderColor = 'var(--border2)'; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
            Client Secret
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showSecret ? 'text' : 'password'}
              value={clientSecret} onChange={e => setClientSecret(e.target.value)}
              placeholder="GOCSPX-..."
              style={inp({ paddingLeft: 40 })}
              onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px rgba(56,189,248,.12)'; }}
              onBlur={e  => { e.target.style.borderColor = 'var(--border2)'; e.target.style.boxShadow = 'none'; }}
            />
            <button type="button" onClick={() => setShowSecret(v => !v)} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--muted)', fontSize: 14, padding: 0,
            }}>{showSecret ? '🙈' : '👁'}</button>
          </div>
        </div>

        <Btn
          variant={credsSaved ? 'ghost' : 'primary'}
          onClick={saveCredentials} disabled={saving}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {saving
            ? <><Spinner size={13}/> جاري الحفظ...</>
            : credsSaved ? '💾 تحديث البيانات' : '💾 حفظ البيانات'}
        </Btn>
      </GuideStep>

    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function GmailSettings() {
  const [connection,   setConnection]   = useState(null);
  const [clientId,     setClientId]     = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret,   setShowSecret]   = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [syncFrom,     setSyncFrom]     = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [connecting,    setConnecting]    = useState(false);
  const [credsSaved,    setCredsSaved]    = useState(false);
  const [guideOpen,     setGuideOpen]     = useState(true);
  const [syncProgress,  setSyncProgress]  = useState(null); // { done, total } | null

  const loadState = async () => {
    setLoading(true);
    try {
      const [{ data: cidRow }, { data: csecRow }, { data: conn }] = await Promise.all([
        supabase.from('app_settings').select('value').eq('key', 'GOOGLE_CLIENT_ID').single(),
        supabase.from('app_settings').select('value').eq('key', 'GOOGLE_CLIENT_SECRET').single(),
        supabase.from('gmail_connections').select('*').maybeSingle(),
      ]);
      if (cidRow?.value)  { setClientId(cidRow.value);      setCredsSaved(true); setGuideOpen(false); }
      if (csecRow?.value) { setClientSecret(csecRow.value); }
      setConnection(conn ?? null);
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => {
    loadState();
    // With HashRouter the callback params land in window.location.search (before the #)
    // but the edge function redirects to the full URL including ?query before #hash.
    // Check both search and the hash query string.
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail_connected')) {
      toast('تم ربط Gmail بنجاح ✓', 'success');
      // Remove query params from URL
      const base = window.location.href.split('?')[0];
      window.history.replaceState({}, '', base);
      loadState();
    }
    if (params.get('gmail_error')) {
      toast(`خطأ في ربط Gmail: ${params.get('gmail_error')}`, 'error');
      const base = window.location.href.split('?')[0];
      window.history.replaceState({}, '', base);
    }
  }, []);

  const saveCredentials = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast('أدخل Client ID و Client Secret', 'warn'); return;
    }
    setSaving(true);
    try {
      await supabase.from('app_settings').upsert([
        { key: 'GOOGLE_CLIENT_ID',     value: clientId.trim() },
        { key: 'GOOGLE_CLIENT_SECRET', value: clientSecret.trim() },
      ], { onConflict: 'key' });
      setCredsSaved(true);
      setGuideOpen(false);
      toast('تم حفظ بيانات Google ✓', 'success');
    } catch (e) {
      toast(`خطأ: ${e.message}`, 'error');
    }
    setSaving(false);
  };

  const connectGmail = async () => {
    setConnecting(true);
    try {
      // Strip any existing query params; keep origin + hash path (without trailing query)
      const returnUrl = window.location.origin + window.location.pathname;
      const { data, error } = await supabase.functions.invoke('gmail-auth', {
        body: { returnUrl },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      window.location.href = data.url;
    } catch (e) {
      toast(`خطأ: ${e.message}`, 'error');
      setConnecting(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncProgress({ done: 0, total: 0 });
    let gmailTotal = 0;

    const runOnce = async (resume) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/gmail-sync',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1YnRrZndtem5mbWZmYXZ5enN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDY4NjYsImV4cCI6MjA5MjYyMjg2Nn0.Ky-Fz9cyleSV8E84O7Zid5kZ_UTSDVaavgS_-yOvauI',
          },
          body: JSON.stringify({ fromDate: syncFrom, resume }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedFinal = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'fetching') {
              setSyncProgress({ done: 0, total: 0, fetching: true, gmail_total: 0 });
            } else if (msg.type === 'start') {
              gmailTotal = msg.gmail_total ?? 0;
              setSyncProgress({ done: 0, total: msg.total, gmail_total: gmailTotal });
            } else if (msg.type === 'resume') {
              gmailTotal = msg.gmail_total ?? gmailTotal;
              setSyncProgress({ done: msg.done, total: msg.total, gmail_total: gmailTotal });
            } else if (msg.type === 'progress') {
              setSyncProgress({ done: msg.done, total: msg.total, gmail_total: gmailTotal });
            } else if (msg.type === 'partial') {
              receivedFinal = true;
              gmailTotal = msg.gmail_total ?? gmailTotal;
              setSyncProgress({ done: msg.done, total: msg.total, gmail_total: gmailTotal });
              return 'partial';
            } else if (msg.type === 'done') {
              receivedFinal = true;
              const skipped = (msg.gmail_total || 0) - msg.total;
              toast(
                msg.total === 0
                  ? `لا يوجد جديد (${msg.gmail_total} في Gmail، كلها محفوظة مسبقاً)`
                  : `تم: ${msg.created} جديد · ${msg.total - msg.created} إصلاح · ${skipped} بدون تغيير ✓`,
                msg.created > 0 ? 'success' : 'info'
              );
              loadState();
              return 'done';
            } else if (msg.type === 'error') {
              throw new Error(msg.message);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
      // Stream closed without a final message → function timed out mid-run.
      // Saved checkpoint in sync_state means resume=true will pick up where it left off.
      if (!receivedFinal) return 'partial';
      return 'done';
    };

    try {
      let result = await runOnce(false);
      while (result === 'partial') {
        result = await runOnce(true);
      }
    } catch (e) {
      toast(`خطأ في المزامنة: ${e.message}`, 'error');
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('هل تريد قطع الاتصال مع Gmail؟')) return;
    try {
      await supabase.from('gmail_connections').delete().eq('gmail_address', connection.gmail_address);
      setConnection(null);
      setGuideOpen(true);
      toast('تم قطع الاتصال', 'info');
    } catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
  };

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <Spinner size={20}/>
    </div>
  );

  const guideProps = {
    credsSaved, clientId, setClientId, clientSecret, setClientSecret,
    showSecret, setShowSecret, saving, saveCredentials,
  };

  return (
    <div style={{ maxWidth: 560 }}>

      {/* Header card */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18,
        padding: '16px 20px', background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: connection ? 'rgba(52,211,153,.12)' : 'rgba(56,189,248,.1)',
          border: `1px solid ${connection ? 'rgba(52,211,153,.25)' : 'rgba(56,189,248,.2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
        }}>📧</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>ربط Gmail بالنظام</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {connection
              ? `متصل بـ ${connection.gmail_address}`
              : 'جلب الرسائل المالية تلقائياً وتحويلها إلى مهام'}
          </div>
        </div>
        <div style={{
          fontSize: 10, padding: '3px 10px', borderRadius: 9, flexShrink: 0,
          background: connection ? 'rgba(52,211,153,.12)' : 'rgba(251,146,60,.1)',
          border: `1px solid ${connection ? 'rgba(52,211,153,.25)' : 'rgba(251,146,60,.25)'}`,
          color: connection ? 'var(--green)' : 'var(--warn)',
          fontWeight: 600,
        }}>
          {connection ? '● متصل' : '● غير مرتبط'}
        </div>
      </div>

      {/* Connected: sync / disconnect */}
      {connection && (
        <div style={{
          background: 'rgba(52,211,153,.06)', border: '1px solid rgba(52,211,153,.2)',
          borderRadius: 10, padding: '14px 16px', marginBottom: 16,
        }}>
          {connection.last_sync_at && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
              آخر مزامنة: {new Date(connection.last_sync_at).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}
            </div>
          )}

          {/* Date filter */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
              استيراد الرسائل من تاريخ
            </label>
            <input
              type="date"
              value={syncFrom}
              onChange={e => setSyncFrom(e.target.value)}
              style={{
                width: '100%', padding: '8px 11px', borderRadius: 8, fontSize: 13,
                background: 'var(--surface)', border: '1px solid var(--border2)',
                color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Progress bar */}
          {syncProgress && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 11, color: 'var(--muted)', marginBottom: 5,
              }}>
                <span>
                  {syncProgress.fetching
                    ? 'جاري جلب قائمة الرسائل...'
                    : syncProgress.total === 0
                      ? 'جاري المقارنة مع القاعدة...'
                      : `جاري المعالجة... (${syncProgress.gmail_total} في Gmail)`}
                </span>
                {syncProgress.total > 0 && (
                  <span style={{ fontFamily: 'var(--font-mono)' }}>
                    {syncProgress.done} / {syncProgress.total}
                    <span style={{ color: 'var(--accent)', marginRight: 5 }}>
                      ({Math.round((syncProgress.done / syncProgress.total) * 100)}%)
                    </span>
                  </span>
                )}
              </div>
              <div style={{
                height: 7, borderRadius: 4,
                background: 'rgba(56,189,248,.12)',
                overflow: 'hidden',
                border: '1px solid rgba(56,189,248,.15)',
              }}>
                <div style={{
                  height: '100%',
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, var(--accent), rgba(99,219,250,0.8))',
                  width: syncProgress.total > 0
                    ? `${Math.round((syncProgress.done / syncProgress.total) * 100)}%`
                    : '100%',
                  transition: syncProgress.total > 0 ? 'width 0.2s ease' : 'none',
                  animation: syncProgress.total === 0 ? 'progressPulse 1.2s ease-in-out infinite' : 'none',
                  opacity: syncProgress.total === 0 ? undefined : 1,
                }}/>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 9 }}>
            <Btn variant="primary" onClick={syncNow} disabled={syncing}
              style={{ flex: 2, justifyContent: 'center' }}>
              {syncing ? <><Spinner size={13}/> جاري المزامنة...</> : '🔄 مزامنة الآن'}
            </Btn>
            <Btn variant="danger" onClick={disconnect} style={{ flex: 1, justifyContent: 'center' }}>
              قطع الاتصال
            </Btn>
          </div>
        </div>
      )}

      {/* Guide toggle */}
      <button onClick={() => setGuideOpen(v => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface)', border: '1px solid var(--border2)',
        borderRadius: 9, padding: '10px 14px', cursor: 'pointer', marginBottom: 12,
        color: 'var(--text2)', fontSize: 12, fontFamily: 'var(--font-sans)',
      }}>
        <span style={{ fontWeight: 600 }}>📋 دليل الإعداد خطوة بخطوة</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {guideOpen ? '▲ إخفاء' : '▼ عرض'}
        </span>
      </button>

      {guideOpen && <SetupGuide {...guideProps}/>}

      {/* Connect button (shown only when not connected) */}
      {!connection && (
        <>
          <Btn
            variant="primary" onClick={connectGmail}
            disabled={connecting || !credsSaved}
            style={{ width: '100%', justifyContent: 'center', padding: '13px 0', fontSize: 14 }}
          >
            {connecting
              ? <><Spinner size={14}/> يفتح Google...</>
              : !credsSaved
                ? '🔒 أكمل الخطوات أعلاه أولاً'
                : '🔗 ربط حساب Gmail'}
          </Btn>
          {!credsSaved && (
            <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              يجب حفظ بيانات Google أولاً
            </p>
          )}
        </>
      )}
    </div>
  );
}
