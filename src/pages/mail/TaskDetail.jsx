import { useState, useEffect, useRef } from 'react';
import { Spinner, Btn, toast } from '../../components/UI.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { supabase } from '../../lib/supabase.js';
import {
  getTaskById, approveTask, rejectTask, addComment,
  reassignTask, getAllProfiles, getFileUrl, markTaskRead, deleteTask, logTaskView,
} from '../../lib/mailService.js';
import { aiEmailAssist } from '../../engine/openrouter.js';
import { loadSettings } from '../../data/carriers.js';

const STATUS_LABEL = {
  analyzing:    { text: 'قيد التحليل',   color: '#a78bfa' },
  pending_acc1: { text: 'بانتظار م. أول',  color: 'var(--gold)' },
  pending_acc2: { text: 'بانتظار م. ثانٍ', color: '#fb923c' },
  approved_acc1:{ text: 'اعتمد م. أول',   color: '#34d399' },
  rejected_acc1:{ text: 'رفض م. أول',     color: 'var(--red)' },
  approved:     { text: 'معتمد ✓',        color: 'var(--green)' },
  rejected:     { text: 'مرفوض ✗',        color: 'var(--red)' },
  not_financial:{ text: 'غير مالي',       color: 'var(--muted)' },
};

const PRIORITY_LABEL = {
  low: { text: 'منخفض', color: 'var(--muted)' },
  normal: { text: 'عادي', color: 'var(--accent)' },
  high: { text: 'عالي', color: 'var(--gold)' },
  urgent: { text: '🚨 عاجل', color: 'var(--red)' },
};

const ACTION_ICON = { created: '📨', approved: '✅', rejected: '❌', comment: '💬', reassigned: '🔀', analyzed: '🤖' };

export default function TaskDetail({ taskId, onClose, onUpdated }) {
  const { profile } = useAuth();
  const [task,     setTask]     = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [acting,   setActing]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes,    setNotes]    = useState('');
  const [tab,      setTab]      = useState('details'); // 'details' | 'actions' | 'attachments' | 'ai'
  const [reassignTo, setReassignTo] = useState('');
  const [aiResult,  setAiResult]  = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHint,    setAiHint]    = useState('');
  const [aiAction,  setAiAction]  = useState(null); // 'analyze' | 'reply' | 'compose'
  const aiAbort = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([getTaskById(taskId), getAllProfiles()]);
      setTask(t); setProfiles(p);
      if (!t?.is_read) markTaskRead(taskId).catch(() => {});
      if (profile?.role !== 'admin') logTaskView(taskId, profile.id).catch(() => {});
    } catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [taskId]);

  const isAssignedToMe = task?.assigned_to === profile?.id;
  const myPendingStatus =
    (profile?.role === 'accountant1' && task?.status === 'pending_acc1') ||
    (profile?.role === 'accountant2' && task?.status === 'pending_acc2');
  const isAdmin = profile?.role === 'admin';

  // Can approve/reject: must be the assigned employee in the right pending state, or admin
  const canApproveReject = task && (myPendingStatus || isAdmin);
  // Can comment/see action bar: any assigned employee or admin
  const canAct = task && (isAssignedToMe || isAdmin);

  const act = async (fn) => {
    setActing(true);
    try { await fn(); await load(); onUpdated?.(); toast('تم بنجاح ✓', 'success'); }
    catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
    setActing(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTask(taskId, profile.id);
      toast('تم حذف الإيميل ✓', 'success');
      onUpdated?.();
      onClose();
    } catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
    setDeleting(false);
    setConfirmDelete(false);
  };

  const inp = {
    width: '100%', padding: '8px 11px', borderRadius: 8, fontSize: 12,
    background: 'var(--surface)', border: '1px solid var(--border)',
    color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <Spinner size={24}/>
    </div>
  );

  if (!task) return null;
  const st = STATUS_LABEL[task.status] || { text: task.status, color: 'var(--muted)' };
  const pr = PRIORITY_LABEL[task.priority] || PRIORITY_LABEL.normal;

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--card)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5, wordBreak: 'break-word' }}>
              {task.email_subject}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                background: `${st.color}20`, color: st.color,
                fontSize: 10, padding: '2px 9px', borderRadius: 10,
                border: `1px solid ${st.color}40`,
              }}>{st.text}</span>
              <span style={{ color: pr.color, fontSize: 10 }}>{pr.text}</span>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{task.email_from}</span>
              <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                {new Date(task.email_date).toLocaleString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' })}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {isAdmin && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} title="حذف الإيميل" style={{
                background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.25)',
                color: '#f87171', cursor: 'pointer', fontSize: 13,
                borderRadius: 7, padding: '4px 9px', lineHeight: 1,
              }}>🗑</button>
            )}
            {isAdmin && confirmDelete && (
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#f87171' }}>تأكيد الحذف؟</span>
                <button onClick={handleDelete} disabled={deleting} style={{
                  background: 'rgba(248,113,113,.15)', border: '1px solid rgba(248,113,113,.4)',
                  color: '#f87171', cursor: 'pointer', fontSize: 11,
                  borderRadius: 6, padding: '3px 9px',
                }}>{deleting ? '...' : 'حذف'}</button>
                <button onClick={() => setConfirmDelete(false)} style={{
                  background: 'none', border: '1px solid var(--border2)',
                  color: 'var(--muted)', cursor: 'pointer', fontSize: 11,
                  borderRadius: 6, padding: '3px 9px',
                }}>لا</button>
              </div>
            )}
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', color: 'var(--muted)',
              cursor: 'pointer', fontSize: 20, padding: '0 4px',
            }}>✕</button>
          </div>
        </div>

        {/* AI summary */}
        {task.ai_summary && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: 'rgba(245,166,35,.08)', borderRadius: 8,
            fontSize: 12, color: 'var(--gold)', lineHeight: 1.5,
          }}>
            ✨ {task.ai_summary}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
          {[
            { id: 'details',     label: '📄 التفاصيل' },
            { id: 'attachments', label: `📎 المرفقات (${task.attachments?.length || 0})` },
            { id: 'actions',     label: `📋 السجل (${task.task_actions?.length || 0})` },
            { id: 'ai',          label: '✨ AI' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '5px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer',
              background: tab === t.id ? (t.id === 'ai' ? 'rgba(245,166,35,.12)' : 'var(--accent)20') : 'transparent',
              border: `1px solid ${tab === t.id ? (t.id === 'ai' ? 'rgba(245,166,35,.3)' : 'var(--accent)40') : 'transparent'}`,
              color: tab === t.id ? (t.id === 'ai' ? 'var(--gold)' : 'var(--accent)') : 'var(--muted)',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

        {/* ── Tab: Details ── */}
        {tab === 'details' && <EmailBody task={task}/>}

        {/* ── Tab: Attachments ── */}
        {tab === 'attachments' && (
          <div>
            {!task.attachments?.length
              ? <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 20 }}>لا توجد مرفقات</div>
              : task.attachments.map(a => (
                <AttachmentRow key={a.id} attachment={a}/>
              ))
            }
          </div>
        )}

        {/* ── Tab: Actions ── */}
        {tab === 'actions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {task.task_actions?.map(a => (
              <div key={a.id} style={{
                display: 'flex', gap: 10, padding: '10px 14px',
                background: 'var(--surface)', borderRadius: 9,
                border: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 16 }}>{ACTION_ICON[a.action] || '•'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{a.user?.name || '—'}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                      {new Date(a.created_at).toLocaleString('ar-SA')}
                    </span>
                  </div>
                  {a.notes && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{a.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: AI ── */}
        {tab === 'ai' && (
          <AiPanel
            task={task}
            aiResult={aiResult} setAiResult={setAiResult}
            aiLoading={aiLoading} setAiLoading={setAiLoading}
            aiHint={aiHint} setAiHint={setAiHint}
            aiAction={aiAction} setAiAction={setAiAction}
            aiAbort={aiAbort}
          />
        )}
      </div>

      {/* Action Bar */}
      {canAct && (
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--border)',
          background: 'var(--card)', flexShrink: 0,
        }}>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="ملاحظات (اختياري)..." rows={2}
            style={{ ...inp, resize: 'none', marginBottom: 10, fontFamily: 'var(--font-sans)' }}/>

          <div style={{ display: 'flex', gap: 8 }}>
            {canApproveReject && <>
              <Btn variant="success" disabled={acting}
                onClick={() => act(() => approveTask(task, profile.id, notes))}
                style={{ flex: 1, justifyContent: 'center', gap: 6 }}>
                {acting ? <Spinner size={13}/> : '✅'} موافقة
              </Btn>
              <Btn variant="danger" disabled={acting}
                onClick={() => { if (!notes.trim()) { toast('أدخل سبب الرفض', 'warn'); return; } act(() => rejectTask(task.id, profile.id, notes)); }}
                style={{ flex: 1, justifyContent: 'center', gap: 6 }}>
                {acting ? <Spinner size={13}/> : '❌'} رفض
              </Btn>
            </>}
            <Btn variant="ghost" disabled={acting}
              onClick={() => { if (!notes.trim()) { toast('أدخل ملاحظة', 'warn'); return; } act(() => addComment(task.id, profile.id, notes)).then(() => setNotes('')); }}
              style={{ justifyContent: 'center', gap: 5 }}>
              💬 تعليق
            </Btn>
          </div>

          {/* Reassign (admin + assigned employee) */}
          {(isAdmin || isAssignedToMe) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
                style={{ ...inp, flex: 1 }}>
                <option value="">إسناد إلى...</option>
                {profiles
                  .filter(p => p.id !== profile.id)
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.role === 'accountant1' ? 'م. أول' : 'م. ثانٍ'}
                    </option>
                  ))}
              </select>
              <Btn size="sm" variant="outline" disabled={!reassignTo || acting}
                onClick={() => act(() => { reassignTask(task.id, reassignTo, profile.id, notes); setReassignTo(''); })}>
                إسناد
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Email body helpers ────────────────────────────────────────────────────────

function splitSignature(text) {
  if (!text) return { main: '', sig: null };
  // Detect separator: 6+ repeated =, -, _ chars
  const m = text.match(/[ \t]*[=\-_]{6,}[ \t]*/);
  if (!m || m.index == null) return { main: text, sig: null };
  const main = text.slice(0, m.index).trim();
  const sig  = text.slice(m.index + m[0].length).trim();
  return { main, sig: sig || null };
}

function EmailBody({ task }) {
  const [showSig,  setShowSig]  = useState(false);
  const [htmlView, setHtmlView] = useState(!!task.email_html);
  const iframeRef = useRef(null);

  const hasHtml = !!task.email_html;

  // Auto-resize iframe after content loads
  const onIframeLoad = () => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        iframeRef.current.style.height = doc.documentElement.scrollHeight + 'px';
      }
    } catch { /* cross-origin fallback */ }
  };

  const rawBody = task.email_body
    ? task.email_body
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&zwnj;/gi, '')
        .replace(/&zwj;/gi, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/[​-‍﻿]/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : '';

  const { main, sig } = splitSignature(rawBody);

  const initials = (task.email_from_name || task.email_from || '?')
    .replace(/['"]/g, '').trim()[0]?.toUpperCase() ?? '?';

  return (
    <div>
      {/* Sender card */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center',
        padding: '10px 14px', marginBottom: 12,
        background: 'var(--surface)', borderRadius: 10,
        border: '1px solid var(--border)',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(56,189,248,.15)', border: '1px solid rgba(56,189,248,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 700, color: 'var(--accent)',
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)', marginBottom: 2 }}>
            {task.email_from_name || task.email_from}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {task.email_from_name && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                {task.email_from}
              </span>
            )}
            <span>·</span>
            <span>{new Date(task.email_date || task.created_at).toLocaleString('ar-SA', {
              year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit', hour12: false,
              timeZone: 'Asia/Riyadh',
            })}</span>
          </div>
        </div>

        {/* HTML / Text toggle */}
        {hasHtml && (
          <button onClick={() => setHtmlView(v => !v)} style={{
            flexShrink: 0, padding: '4px 10px', borderRadius: 7, fontSize: 10,
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
            background: htmlView ? 'rgba(56,189,248,.12)' : 'var(--card)',
            border: `1px solid ${htmlView ? 'rgba(56,189,248,.3)' : 'var(--border2)'}`,
            color: htmlView ? 'var(--accent)' : 'var(--muted)',
          }}>
            {htmlView ? '🖼 HTML' : '📄 نص'}
          </button>
        )}
      </div>

      {/* HTML iframe view */}
      {htmlView && hasHtml ? (
        <div style={{
          borderRadius: 10, overflow: 'hidden',
          border: '1px solid var(--border)',
          background: '#fff',
        }}>
          <iframe
            ref={iframeRef}
            srcDoc={task.email_html}
            sandbox="allow-same-origin allow-popups"
            onLoad={onIframeLoad}
            title="email-html"
            style={{
              width: '100%', minHeight: 300, border: 'none',
              display: 'block', background: '#fff',
            }}
          />
        </div>
      ) : (
        <>
          {/* Plain text body */}
          {main ? (
            <div style={{
              fontSize: 13, lineHeight: 2, color: 'var(--text)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              padding: '0 4px',
            }}>
              {main}
            </div>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 4px' }}>
              لا يوجد محتوى
            </div>
          )}

          {/* Signature divider + collapsible */}
          {sig && (
            <div style={{ marginTop: 20 }}>
              <button onClick={() => setShowSig(v => !v)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
              }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
                <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0, padding: '0 6px', fontFamily: 'var(--font-sans)' }}>
                  {showSig ? '▲' : '▼'} التوقيع
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
              </button>
              {showSig && (
                <div style={{
                  marginTop: 8, padding: '10px 14px',
                  background: 'rgba(255,255,255,.02)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 11, color: 'var(--muted)',
                  lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {sig}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── AI Panel ──────────────────────────────────────────────────────────────────

function AiPanel({ task, aiResult, setAiResult, aiLoading, setAiLoading, aiHint, setAiHint, aiAction, setAiAction, aiAbort }) {
  const run = async (action) => {
    if (aiLoading) return;
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAiAction(action);
    setAiResult('');
    setAiLoading(true);
    try {
      const result = await aiEmailAssist(action, {
        subject:   task.email_subject,
        body:      task.email_body,
        fromName:  task.email_from_name,
        fromEmail: task.email_from,
        hint:      aiHint,
      }, ctrl.signal);
      setAiResult(result);
    } catch (e) {
      if (e.name !== 'AbortError') toast(`خطأ: ${e.message}`, 'error');
    }
    setAiLoading(false);
  };

  const copy = () => { navigator.clipboard.writeText(aiResult); toast('تم النسخ ✓', 'success'); };
  const stop = () => { aiAbort.current?.abort(); setAiLoading(false); };

  const btnStyle = (id) => ({
    flex: 1, padding: '9px 12px', borderRadius: 8, fontSize: 12,
    cursor: aiLoading ? 'not-allowed' : 'pointer',
    background: aiAction === id && aiResult ? 'rgba(245,166,35,.15)' : 'var(--surface)',
    border: `1px solid ${aiAction === id && aiResult ? 'rgba(245,166,35,.4)' : 'var(--border)'}`,
    color: aiAction === id && aiResult ? 'var(--gold)' : 'var(--text)',
    opacity: aiLoading ? 0.6 : 1,
    transition: 'all .15s',
  });

  const actionLabel = { analyze: '🔍 نتيجة التحليل', reply: '↩ الرد المقترح', compose: '✏ الإيميل المقترح' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btnStyle('analyze')} disabled={aiLoading} onClick={() => run('analyze')}>🔍 تحليل الإيميل</button>
        <button style={btnStyle('reply')}   disabled={aiLoading} onClick={() => run('reply')}>↩ كتابة رد</button>
        <button style={btnStyle('compose')} disabled={aiLoading} onClick={() => run('compose')}>✏ إيميل جديد</button>
      </div>

      {/* Hint input */}
      <textarea
        value={aiHint}
        onChange={e => setAiHint(e.target.value)}
        placeholder="تعليمات إضافية (اختياري) — مثلاً: اطلب تأجيل الدفع أسبوعاً..."
        rows={2}
        autoComplete="off"
        style={{
          width: '100%', padding: '8px 11px', borderRadius: 8, fontSize: 12,
          background: 'var(--surface)', border: '1px solid var(--border)',
          color: 'var(--text)', outline: 'none', resize: 'none',
          boxSizing: 'border-box', fontFamily: 'var(--font-sans)',
        }}
      />

      {/* Loading */}
      {aiLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Spinner size={16}/>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>جارٍ المعالجة...</span>
          <button onClick={stop} style={{
            marginRight: 'auto', padding: '3px 10px', borderRadius: 6,
            background: 'rgba(255,77,109,.08)', border: '1px solid rgba(255,77,109,.35)',
            color: 'var(--red)', cursor: 'pointer', fontSize: 11,
          }}>إيقاف</button>
        </div>
      )}

      {/* Result */}
      {aiResult && !aiLoading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--gold)' }}>{actionLabel[aiAction] ?? '✨ النتيجة'}</span>
            <button onClick={copy} style={{
              padding: '3px 10px', borderRadius: 6,
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--muted)', cursor: 'pointer', fontSize: 11,
            }}>📋 نسخ</button>
          </div>
          <div style={{
            padding: '14px 16px', borderRadius: 10,
            background: 'rgba(245,166,35,.05)', border: '1px solid rgba(245,166,35,.2)',
            fontSize: 13, lineHeight: 1.9, color: 'var(--text)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {aiResult}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Attachment row ────────────────────────────────────────────────────────────

function AttachmentRow({ attachment }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);

  const download = async () => {
    if (url) { window.open(url, '_blank'); return; }
    setLoading(true);
    try {
      let u;
      if (attachment.storage_path) {
        u = await getFileUrl(attachment.storage_path);
      } else {
        // Not yet downloaded — fetch from Gmail on demand
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          'https://pubtkfwmznfmffavyzsy.supabase.co/functions/v1/gmail-fetch-attachment',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
              'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1YnRrZndtem5mbWZmYXZ5enN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDY4NjYsImV4cCI6MjA5MjYyMjg2Nn0.Ky-Fz9cyleSV8E84O7Zid5kZ_UTSDVaavgS_-yOvauI',
            },
            body: JSON.stringify({ attachment_id: attachment.id }),
          }
        );
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        u = json.url;
      }
      if (!u) throw new Error('لم يتم الحصول على رابط التحميل');
      setUrl(u);
      window.open(u, '_blank');
    } catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
    setLoading(false);
  };

  const icon = attachment.file_type === 'excel' ? '📊' : attachment.file_type === 'pdf' ? '📄' : '📎';
  const color = attachment.file_type === 'excel' ? 'var(--green)' : attachment.file_type === 'pdf' ? 'var(--red)' : 'var(--muted)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderRadius: 9,
      background: 'var(--surface)', border: '1px solid var(--border)',
      marginBottom: 8,
    }}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color }}>{attachment.filename}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          {attachment.file_type.toUpperCase()} · {(attachment.file_size / 1024).toFixed(0)} KB
        </div>
      </div>
      <Btn size="sm" variant="ghost" onClick={download} disabled={loading}>
        {loading ? <Spinner size={12}/> : '⬇ تحميل'}
      </Btn>
    </div>
  );
}
