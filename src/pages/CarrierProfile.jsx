// CarrierProfile — single-page view of EVERYTHING about one carrier:
// balance, COD outstanding, contract, file shape, recent audits,
// recent webhook events, recent ledger ops. Edit-in-place for the
// file_kind radio so the admin can flip a carrier's accounting mode
// without leaving the page.

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowRight, RefreshCw, ExternalLink, FileText, Banknote, BookOpen,
  Mail, Inbox, AlertTriangle, CheckCircle2, Truck, Edit3, Save, X,
  Building2, ClipboardList,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, Modal } from '../components/UI.jsx';
import CarrierTabs from '../components/CarrierTabs.jsx';
import {
  loadCarrierProfile, updateCarrierFileSignature, FILE_KIND_OPTIONS, FILE_KIND_LABELS,
} from '../lib/carrierProfileService.js';

const fmt = (n) =>
  (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'م';
  if (a >= 1_000)     return (n / 1_000).toFixed(1) + 'ك';
  return n.toFixed(0);
};

const relTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days < 7)   return `قبل ${days} أيام`;
  if (days < 30)  return `قبل ${Math.floor(days / 7)} أسابيع`;
  if (days < 365) return `قبل ${Math.floor(days / 30)} شهور`;
  return `قبل ${Math.floor(days / 365)} سنوات`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return iso; }
};

// ── Hero ────────────────────────────────────────────────────────
function Hero({ carrier, onBack }) {
  return (
    <div style={{
      position: 'relative',
      padding: '22px 28px',
      marginBottom: 22,
      borderRadius: 'var(--r-lg)',
      background: '#0A0A0B',
      color: '#fff',
      overflow: 'hidden',
      boxShadow: '0 16px 40px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
        <Btn
          variant="ghost"
          size="sm"
          icon={<ArrowRight size={14}/>}
          onClick={onBack}
          title="رجوع لكشف الشركات"
          style={{ flexShrink: 0 }}
        >
          رجوع
        </Btn>
        {carrier.logo ? (
          <img src={carrier.logo} alt="" style={{
            width: 56, height: 56, borderRadius: 12, objectFit: 'cover',
            border: '2px solid rgba(255,255,255,.20)', flexShrink: 0,
          }}/>
        ) : (
          <div style={{
            width: 56, height: 56, borderRadius: 12,
            background: 'rgba(255,255,255,.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 800, color: '#fff',
            flexShrink: 0,
          }}>
            {(carrier.name || '?').slice(0, 1)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: 3, textTransform: 'uppercase', opacity: .7, marginBottom: 4 }}>
            CARRIER PROFILE · {carrier.id}
          </div>
          <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>
            {carrier.name}
          </h1>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color, icon: Icon, onClick, title }) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)', padding: '14px 18px',
      display: 'flex', flexDirection: 'column', gap: 4,
      cursor: onClick ? 'pointer' : 'default',
    }}>
      <div style={{
        fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
        letterSpacing: 2, textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {Icon && <Icon size={11}/>}
        {label}
      </div>
      <div style={{
        fontSize: 20, fontWeight: 800, color: color || 'var(--text)',
        fontFamily: 'var(--font-mono)',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, action, children, accent }) {
  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14, ...(accent ? { borderTop: `2px solid ${accent}` } : {}) }}>
      <div style={{
        padding: '12px 18px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        {action}
      </div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </Card>
  );
}

// ── Contract section ───────────────────────────────────────────
function ContractSection({ contracts, onEdit }) {
  if (!contracts?.length) {
    return (
      <SectionCard title="العقد" accent="#EF4444">
        <Empty
          icon="📋"
          title="لا يوجد عقد ساري"
          sub="بدون عقد، لا يمكن إجراء مراجعات. أضف عقد من إدارة الشركة."
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <Btn size="sm" variant="accent" icon={<Edit3 size={12}/>} onClick={onEdit}>
            إضافة عقد
          </Btn>
        </div>
      </SectionCard>
    );
  }
  return (
    <SectionCard
      title={`العقود (${contracts.length})`}
      action={<Btn size="sm" variant="ghost" icon={<Edit3 size={12}/>} onClick={onEdit}>تعديل</Btn>}
      accent="var(--accent)"
    >
      <div style={{ display: 'grid', gap: 10 }}>
        {contracts.map(c => {
          const dests = Object.keys(c.pricing || {});
          const primary = c.pricing?.['Saudi Arabia'] || c.pricing?.[dests[0]];
          let priceLine = '—';
          if (Array.isArray(primary)) {
            const base = primary[0];
            const next = primary[1];
            if (base?.price != null) {
              priceLine = base.upTo
                ? `حتى ${base.upTo} كغ → ${base.price} ر.س`
                : `${base.price} ر.س ثابتة`;
              if (next?.pricePerUnit) priceLine += ` · +${next.pricePerUnit} ر.س/كغ`;
            }
          }
          return (
            <div key={c.id} style={{
              padding: '10px 12px',
              background: 'var(--surface)',
              borderRadius: 9,
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
                  {c.label || c.id}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  {c.startDate || '—'} → {c.endDate || 'مفتوح'}
                </div>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: 6, fontSize: 11,
              }}>
                <div><span style={{ color: 'var(--muted)' }}>السعر:</span> <strong>{priceLine}</strong></div>
                {c.fuelPct != null && <div><span style={{ color: 'var(--muted)' }}>وقود:</span> {(c.fuelPct * 100).toFixed(1)}%</div>}
                {c.rss > 0 && <div><span style={{ color: 'var(--muted)' }}>RSS:</span> {(c.rss * 100).toFixed(1)}%</div>}
                {c.codFee != null && <div><span style={{ color: 'var(--muted)' }}>رسوم COD:</span> {c.codFee} ر.س</div>}
                {c.posFeePct != null && c.posFeePct > 0 && <div><span style={{ color: 'var(--muted)' }}>رسوم POS:</span> {(c.posFeePct * 100).toFixed(1)}%</div>}
                <div><span style={{ color: 'var(--muted)' }}>الوجهات:</span> {dests.length}</div>
              </div>
              {c.notes && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
                  {c.notes}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ── File shape section ─────────────────────────────────────────
function FileShapeSection({ signature, onSaveKind, onSaveEmails }) {
  const [editing, setEditing] = useState(false);
  const [pick,    setPick]    = useState(signature?.file_kind || '');
  const [saving,  setSaving]  = useState(false);

  // Webhook email-from editor — independent of the file_kind editor
  // above. The two facets serve different purposes (file shape vs
  // sender identity) and the operator usually edits them in
  // different sessions.
  const [editingEmails, setEditingEmails] = useState(false);
  const [emailsDraft,   setEmailsDraft]   = useState('');
  const [savingEmails,  setSavingEmails]  = useState(false);

  const currentKindLabel = signature?.file_kind
    ? FILE_KIND_LABELS[signature.file_kind] || signature.file_kind
    : <span style={{ color: 'var(--red)' }}>غير محدد</span>;

  const handleSave = async () => {
    if (!pick) { toast('اختر نوع الملف', 'warn'); return; }
    setSaving(true);
    try {
      await onSaveKind(pick);
      setEditing(false);
      toast('تم حفظ نوع الملف ✓', 'success');
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setSaving(false);
  };

  // Parse the comma/space/newline-separated input into a clean
  // list of domain tokens. We normalize to always carry a leading
  // "@" so the webhook intake's substring match works consistently
  // regardless of how the operator typed it ("aramex.com" /
  // "@aramex.com" both produce ["@aramex.com"]).
  const parseEmailsInput = (raw) => {
    const tokens = String(raw || '')
      .split(/[\s,;\n]+/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => t.toLowerCase())
      .map(t => t.startsWith('@') ? t : '@' + t.replace(/^.*@/, ''));
    // Dedupe while preserving order
    return [...new Set(tokens)];
  };

  const handleSaveEmails = async () => {
    const parsed = parseEmailsInput(emailsDraft);
    setSavingEmails(true);
    try {
      await onSaveEmails(parsed);
      setEditingEmails(false);
      toast(parsed.length ? `تم حفظ ${parsed.length} نطاق ✓` : 'تم مسح البصمة', 'success');
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setSavingEmails(false);
  };

  return (
    <SectionCard
      title="شكل الملفات"
      action={!editing && (
        <Btn size="sm" variant="ghost" icon={<Edit3 size={12}/>} onClick={() => { setEditing(true); setPick(signature?.file_kind || ''); }}>
          تعديل النوع
        </Btn>
      )}
      accent="#3B82F6"
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <Row label="نوع الملف" value={
          editing ? (
            <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
              {FILE_KIND_OPTIONS.map(opt => (
                <label key={opt.value} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px',
                  background: pick === opt.value ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface)',
                  border: `1px solid ${pick === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8, cursor: 'pointer',
                  fontSize: 12,
                }}>
                  <input
                    type="radio" name="file_kind"
                    checked={pick === opt.value}
                    onChange={() => setPick(opt.value)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span style={{ flex: 1, color: 'var(--text)', fontWeight: pick === opt.value ? 700 : 400 }}>
                    {opt.label}
                  </span>
                </label>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <Btn size="sm" variant="accent" icon={<Save size={12}/>} onClick={handleSave} disabled={saving}>
                  {saving ? 'جارٍ الحفظ…' : 'حفظ'}
                </Btn>
                <Btn size="sm" variant="ghost" icon={<X size={12}/>} onClick={() => setEditing(false)}>
                  إلغاء
                </Btn>
              </div>
            </div>
          ) : (
            <strong style={{ color: 'var(--text)' }}>{currentKindLabel}</strong>
          )
        }/>
        <Row label="بريد المرسِل (Webhook)" value={
          editingEmails ? (
            <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
              <input
                type="text"
                name="webhook_email_from"
                autoComplete="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                placeholder="مثال: aramex.com, smsaexpress.com"
                value={emailsDraft}
                onChange={e => setEmailsDraft(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px',
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--surface)', color: 'var(--text)',
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  direction: 'ltr', textAlign: 'left',
                }}
              />
              <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                أكتب نطاق واحد أو أكثر مفصولة بفاصلة. الـ <code>@</code> يُضاف تلقائياً. مثال: <code>aramex.com</code> يلتقط أي إيميل ينتهي بـ <code>@aramex.com</code> (مثل <code>accounts@aramex.com</code>).
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn size="sm" variant="accent" icon={<Save size={12}/>} onClick={handleSaveEmails} disabled={savingEmails}>
                  {savingEmails ? 'جارٍ الحفظ…' : 'حفظ'}
                </Btn>
                <Btn size="sm" variant="ghost" icon={<X size={12}/>} onClick={() => setEditingEmails(false)}>
                  إلغاء
                </Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(signature?.email_from || []).length
                ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, direction: 'ltr', flex: 1 }}>
                    {(signature.email_from || []).join(' / ')}
                  </span>
                : <span style={{ color: 'var(--muted)', flex: 1 }}>غير محدد</span>
              }
              <Btn
                variant="ghost"
                size="sm"
                icon={<Edit3 size={11}/>}
                onClick={() => {
                  setEmailsDraft((signature?.email_from || []).join(', '));
                  setEditingEmails(true);
                }}
                title="تعديل بصمة الـ webhook"
              >
                تعديل
              </Btn>
            </div>
          )
        }/>
        {signature?.awb_prefix && <Row label="بادئة AWB" value={<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{signature.awb_prefix}</code>}/>}
        {signature?.carrier_vat_id && <Row label="الرقم الضريبي" value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{signature.carrier_vat_id}</span>}/>}
        {signature?.header_row_hint != null && <Row label="صف العنوان المتوقع" value={<span style={{ fontFamily: 'var(--font-mono)' }}>{signature.header_row_hint}</span>}/>}
      </div>
    </SectionCard>
  );
}

function Row({ label, value }) {
  return (
    <div className="profile-detail-row" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', minWidth: 130 }}>{label}</span>
      <div style={{ flex: 1, textAlign: 'left' }}>{value}</div>
    </div>
  );
}

// ── Recent audits list ─────────────────────────────────────────
function AuditsList({ audits, onOpen }) {
  if (!audits?.length) {
    return <Empty icon="📋" title="لم تُجرى أي مراجعة لهذه الشركة بعد"/>;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {audits.slice(0, 8).map(a => {
        const drift = Math.abs(Number(a.drift_pre_tax) || 0);
        const driftColor = drift < 0.50 ? 'var(--accent)' : drift < 5 ? 'var(--gold)' : 'var(--red)';
        const stChip = {
          pending:  { color: 'var(--gold)', label: 'قيد الانتظار' },
          draft:    { color: 'var(--muted)', label: 'مسودة' },
          approved: { color: 'var(--accent)', label: 'معتمدة' },
          rejected: { color: 'var(--red)', label: 'مرفوضة' },
        }[a.review_status] || { color: 'var(--muted)', label: a.review_status || '—' };
        return (
          <div key={a.id} onClick={() => onOpen?.(a)} style={{
            padding: '10px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 9,
            display: 'grid',
            gridTemplateColumns: '1fr auto auto auto auto',
            gap: 12, alignItems: 'center',
            cursor: 'pointer',
            transition: 'border-color .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border2)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.file_name || a.id}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                {a.period || '—'} · {a.row_count || 0} شحنة
              </div>
            </div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>
              {fmt(a.total_billed)} <span style={{ fontSize: 9, color: 'var(--muted)' }}>ر.س</span>
            </div>
            <div title={`drift ${drift.toFixed(2)}`} style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: driftColor, whiteSpace: 'nowrap' }}>
              {drift < 0.01 ? '✓' : `± ${drift.toFixed(2)}`}
            </div>
            <span style={{
              padding: '2px 8px', borderRadius: 11,
              background: stChip.color + '20', color: stChip.color, border: `1px solid ${stChip.color}40`,
              fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {stChip.label}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>
              {relTime(a.created_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Recent webhook events ──────────────────────────────────────
function WebhookList({ webhooks }) {
  if (!webhooks?.length) {
    return <Empty icon="📭" title="ما وصلت ملفات من هذه الشركة بعد"/>;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {webhooks.slice(0, 6).map(w => (
        <div key={w.id} style={{
          padding: '8px 12px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 9,
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 12, alignItems: 'center',
          fontSize: 11.5,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {w.file_name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {w.subject || '—'}
            </div>
          </div>
          <span style={{
            padding: '2px 7px', borderRadius: 10,
            background: w.audit_id ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'rgba(122,130,196,.10)',
            color: w.audit_id ? 'var(--accent)' : 'var(--muted)',
            border: `1px solid ${w.audit_id ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border2)'}`,
            fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
          }}>
            {w.audit_id ? '✓ تمت مراجعتها' : w.status === 'awaiting_assignment' ? '⏳ جديد' : w.status}
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 10.5, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            {relTime(w.received_at)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Recent ops list ────────────────────────────────────────────
function OpsList({ ops }) {
  if (!ops?.length) {
    return <Empty icon="📒" title="لا توجد حركات بعد"/>;
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {ops.slice(0, 10).map(o => {
        const dr = Number(o.amount_dr) || 0;
        const cr = Number(o.amount_cr) || 0;
        const isDr = dr > 0;
        return (
          <div key={o.id} style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr auto auto',
            gap: 10, alignItems: 'center',
            padding: '6px 10px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            fontSize: 11.5,
          }}>
            <span style={{
              padding: '2px 7px', borderRadius: 9, fontSize: 9.5,
              fontFamily: 'var(--font-mono)', fontWeight: 700,
              background: isDr ? 'rgba(239,68,68,.10)' : 'color-mix(in srgb, var(--accent) 10%, transparent)',
              color: isDr ? 'var(--red)' : 'var(--accent)',
              border: `1px solid ${isDr ? 'rgba(239,68,68,.30)' : 'color-mix(in srgb, var(--accent) 30%, transparent)'}`,
              whiteSpace: 'nowrap',
            }}>
              {o.doc_type}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {o.doc_no || o.notes || '—'}
              </div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: isDr ? 'var(--red)' : 'var(--accent)' }}>
              {isDr ? '+' : '−'}{fmt(isDr ? dr : cr)}
            </div>
            <span style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
              {fmtDate(o.doc_date)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────
export default function CarrierProfile() {
  const [searchParams] = useSearchParams();
  const carrierId = searchParams.get('id');
  const navigate = useNavigate();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!carrierId) return;
    setLoading(true);
    try {
      const result = await loadCarrierProfile(carrierId);
      setData(result);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
      setData(null);
    }
    setLoading(false);
  }, [carrierId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSaveKind = async (newKind) => {
    await updateCarrierFileSignature(carrierId, { file_kind: newKind });
    await refresh();
  };
  const handleSaveEmails = async (newEmails) => {
    // Persist `null` when the list is empty so the column reflects
    // "no signature" cleanly instead of carrying an empty array.
    await updateCarrierFileSignature(carrierId, {
      email_from: (newEmails && newEmails.length) ? newEmails : null,
    });
    await refresh();
  };

  if (loading && !data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size={28}/></div>;
  }
  if (!data) {
    return (
      <div style={{ padding: 40 }}>
        <Card>
          <Empty
            icon="❓"
            title="الشركة غير موجودة"
            sub="ربما حُذفت — ارجع لقائمة الشركات"
          />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <Btn variant="accent" onClick={() => navigate('/hub')}>الرجوع لكشف الشركات</Btn>
          </div>
        </Card>
      </div>
    );
  }

  const { carrier, summary, audits, webhooks, ops } = data;
  const balColor = Math.abs(summary.balance) < 0.01 ? 'var(--muted)' : summary.balance > 0 ? 'var(--red)' : 'var(--accent)';
  const balLabel = Math.abs(summary.balance) < 0.01 ? 'صفر' : summary.balance > 0 ? 'لها علينا' : 'لنا عليها';
  const netColor = Math.abs(summary.netPosition) < 0.01 ? 'var(--muted)' : summary.netPosition > 0 ? 'var(--red)' : 'var(--accent)';

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1200 }}>
      <CarrierTabs carrierId={carrierId} carrierName={carrier.name} active="overview"/>
      <Hero carrier={carrier} onBack={() => navigate('/hub')}/>

      {/* Setup warning */}
      {summary.setupGaps.length > 0 && (
        <Card style={{ marginBottom: 14, borderColor: 'rgba(239,68,68,.40)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertTriangle size={18} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13, marginBottom: 4 }}>
                إعداد الشركة غير مكتمل ({summary.setupCompleteness}%)
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                ينقصها: <strong>{summary.setupGaps.join(' / ')}</strong>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Stats grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10, marginBottom: 14,
      }}>
        <StatCard
          icon={BookOpen}
          label={balLabel}
          value={`${fmt(Math.abs(summary.balance))} ر.س`}
          sub={`الرصيد المفتوح بعد المدفوعات الجزئية · فواتير ${fmtCompact(summary.totalDr)}`}
          color={balColor}
          title="فتح دفتر الناقل"
          onClick={() => navigate(`/ledger?carrier=${carrierId}`)}
        />
        <StatCard
          icon={Banknote}
          label="COD متبقّي من الناقل"
          value={`${fmt(summary.codOutstanding)} ر.س`}
          sub={`${summary.codOutCount} متوقّعة − ${summary.codInCount} مستلَمة`}
          color={summary.codOutstanding > 0 ? 'var(--gold)' : 'var(--muted)'}
          title="فتح تحصيل COD لهذا الناقل"
          onClick={() => navigate(`/money?tab=cod&carrier=${carrierId}`)}
        />
        <StatCard
          icon={Building2}
          label="صافي موقف الناقل"
          value={`${fmt(Math.abs(summary.netPosition))} ر.س`}
          sub={summary.netPosition > 0 ? 'بعد خصم COD: مدينون لها' : summary.netPosition < 0 ? 'بعد خصم COD: مدينة لنا' : 'متعادل'}
          color={netColor}
          title="فتح الدفتر لمراجعة الصافي"
          onClick={() => navigate(`/ledger?carrier=${carrierId}`)}
        />
        <StatCard
          icon={FileText}
          label="المراجعات"
          value={summary.audits}
          sub={`${summary.auditsByStatus.approved} معتمدة · ${summary.auditsByStatus.pending} معلّقة`}
          title="فتح مراجعات هذا الناقل"
          onClick={() => navigate(`/audits?carrier=${carrierId}`)}
        />
        <StatCard
          icon={Inbox}
          label="ملفات Webhook"
          value={summary.webhooks}
          sub={summary.webhookPending > 0 ? `${summary.webhookPending} بانتظار` : 'كلها معالَجة'}
          color={summary.webhookPending > 0 ? 'var(--gold)' : 'var(--muted)'}
          title="فتح وارد هذا الناقل"
          onClick={() => navigate(`/webhook?carrier=${carrierId}`)}
        />
        <StatCard
          icon={CheckCircle2}
          label="آخر نشاط"
          value={relTime(summary.lastActivityAt)}
        />
      </div>

      {/* Sections */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <FileShapeSection signature={carrier.file_signature} onSaveKind={handleSaveKind} onSaveEmails={handleSaveEmails}/>
          <ContractSection contracts={carrier.contracts} onEdit={() => navigate(`/carriers?edit=${carrierId}`)}/>
        </div>
        <div>
          <SectionCard
            title="آخر المراجعات"
            action={<Btn size="sm" variant="ghost" icon={<ExternalLink size={12}/>} onClick={() => navigate(`/audits?carrier=${carrierId}`)}>كل المراجعات</Btn>}
            accent="var(--gold)"
          >
            <AuditsList audits={audits} onOpen={() => navigate(`/audits?carrier=${carrierId}`)}/>
          </SectionCard>
          <SectionCard
            title="آخر ملفات الـ Webhook"
            action={<Btn size="sm" variant="ghost" icon={<ExternalLink size={12}/>} onClick={() => navigate(`/webhook?carrier=${carrierId}`)}>صندوق الوارد</Btn>}
            accent="#3B82F6"
          >
            <WebhookList webhooks={webhooks}/>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="آخر حركات الدفتر"
        action={<Btn size="sm" variant="ghost" icon={<ExternalLink size={12}/>} onClick={() => navigate(`/ledger?carrier=${carrierId}`)}>الكشف الكامل</Btn>}
        accent="#8B5CF6"
      >
        <OpsList ops={ops}/>
      </SectionCard>
    </div>
  );
}
