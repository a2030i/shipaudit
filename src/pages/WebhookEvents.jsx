// Webhook events workspace.
//
// Shows every file received via the inbound webhook + lets the admin
// manually classify unknown senders so the next file from the same
// source identifies automatically.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Download, Webhook, Mail, FileText, CheckCircle2,
  AlertCircle, HelpCircle, Copy, ExternalLink,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, Modal, toast } from '../components/UI.jsx';
import {
  loadWebhookEvents, countByStatus, assignEventToCarrier,
  downloadEventFile, getWebhookEndpoint,
} from '../lib/webhookService.js';
import { useAuth } from '../lib/auth.jsx';

const STATUS_META = {
  pending:              { color: 'var(--muted)',  bg: 'rgba(122,130,196,.10)', label: '⏸ في الانتظار' },
  processing:           { color: 'var(--gold)',   bg: 'rgba(251,191,36,.10)',  label: '⏳ قيد المعالجة' },
  processed:            { color: 'var(--green)',  bg: 'rgba(45,212,191,.10)',  label: '✓ تم' },
  failed:               { color: 'var(--red)',    bg: 'rgba(248,113,113,.10)', label: '✗ فشل' },
  awaiting_assignment:  { color: 'var(--gold)',   bg: 'rgba(251,191,36,.10)',  label: '⚠ يحتاج ربط' },
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-SA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const fmtSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function WebhookEvents({ carriers, isActive = true }) {
  const { profile } = useAuth();
  const [events,    setEvents]    = useState([]);
  const [counts,    setCounts]    = useState({});
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('all');
  const [assigning, setAssigning] = useState(null);
  const [chosenCarrier, setChosenCarrier] = useState('');
  const [learnSig,  setLearnSig]  = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [evs, c] = await Promise.all([loadWebhookEvents({ limit: 200 }), countByStatus()]);
      setEvents(evs);
      setCounts(c);
    } catch (err) {
      toast(`فشل التحميل: ${err.message}`, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter(e => e.status === filter);
  }, [events, filter]);

  const handleAssign = async () => {
    if (!assigning || !chosenCarrier) return;
    try {
      await assignEventToCarrier(assigning.id, chosenCarrier, {
        learnSignature: learnSig,
        userId: profile?.id,
      });
      toast('تم ربط الملف بالشركة' + (learnSig ? ' + حفظ البصمة' : ''), 'success');
      setAssigning(null);
      setChosenCarrier('');
      refresh();
    } catch (err) {
      toast(`فشلت العملية: ${err.message}`, 'error');
    }
  };

  const carrierName = (id) => (carriers || []).find(c => c.id === id)?.name || id || '—';
  const endpoint = getWebhookEndpoint();

  const copyEndpoint = () => {
    navigator.clipboard.writeText(endpoint);
    toast('تم نسخ رابط Webhook', 'success');
  };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400 }}>
      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative',
        padding: '24px 28px',
        marginBottom: 22,
        borderRadius: 'var(--r-lg)',
        background: 'linear-gradient(135deg, #1B1E54 0%, #262A6E 55%, #2DD4BF 130%)',
        color: '#fff',
        overflow: 'hidden',
        boxShadow: '0 10px 32px rgba(27,30,84,.25)',
      }}>
        <div style={{ position: 'absolute', left: -40, top: -40, width: 220, height: 220, opacity: .08, pointerEvents: 'none' }}>
          <svg viewBox="0 0 64 64" fill="none">
            <path d="M32 6 L54 18 L54 46 L32 58 L10 46 L10 18 Z" fill="#fff"/>
          </svg>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: 3, textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>
            LAMHA · INBOUND WEBHOOK
          </div>
          <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 6, lineHeight: 1.2 }}>
            استلام الفواتير تلقائياً
          </h1>
          <p style={{ color: 'rgba(255,255,255,.78)', fontSize: 13, margin: 0, marginBottom: 14 }}>
            وجّه أتمتتك (Zapier / n8n / Make / IFTTT) لهذا الرابط مع الملف بصيغة base64. الملف يُسجَّل تلقائياً ويُربط بالشركة الصحيحة.
          </p>

          {/* Endpoint chip */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px',
            background: 'rgba(0,0,0,.22)',
            border: '1px solid rgba(255,255,255,.22)',
            borderRadius: 10,
            fontFamily: 'var(--font-mono)', fontSize: 11.5,
            color: 'rgba(255,255,255,.9)',
            maxWidth: 720,
            direction: 'ltr',
          }}>
            <Webhook size={14} style={{ flexShrink: 0, opacity: .7 }}/>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              POST {endpoint}
            </span>
            <button onClick={copyEndpoint} style={{
              background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.18)',
              color: '#fff', padding: '4px 10px', borderRadius: 6,
              fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
              fontFamily: 'var(--font-sans)',
            }}>
              <Copy size={11}/> نسخ
            </button>
          </div>
        </div>
      </div>

      {/* ── STAT FILTERS ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { k: 'all',                  l: 'الكل',          n: events.length,                color: 'var(--accent)' },
          { k: 'awaiting_assignment',  l: 'يحتاج ربط',     n: counts.awaiting_assignment ?? 0, color: 'var(--gold)' },
          { k: 'processed',            l: 'تم',            n: counts.processed ?? 0,        color: 'var(--green)' },
          { k: 'failed',               l: 'فشل',           n: counts.failed ?? 0,           color: 'var(--red)' },
        ].map(t => (
          <button key={t.k} onClick={() => setFilter(t.k)} style={{
            background: filter === t.k ? `color-mix(in srgb, ${t.color} 14%, transparent)` : 'transparent',
            border: `1px solid ${filter === t.k ? t.color : 'var(--border)'}`,
            color: filter === t.k ? t.color : 'var(--muted)',
            borderRadius: 9, padding: '7px 14px', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 7,
          }}>
            {t.l}
            <span style={{
              background: filter === t.k ? `color-mix(in srgb, ${t.color} 20%, transparent)` : 'var(--surface)',
              color: filter === t.k ? t.color : 'var(--muted)',
              fontSize: 10, padding: '1px 7px', borderRadius: 8, fontFamily: 'var(--font-mono)',
            }}>{t.n}</span>
          </button>
        ))}
        <div style={{ marginInlineStart: 'auto' }}>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh} disabled={loading}>
            تحديث
          </Btn>
        </div>
      </div>

      {/* ── EVENTS TABLE ─────────────────────────────────────────────── */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={26}/></div>
        ) : filtered.length === 0 ? (
          <Empty
            icon="📭"
            title="ما فيه أحداث بهذا الفلتر"
            sub="أرسل أول ملف للرابط أعلاه أو غيّر الفلتر"
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 130 }}>التاريخ</th>
                  <th style={{ minWidth: 200 }}>المُرسِل</th>
                  <th style={{ minWidth: 240 }}>الملف</th>
                  <th style={{ minWidth: 130 }}>الشركة المعرّفة</th>
                  <th style={{ minWidth: 100 }}>طريقة</th>
                  <th style={{ minWidth: 110 }}>الحالة</th>
                  <th style={{ minWidth: 180 }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const meta = STATUS_META[e.status] || STATUS_META.pending;
                  const cName = carrierName(e.detected_carrier_id);
                  return (
                    <tr key={e.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {fmtDate(e.received_at)}
                      </td>
                      <td style={{ fontSize: 11.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Mail size={11} color="var(--muted)"/>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, direction: 'ltr' }}>
                            {e.sender || '—'}
                          </span>
                        </div>
                        {e.subject && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                            {e.subject}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <FileText size={11} color="var(--muted)"/>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
                            {e.file_name}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          {fmtSize(e.file_size)}
                        </div>
                      </td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>
                        {e.detected_carrier_id
                          ? <span style={{ color: 'var(--accent)' }}>{cName}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                      <td style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        {e.detection_method === 'email_from' && 'بريد'}
                        {e.detection_method === 'filename'   && 'اسم ملف'}
                        {e.detection_method === 'columns'    && 'أعمدة'}
                        {e.detection_method === 'manual'     && 'يدوي'}
                        {!e.detection_method && '—'}
                        {e.detection_confidence != null && (
                          <span style={{ marginInlineStart: 4, opacity: .65 }}>
                            ({Math.round(e.detection_confidence * 100)}%)
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{
                          padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                          background: meta.bg, color: meta.color, fontFamily: 'var(--font-mono)',
                          border: `1px solid ${meta.color}40`,
                          whiteSpace: 'nowrap',
                        }}>
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {e.file_path && (
                            <Btn size="sm" variant="ghost" icon={<Download size={12}/>} onClick={() => downloadEventFile(e).catch(err => toast(err.message,'error'))}>
                              تنزيل
                            </Btn>
                          )}
                          {!e.detected_carrier_id && (
                            <Btn size="sm" variant="accent" icon={<HelpCircle size={12}/>} onClick={() => { setAssigning(e); setChosenCarrier(''); setLearnSig(true); }}>
                              ربط بشركة
                            </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Assign modal ──────────────────────────────────────────────── */}
      {assigning && (
        <Modal title="ربط الملف بشركة" onClose={() => setAssigning(null)}>
          <div style={{ marginBottom: 14, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{assigning.file_name}</div>
            {assigning.sender && (
              <div style={{ marginTop: 4 }}>من: <span style={{ direction: 'ltr', fontFamily: 'var(--font-mono)' }}>{assigning.sender}</span></div>
            )}
          </div>

          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
            اختر الشركة
          </label>
          <select
            value={chosenCarrier}
            onChange={e => setChosenCarrier(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 9, fontSize: 13, marginBottom: 14 }}
          >
            <option value="">— اختر —</option>
            {(carriers || []).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 12px', background: 'rgba(45,212,191,.06)', border: '1px solid rgba(45,212,191,.22)', borderRadius: 9, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={learnSig} onChange={e => setLearnSig(e.target.checked)} style={{ marginTop: 3, accentColor: '#2DD4BF' }}/>
            <div style={{ fontSize: 12, lineHeight: 1.55 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>تذكَّر الشركة للملفات القادمة</div>
              <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                نخزن بريد المرسل + نمط اسم الملف في بصمة الشركة. الملف القادم من نفس المصدر يتعرف عليه النظام تلقائياً.
              </div>
            </div>
          </label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setAssigning(null)}>تراجع</Btn>
            <Btn variant="accent" onClick={handleAssign} disabled={!chosenCarrier} icon={<CheckCircle2 size={13}/>}>
              ربط
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
