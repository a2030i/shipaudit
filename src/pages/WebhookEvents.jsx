// Webhook events workspace.
//
// Shows every file received via the inbound webhook + lets the admin
// manually classify unknown senders so the next file from the same
// source identifies automatically.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Download, Webhook, Mail, FileText, CheckCircle2,
  AlertCircle, HelpCircle, Copy, ExternalLink, FileSpreadsheet, FileType2,
  FileX2, FileQuestion, Upload as UploadIcon, Trash2, FileCheck2,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, Modal, toast, PageHeader } from '../components/UI.jsx';
import { Inbox } from 'lucide-react';
import {
  loadWebhookEvents, countByStatus, assignEventToCarrier,
  downloadEventFile, loadEventFileBlob, getWebhookEndpoint,
  deleteWebhookEvent, deleteWebhookEvents,
} from '../lib/webhookService.js';
import { loadAuditByIdFromDB } from '../lib/coreService.js';
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
    return new Date(iso).toLocaleString('en-US', {
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

// "accounting@delivernow.net" → "delivernow"
// "billing@aramex.com.sa"     → "aramex"
// Strips the user part + the TLD chain, leaving the second-level domain.
function extractCompanyFromEmail(sender) {
  if (!sender || typeof sender !== 'string') return '';
  const cleaned = sender.trim().replace(/^.*<|>.*$/g, ''); // strip "Name <email>"
  const at = cleaned.lastIndexOf('@');
  if (at < 0) return cleaned;
  const domain = cleaned.slice(at + 1).toLowerCase();
  const parts  = domain.split('.').filter(Boolean);
  if (!parts.length) return domain;
  // For "delivernow.net" → "delivernow"
  // For "aramex.com.sa" → "aramex" (drop trailing TLDs)
  // Heuristic: keep the first label that is >= 3 chars and not a known TLD.
  const TLD = new Set(['com', 'net', 'org', 'sa', 'co', 'io', 'me', 'app', 'gov', 'edu']);
  for (const p of parts) {
    if (p.length >= 3 && !TLD.has(p)) return p;
  }
  return parts[0];
}

// File-type chip: maps the extension to an icon + label + colour.
function fileTypeChip(filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  const M = {
    xlsx: { label: 'XLSX', color: '#2DD4BF', bg: 'rgba(45,212,191,.10)', Icon: FileSpreadsheet },
    xlsm: { label: 'XLSM', color: '#2DD4BF', bg: 'rgba(45,212,191,.10)', Icon: FileSpreadsheet },
    xls:  { label: 'XLS',  color: '#10B981', bg: 'rgba(16,185,129,.10)', Icon: FileSpreadsheet },
    csv:  { label: 'CSV',  color: '#0EA5E9', bg: 'rgba(14,165,233,.10)', Icon: FileSpreadsheet },
    tsv:  { label: 'TSV',  color: '#0EA5E9', bg: 'rgba(14,165,233,.10)', Icon: FileSpreadsheet },
    pdf:  { label: 'PDF',  color: '#EF4444', bg: 'rgba(239,68,68,.10)',  Icon: FileType2 },
    eml:  { label: 'EML',  color: '#8B5CF6', bg: 'rgba(139,92,246,.10)', Icon: Mail },
    msg:  { label: 'MSG',  color: '#8B5CF6', bg: 'rgba(139,92,246,.10)', Icon: Mail },
  };
  return M[ext] || { label: (ext || '?').toUpperCase(), color: 'var(--muted)', bg: 'rgba(122,130,196,.10)', Icon: FileQuestion };
}

const SPREADSHEET_EXTS = ['xlsx', 'xlsm', 'xls', 'csv', 'tsv'];
function isSpreadsheet(filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  return SPREADSHEET_EXTS.includes(ext);
}

// ── Action button helpers ─────────────────────────────────────
// Compact, consistent, single-line action buttons for the events
// table. The primary action gets a full label; secondary actions
// (download, delete) are square icon-only buttons with tooltips.
function primaryBtnStyle(variant = 'accent') {
  const variants = {
    accent: {
      background: 'linear-gradient(135deg, #14B8A6, #2DD4BF)',
      color: '#fff',
      border: '1px solid transparent',
      boxShadow: '0 2px 8px rgba(45,212,191,.30)',
    },
    'accent-soft': {
      background: 'rgba(45,212,191,.12)',
      color: 'var(--accent)',
      border: '1px solid rgba(45,212,191,.40)',
      boxShadow: 'none',
    },
    gold: {
      background: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
      color: '#1f2937',
      border: '1px solid transparent',
      boxShadow: '0 2px 8px rgba(251,191,36,.30)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--muted)',
      border: '1px solid var(--border2)',
      boxShadow: 'none',
    },
  };
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 12px',
    borderRadius: 8,
    fontFamily: 'var(--font-sans)',
    fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
    height: 30,
    whiteSpace: 'nowrap',
    ...(variants[variant] || variants.accent),
  };
}

function IconBtn({ icon, title, onClick, disabled, danger }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 30, height: 30,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent',
        color: danger ? 'var(--red)' : 'var(--muted)',
        border: `1px solid ${danger ? 'rgba(239,68,68,.30)' : 'var(--border2)'}`,
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? .45 : 1,
        transition: 'all .12s',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.borderColor = danger ? 'var(--red)' : 'var(--text)';
        e.currentTarget.style.color       = danger ? 'var(--red)' : 'var(--text)';
        e.currentTarget.style.background  = danger ? 'rgba(239,68,68,.06)' : 'var(--surface)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = danger ? 'rgba(239,68,68,.30)' : 'var(--border2)';
        e.currentTarget.style.color       = danger ? 'var(--red)' : 'var(--muted)';
        e.currentTarget.style.background  = 'transparent';
      }}
    >
      {icon}
    </button>
  );
}

// Convert a Blob to base64 (without the "data:..." prefix).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export default function WebhookEvents({ carriers, isActive = true }) {
  const { profile, can } = useAuth();
  const canDelete = can('webhook.delete');
  const navigate = useNavigate();
  const [events,    setEvents]    = useState([]);
  const [counts,    setCounts]    = useState({});
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('all');
  const [assigning, setAssigning] = useState(null);
  const [chosenCarrier, setChosenCarrier] = useState('');
  const [learnSig,  setLearnSig]  = useState(true);
  const [importingId, setImportingId] = useState(null);
  const [deletingId,  setDeletingId]  = useState(null);
  const [selected,    setSelected]    = useState(new Set());
  const [confirmDel,  setConfirmDel]  = useState(null); // { events:[], label:'' }

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

  // "حفظ كمراجعة" — download the file from storage, stash it in
  // sessionStorage as base64, then navigate to /upload. The Upload
  // Wizard reads the stashed file on mount and treats it as if the
  // user dropped it in manually.
  const importToAudit = async (event) => {
    if (!event?.file_path) {
      toast('الملف غير موجود في المخزن', 'error');
      return;
    }
    if (!isSpreadsheet(event.file_name)) {
      toast('لا يمكن تحويل هذا الملف لمراجعة (يجب أن يكون Excel أو CSV)', 'error');
      return;
    }
    setImportingId(event.id);
    try {
      const blob   = await loadEventFileBlob(event);
      const base64 = await blobToBase64(blob);
      sessionStorage.setItem('webhookImport', JSON.stringify({
        eventId:   event.id,
        filename:  event.file_name,
        carrierId: event.detected_carrier_id || null,
        base64,
      }));
      toast('جارٍ فتح المعالج…', 'success');
      navigate('/upload');
    } catch (err) {
      toast(`فشل الاستيراد: ${err.message}`, 'error');
    } finally {
      setImportingId(null);
    }
  };

  // Send the file to /cod-settlements as an inbound COD remittance.
  // Same pattern as importToAudit: stash file in sessionStorage, the
  // CodSettlements page picks it up on visit and auto-opens its
  // upload modal pre-filled with the carrier + file.
  const importToCod = async (event) => {
    if (!event?.file_path) { toast('الملف غير موجود في المخزن', 'error'); return; }
    if (!isSpreadsheet(event.file_name)) {
      toast('لا يمكن تحويل هذا الملف لتحصيل (يجب أن يكون Excel أو CSV)', 'error');
      return;
    }
    if (!event.detected_carrier_id) {
      toast('لا يمكن استيراده كتحصيل قبل ربط الملف بشركة', 'error');
      return;
    }
    setImportingId(event.id);
    try {
      const blob   = await loadEventFileBlob(event);
      const base64 = await blobToBase64(blob);
      sessionStorage.setItem('webhookCodImport', JSON.stringify({
        eventId:   event.id,
        filename:  event.file_name,
        carrierId: event.detected_carrier_id,
        base64,
      }));
      toast('جارٍ فتح تسويات COD…', 'success');
      navigate('/cod-settlements');
    } catch (err) {
      toast(`فشل الاستيراد: ${err.message}`, 'error');
    } finally {
      setImportingId(null);
    }
  };

  // Open the audit linked to a webhook event (after "حفظ كمراجعة" → اعتماد).
  // Loads the audit, stashes it in sessionStorage so AuditResults can
  // hydrate, then routes to /results.
  const openLinkedAudit = async (auditId) => {
    if (!auditId) return;
    try {
      const audit = await loadAuditByIdFromDB(auditId);
      sessionStorage.setItem('lastAudit', JSON.stringify(audit));
      navigate('/results');
    } catch (err) {
      toast(`فشل فتح المراجعة: ${err.message}`, 'error');
    }
  };

  // Single-row delete (opens confirm modal first).
  const askDelete = (event) => {
    setConfirmDel({ events: [event], label: event.file_name });
  };

  // Bulk delete of all currently-checked rows.
  const askBulkDelete = () => {
    const list = events.filter(e => selected.has(e.id));
    if (!list.length) return;
    setConfirmDel({
      events: list,
      label:  `${list.length} حدث محدّد`,
    });
  };

  const doDelete = async () => {
    if (!confirmDel?.events?.length) return;
    const list = confirmDel.events;
    setDeletingId(list[0].id);
    try {
      await deleteWebhookEvents(list);
      toast(`تم حذف ${list.length} ${list.length === 1 ? 'حدث' : 'أحداث'}`, 'success');
      setSelected(new Set());
      setConfirmDel(null);
      refresh();
    } catch (err) {
      toast(`فشل الحذف: ${err.message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSel = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(e => e.id)));
    }
  };

  const carrierName = (id) => (carriers || []).find(c => c.id === id)?.name || id || '—';
  const endpoint = getWebhookEndpoint();

  const copyEndpoint = () => {
    navigator.clipboard.writeText(endpoint);
    toast('تم نسخ رابط Webhook', 'success');
  };

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1440 }}>
      <PageHeader
        icon={<Inbox size={22}/>}
        title="صندوق الوارد"
        subtitle="الملفات الواصلة عبر Webhook — تُسجَّل تلقائياً وتُربط بالشركة الصحيحة"
        actions={
          <>
            {selected.size > 0 && canDelete && (
              <Btn size="md" variant="danger" icon={<Trash2 size={14}/>} onClick={askBulkDelete}>
                حذف المحدّد ({selected.size})
              </Btn>
            )}
            <Btn size="md" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'spin' : ''}/>} onClick={refresh} disabled={loading}>
              تحديث
            </Btn>
          </>
        }
      />

      {/* ── Endpoint card — modern, light, copy-to-clipboard ────────── */}
      <Card style={{ padding: '20px 24px', marginBottom: 22 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: 'var(--accent-dim)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Webhook size={18}/>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>
              ENDPOINT
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text)', marginTop: 2 }}>
              وجّه أتمتتك (Zapier / n8n / Make / IFTTT) لهذا الرابط
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            flex: '1 1 480px', minWidth: 280,
            padding: '10px 14px',
            background: 'var(--bg2)',
            border: '1px solid var(--border2)',
            borderRadius: 10,
            fontFamily: 'var(--font-mono)', fontSize: 12,
            color: 'var(--text2)',
            direction: 'ltr',
          }}>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 6,
              background: 'var(--accent-dim)', color: 'var(--accent)',
              fontWeight: 700, flexShrink: 0,
            }}>POST</span>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {endpoint}
            </span>
            <Btn size="sm" variant="ghost" onClick={copyEndpoint} icon={<Copy size={12}/>}>
              نسخ
            </Btn>
          </div>
        </div>
      </Card>

      {/* ── STAT FILTERS ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { k: 'all',                  l: 'الكل',          n: events.length,                color: 'var(--text)' },
          { k: 'awaiting_assignment',  l: 'يحتاج ربط',     n: counts.awaiting_assignment ?? 0, color: 'var(--gold)' },
          { k: 'processed',            l: 'تم',            n: counts.processed ?? 0,        color: 'var(--accent)' },
          { k: 'failed',               l: 'فشل',           n: counts.failed ?? 0,           color: 'var(--red)' },
        ].map(t => (
          <button key={t.k} onClick={() => setFilter(t.k)} style={{
            background: filter === t.k ? 'var(--text)' : 'var(--surface)',
            border: `1px solid ${filter === t.k ? 'var(--text)' : 'var(--border2)'}`,
            color: filter === t.k ? '#fff' : 'var(--text2)',
            borderRadius: 999, padding: '9px 16px', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 8,
            transition: 'all .15s',
          }}>
            {t.l}
            <span style={{
              background: filter === t.k ? 'rgba(255,255,255,.18)' : 'var(--bg2)',
              color: filter === t.k ? '#fff' : t.color,
              fontSize: 11, padding: '2px 8px', borderRadius: 999, fontFamily: 'var(--font-mono)',
              fontWeight: 700,
            }}>{t.n}</span>
          </button>
        ))}
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
                  <th style={{ width: 36, paddingInline: 8 }}>
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={toggleSelAll}
                      style={{ cursor: 'pointer', accentColor: '#2DD4BF' }}
                      title="تحديد الكل"
                    />
                  </th>
                  <th style={{ minWidth: 130 }}>التاريخ</th>
                  <th style={{ minWidth: 160 }}>المُرسِل</th>
                  <th style={{ minWidth: 240 }}>الملف</th>
                  <th style={{ minWidth: 90 }}>نوع الملف</th>
                  <th style={{ minWidth: 130 }}>الشركة المعرّفة</th>
                  <th style={{ minWidth: 100 }}>طريقة</th>
                  <th style={{ minWidth: 110 }}>الحالة</th>
                  <th style={{ minWidth: 260 }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const meta = STATUS_META[e.status] || STATUS_META.pending;
                  const cName = carrierName(e.detected_carrier_id);
                  const company = extractCompanyFromEmail(e.sender) || '—';
                  const chip = fileTypeChip(e.file_name);
                  const Icn = chip.Icon;
                  const canImport = isSpreadsheet(e.file_name) && !!e.file_path;
                  const isSel = selected.has(e.id);
                  // Determine if the file should be treated as an audit or
                  // as a COD remittance. We expose BOTH buttons only when
                  // the carrier is tagged audit_and_cod_separate — for
                  // those carriers the admin needs to pick. Combined
                  // (audit_with_cod) carriers always treat the file as an
                  // audit. cod_only carriers always treat as COD.
                  // Once the event has been actioned (processed_at is set
                  // OR audit_id is set), buttons disappear and a badge
                  // takes their place.
                  const carrierObj = (carriers || []).find(c => c.id === e.detected_carrier_id);
                  const carrierKind = carrierObj?.file_signature?.file_kind || null;
                  const isActioned  = !!e.audit_id || !!e.processed_at;
                  const isCodDone   = !!e.processed_at && !e.audit_id;
                  const showAuditBtn = canImport && !isActioned && (carrierKind !== 'cod_only');
                  const showCodBtn   = canImport && !isActioned && !!e.detected_carrier_id
                                       && ['audit_and_cod_separate', 'cod_only'].includes(carrierKind);
                  return (
                    <tr key={e.id} style={isSel ? { background: 'rgba(45,212,191,.06)' } : undefined}>
                      <td style={{ paddingInline: 8 }}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSel(e.id)}
                          style={{ cursor: 'pointer', accentColor: '#2DD4BF' }}
                        />
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {fmtDate(e.received_at)}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Mail size={11} color="var(--muted)"/>
                          <span title={e.sender || ''} style={{
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            maxWidth: 160, fontWeight: 700, textTransform: 'capitalize',
                            color: 'var(--text)',
                          }}>
                            {company}
                          </span>
                        </div>
                        {e.subject && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
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
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '3px 9px', borderRadius: 12,
                          background: chip.bg, color: chip.color,
                          border: `1px solid ${chip.color}40`,
                          fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}>
                          <Icn size={11}/>
                          {chip.label}
                        </span>
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
                        {e.audit_id ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 9px', borderRadius: 12,
                            background: 'rgba(45,212,191,.14)',
                            color: 'var(--accent)',
                            border: '1px solid rgba(45,212,191,.40)',
                            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap',
                          }}>
                            <FileCheck2 size={11}/>
                            تمت مراجعتها
                          </span>
                        ) : isCodDone ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 9px', borderRadius: 12,
                            background: 'rgba(251,191,36,.14)',
                            color: '#F59E0B',
                            border: '1px solid rgba(251,191,36,.40)',
                            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap',
                          }}>
                            <FileCheck2 size={11}/>
                            تحصيل مُستلَم
                          </span>
                        ) : (
                          <span style={{
                            padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            background: meta.bg, color: meta.color, fontFamily: 'var(--font-mono)',
                            border: `1px solid ${meta.color}40`,
                            whiteSpace: 'nowrap',
                          }}>
                            {meta.label}
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          flexWrap: 'nowrap',
                        }}>
                          {/* Primary actions — picked by row state.
                              Audit + COD buttons can co-exist for
                              audit_and_cod_separate carriers (J&T-style)
                              so the admin chooses how to route the file. */}
                          {e.audit_id ? (
                            <button
                              onClick={() => openLinkedAudit(e.audit_id)}
                              title="فتح المراجعة المرتبطة"
                              style={primaryBtnStyle('accent-soft')}
                            >
                              <FileCheck2 size={13}/>
                              فتح المراجعة
                            </button>
                          ) : isCodDone ? (
                            <button
                              onClick={() => navigate('/cod-settlements')}
                              title="فتح صفحة تسويات COD"
                              style={primaryBtnStyle('accent-soft')}
                            >
                              <FileCheck2 size={13}/>
                              تم استيراده كتحصيل
                            </button>
                          ) : !e.detected_carrier_id && canImport ? (
                            <button
                              onClick={() => { setAssigning(e); setChosenCarrier(''); setLearnSig(true); }}
                              style={primaryBtnStyle('ghost')}
                            >
                              <HelpCircle size={13}/>
                              ربط بشركة
                            </button>
                          ) : (
                            <>
                              {showAuditBtn && (
                                <button
                                  onClick={() => importToAudit(e)}
                                  disabled={importingId === e.id}
                                  style={primaryBtnStyle('accent')}
                                  title="معالجة الملف كفاتورة مراجعة"
                                >
                                  {importingId === e.id
                                    ? <Spinner size={13}/>
                                    : <UploadIcon size={13}/>}
                                  حفظ كمراجعة
                                </button>
                              )}
                              {showCodBtn && (
                                <button
                                  onClick={() => importToCod(e)}
                                  disabled={importingId === e.id}
                                  style={primaryBtnStyle('gold')}
                                  title="معالجة الملف كتحصيل COD"
                                >
                                  {importingId === e.id
                                    ? <Spinner size={13}/>
                                    : <UploadIcon size={13}/>}
                                  حفظ كتحصيل
                                </button>
                              )}
                            </>
                          )}

                          {/* Secondary actions — icon-only squares */}
                          {e.file_path && (
                            <IconBtn
                              icon={<Download size={13}/>}
                              title="تنزيل الملف"
                              onClick={() => downloadEventFile(e).catch(err => toast(err.message,'error'))}
                            />
                          )}
                          {canDelete && (
                            <IconBtn
                              icon={deletingId === e.id ? <Spinner size={13}/> : <Trash2 size={13}/>}
                              title="حذف الحدث"
                              danger
                              onClick={() => askDelete(e)}
                              disabled={deletingId === e.id}
                            />
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

      {/* ── Delete confirmation modal ────────────────────────────────── */}
      {confirmDel && (
        <Modal title="تأكيد الحذف" onClose={() => setConfirmDel(null)}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 11,
            padding: '12px 14px', marginBottom: 16,
            background: 'rgba(248,113,113,.08)',
            border: '1px solid rgba(248,113,113,.32)',
            borderRadius: 9,
          }}>
            <AlertCircle size={18} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }}/>
            <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                هل تريد حذف {confirmDel.events.length === 1 ? 'هذا الحدث' : `${confirmDel.events.length} أحداث`}؟
              </div>
              <div style={{ color: 'var(--muted)' }}>
                سيُحذف صف الـ webhook + الملف المرتبط في المخزن نهائياً. لا يمكن التراجع.
              </div>
              {confirmDel.events.length === 1 && (
                <div style={{
                  marginTop: 8, padding: '6px 10px',
                  background: 'var(--surface)',
                  borderRadius: 6,
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--text)',
                }}>
                  {confirmDel.label}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setConfirmDel(null)}>تراجع</Btn>
            <Btn variant="danger" onClick={doDelete} disabled={!!deletingId} icon={<Trash2 size={13}/>}>
              {deletingId ? 'جارٍ الحذف...' : 'حذف نهائي'}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
