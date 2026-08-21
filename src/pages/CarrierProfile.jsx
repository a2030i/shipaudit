// CarrierProfile — single-page view of EVERYTHING about one carrier:
// balance, COD outstanding, contract, file shape, recent audits,
// recent webhook events, recent ledger ops. Edit-in-place for the
// file_kind radio so the admin can flip a carrier's accounting mode
// without leaving the page.

import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowRight, RefreshCw, ExternalLink, FileText, Banknote, BookOpen,
  Mail, Inbox, AlertTriangle, CheckCircle2, Truck, Edit3, Save, X,
  Building2, ClipboardList, Link2, WalletCards, ReceiptText, CircleDollarSign,
  UploadCloud, PackageSearch, Scale, CreditCard, BarChart3, ChevronLeft,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, toast, Modal } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  loadCarrierProfileRead, loadCarrierAuditsPage, updateCarrierFileSignature, FILE_KIND_OPTIONS, FILE_KIND_LABELS,
  loadCarrierZohoLinkOptions, saveCarrierZohoFinancialLinks,
} from '../lib/carrierProfileService.js';
import { carrierHasOutstandingLegacyCod } from '../lib/carrierOperatingModel.js';
import { countAuditShipments, loadAuditByIdFromDB, loadAuditShipments } from '../lib/coreService.js';
import { auditPresentation, AUDIT_REVIEW_LABELS } from '../lib/auditPresentation.js';
import './carrier-360.css';

const UploadWizard = lazy(() => import('./UploadWizard.jsx'));
const AuditResults = lazy(() => import('./AuditResults.jsx'));
const Claims = lazy(() => import('./Claims.jsx'));
const CarrierLedger = lazy(() => import('./CarrierLedger.jsx'));
const CarrierStatements = lazy(() => import('./CarrierStatements.jsx'));
const CodSettlements = lazy(() => import('./CodSettlements.jsx'));
const CarrierManager = lazy(() => import('./CarrierManager.jsx'));
const CarrierKpi = lazy(() => import('./CarrierKpi.jsx'));

const CARRIER_VIEWS = [
  ['overview', 'نظرة عامة'],
  ['invoices', 'الفواتير والمراجعة'],
  ['shipments', 'الشحنات'],
  ['claims', 'المطالبات'],
  ['account', 'الحساب والمدفوعات'],
  ['contract', 'العقد والأسعار'],
  ['performance', 'الأداء'],
];
const CARRIER_VIEW_IDS = new Set(CARRIER_VIEWS.map(([id]) => id));

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
function Hero({ carrier, summary, onBack, onUpload, canUpload }) {
  const [logoErr, setLogoErr] = useState(false);   // شعار مكسور → الحرف الأول
  return (
    <div className="carrier360-hero" style={{
      position: 'relative',
      padding: '22px 28px',
      marginBottom: 22,
      borderRadius: 'var(--r-lg)',
      background: 'linear-gradient(135deg, var(--brand-navy), var(--brand-navy-2))',
      color: '#fff',
      overflow: 'hidden',
      boxShadow: '0 16px 40px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.06)',
    }}>
      <div className="carrier360-hero__main" style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
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
        {carrier.logo && !logoErr ? (
          <img src={carrier.logo} alt="" onError={() => setLogoErr(true)} style={{
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
          <div className="carrier360-identity-code" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: 3, textTransform: 'uppercase', opacity: .7, marginBottom: 4 }}>
            ملف شركة الشحن · {carrier.id}
          </div>
          <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 }}>
            {carrier.name}
          </h1>
          <div className="carrier360-hero-meta">
            <span>{carrier.contact_phone || 'الهاتف غير مسجل'}</span>
            <span>{carrier.account_manager || 'لا يوجد مسؤول مسجل'}</span>
            <span>آخر نشاط: {relTime(summary?.lastActivityAt)}</span>
          </div>
        </div>
        <Btn
          variant="primary"
          icon={<UploadCloud size={17}/>}
          onClick={onUpload}
          disabled={!canUpload}
          title={canUpload ? 'رفع فاتورة لهذه الشركة وبدء المراجعة' : 'تحتاج صلاحية إنشاء مراجعة'}
          className="carrier360-upload-cta"
        >
          + رفع فاتورة للمراجعة
        </Btn>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color, icon: Icon, onClick, title }) {
  return (
    <div
      className="stat-card"
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
      '--sc-tone': color || 'var(--accent)',
    }}>
      <div style={{
        fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
        letterSpacing: 2, textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {Icon && <span className="stat-icon-tile"><Icon size={16}/></span>}
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

const ZOHO_ACTIVITY_LABELS = {
  bill: 'فاتورة مورد',
  payment: 'دفعة للمورد',
  credit: 'إشعار دائن',
};

function ZohoLinkModal({ carrierId, financial, onClose, onSaved }) {
  const [options, setOptions] = useState(null);
  const [vendorId, setVendorId] = useState(financial?.vendor?.zoho_id || '');
  const [treasuryId, setTreasuryId] = useState(financial?.treasuries?.[0]?.zoho_id || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    loadCarrierZohoLinkOptions()
      .then(result => { if (active) setOptions(result); })
      .catch(error => { if (active) toast(`تعذّر تحميل حسابات Zoho: ${error.message}`, 'error'); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveCarrierZohoFinancialLinks({
        carrierId,
        zohoVendorId: vendorId,
        treasuryAccountId: treasuryId,
      });
      toast('تم حفظ ربط شركة الشحن مع Zoho', 'success');
      await onSaved();
      onClose();
    } catch (error) {
      const message = String(error.message || error);
      toast(message.includes('treasury_already_linked')
        ? 'هذه الخزينة مرتبطة بشركة شحن أخرى'
        : `تعذّر حفظ الربط: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="ربط الملف المالي مع Zoho" onClose={onClose} width={620}>
      {!options ? <div style={{ display: 'flex', justifyContent: 'center', padding: 34 }}><Spinner size={24}/></div> : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 12, lineHeight: 1.7 }}>
            المورد يحدد الفواتير والمدفوعات والرصيد. خزينة COD تحدد الرصيد الدفتري المحتجز في Zoho. يمكن ترك أحد الرابطين فارغًا حتى يكتمل الإعداد.
          </div>
          <label style={{ display: 'grid', gap: 7, fontSize: 12, color: 'var(--muted)' }}>
            مورد Zoho
            <select value={vendorId} onChange={event => setVendorId(event.target.value)} style={{ minHeight: 44 }}>
              <option value="">غير مربوط</option>
              {options.vendors.map(vendor => (
                <option key={vendor.zoho_id} value={vendor.zoho_id}>
                  {vendor.contact_name} · صافي {fmt((Number(vendor.outstanding_payable) || 0) - (Number(vendor.unused_credits_payable) || 0))} ر.س
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 7, fontSize: 12, color: 'var(--muted)' }}>
            خزينة COD في شجرة الحسابات
            <select value={treasuryId} onChange={event => setTreasuryId(event.target.value)} style={{ minHeight: 44 }}>
              <option value="">غير مربوطة</option>
              {options.treasuries.map(account => (
                <option key={account.zoho_id} value={account.zoho_id}>
                  {account.account_name}{account.account_code ? ` · ${account.account_code}` : ''} · {fmt(account.current_balance)} {account.currency_code || 'ر.س'}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={onClose} disabled={saving}>إلغاء</Btn>
            <Btn variant="primary" icon={<Save size={14}/>} onClick={save} disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : 'حفظ الربط'}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ZohoFinancialSection({ financial, canConfigure, onConfigure }) {
  if (!financial?.available) {
    return (
      <SectionCard title="الملف المالي في Zoho" accent="var(--gold)">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--muted)', fontSize: 12 }}>
          <AlertTriangle size={17} color="var(--gold)"/>
          <span>تعذّرت قراءة بيانات Zoho لهذه الشركة. يلزم امتلاك صلاحيتي عرض الناقلين وعرض Zoho، وأن تكون ترقية قاعدة البيانات مطبقة.</span>
        </div>
      </SectionCard>
    );
  }

  const vendor = financial.vendor;
  const cod = financial.cod || {};
  const bills = financial.bills || {};
  const payments = financial.payments || {};
  const hasAnyLink = Boolean(vendor || financial.treasuries?.length);
  const netPayable = Number(vendor?.net_payable) || 0;
  const gap = Number(cod.treasury_gap) || 0;
  const action = canConfigure
    ? <Btn size="sm" variant="ghost" icon={<Link2 size={13}/>} onClick={onConfigure}>{hasAnyLink ? 'تعديل الربط' : 'ربط Zoho'}</Btn>
    : null;

  if (!hasAnyLink) {
    return (
      <SectionCard title="الملف المالي في Zoho" action={action} accent="var(--gold)">
        <Empty icon="🔗" title="شركة الشحن غير مربوطة ماليًا" sub="اربط مورد Zoho وخزينة COD لعرض الرصيد والفواتير والمبالغ المعلّقة في ملف واحد"/>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={`الملف المالي الموحّد${vendor?.name ? ` · ${vendor.name}` : ''}`} action={action} accent="var(--accent)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 9 }}>
        <StatCard icon={CircleDollarSign} label={netPayable >= 0 ? 'له علينا في Zoho' : 'لنا عنده في Zoho'} value={`${fmt(Math.abs(netPayable))} ر.س`} sub={`إجمالي ${fmt(vendor?.gross_payable)} − أرصدة ${fmt(vendor?.credits)}`} color={Math.abs(netPayable) < .01 ? 'var(--muted)' : netPayable > 0 ? 'var(--red)' : 'var(--accent)'}/>
        <StatCard icon={ReceiptText} label="فواتير مفتوحة" value={`${fmt(bills.open_balance)} ر.س`} sub={`${bills.open_count || 0} فاتورة · ${bills.overdue_count || 0} متأخرة`} color={Number(bills.open_balance) > 0 ? 'var(--gold)' : 'var(--muted)'}/>
        <StatCard icon={Banknote} label="COD معلّق تشغيليًا" value={`${fmt(cod.outstanding)} ر.س`} sub={`${fmt(cod.expected)} متوقع − ${fmt(cod.received)} مستلم`} color={Number(cod.outstanding) > 0 ? 'var(--gold)' : 'var(--muted)'}/>
        <StatCard icon={WalletCards} label="رصيد خزينة Zoho" value={`${fmt(cod.treasury_balance)} ر.س`} sub={`${financial.treasuries?.length || 0} حساب مربوط`} color="var(--accent)"/>
        <StatCard icon={AlertTriangle} label="فرق COD عن الخزينة" value={`${fmt(Math.abs(gap))} ر.س`} sub={Math.abs(gap) <= .5 ? 'متطابق ضمن نصف ريال' : gap > 0 ? 'COD التشغيلي أعلى من الخزينة' : 'الخزينة أعلى من COD التشغيلي'} color={Math.abs(gap) <= .5 ? 'var(--green)' : 'var(--red)'}/>
        <StatCard icon={CircleDollarSign} label="مدفوعات المورد" value={`${fmt(payments.total)} ر.س`} sub={`${payments.count || 0} دفعة · آخرها ${fmtDate(payments.last_date)}`} color="var(--text)"/>
      </div>

      {financial.treasuries?.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {financial.treasuries.map(account => (
            <span key={account.zoho_id} style={{ padding: '6px 9px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, color: 'var(--muted)' }}>
              خزينة: <strong style={{ color: 'var(--text)' }}>{account.name}</strong> · {fmt(account.balance)} {account.currency || 'ر.س'}
            </span>
          ))}
        </div>
      )}

      {financial.recent_activity?.length > 0 && (
        <div style={{ marginTop: 14, overflowX: 'auto' }}>
          <table className="m-compact">
            <thead><tr><th>الحركة</th><th>المرجع</th><th>التاريخ</th><th>القيمة</th><th>المتبقي</th><th>الحالة</th></tr></thead>
            <tbody>
              {financial.recent_activity.slice(0, 10).map(item => (
                <tr key={`${item.kind}-${item.id}`}>
                  <td data-label="الحركة">{ZOHO_ACTIVITY_LABELS[item.kind] || item.kind}</td>
                  <td data-label="المرجع" style={{ fontFamily: 'var(--font-mono)' }}>{item.reference || '—'}</td>
                  <td data-label="التاريخ">{fmtDate(item.activity_date)}</td>
                  <td data-label="القيمة" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmt(item.amount)}</td>
                  <td data-label="المتبقي" style={{ fontFamily: 'var(--font-mono)' }}>{fmt(item.balance)}</td>
                  <td data-label="الحالة">{item.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--muted)' }}>
        المصدر: مرايا Zoho Books + دفتر COD الداخلي · آخر مزامنة للمورد {vendor?.synced_at ? relTime(vendor.synced_at) : 'غير متاحة'}
      </div>
    </SectionCard>
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
      title="معالجة ملفات الفاتورة"
      action={!editing && (
        <Btn size="sm" variant="ghost" icon={<Edit3 size={12}/>} onClick={() => { setEditing(true); setPick(signature?.file_kind || ''); }}>
          إعداد تنسيق القارئ
        </Btn>
      )}
      accent="var(--brand)"
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <Row label="التشغيل الحالي" value={<span style={{ color: 'var(--green)', fontWeight: 800 }}>مراجعة فاتورة فقط — بلا COD جديد</span>}/>
        <Row label="تنسيق القارئ التاريخي" value={
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
        <Row label="بريد الشركة الذي تصلنا منه الملفات" value={
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
                title="تعديل تعريف بريد الشركة"
              >
                تعديل
              </Btn>
            </div>
          )
        }/>
        {signature?.awb_prefix && <Row label="بداية رقم الشحنة (AWB)" value={<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{signature.awb_prefix}</code>}/>}
        {signature?.carrier_vat_id && <Row label="الرقم الضريبي" value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{signature.carrier_vat_id}</span>}/>}
        {signature?.header_row_hint != null && <Row label="رقم صف رؤوس الأعمدة" value={<span style={{ fontFamily: 'var(--font-mono)' }}>{signature.header_row_hint}</span>}/>}
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
        const result = auditPresentation(a);
        const drift = Math.abs(result.variance);
        const driftColor = drift < 0.50 ? 'var(--accent)' : drift < 5 ? 'var(--gold)' : 'var(--red)';
        const [statusLabel, statusColor] = REVIEW_STATUS[result.reviewStatus] || REVIEW_STATUS.pending;
        const stChip = { color: statusColor, label: statusLabel };
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
// Display-only Arabic labels for raw doc_type codes (plain-language pass §1.20)
const OPS_DOC_TYPE_AR = {
  INV: 'فاتورة مراجعة',
  RV:  'فاتورة كشف',
  DR:  'رسوم',
  DG:  'مُرجَع',
  AB:  'تعديل',
};
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
              {o.doc_type}{OPS_DOC_TYPE_AR[o.doc_type] ? ` · ${OPS_DOC_TYPE_AR[o.doc_type]}` : ''}
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

function LazyPanel({ children }) {
  return (
    <Suspense fallback={<div className="carrier360-loading"><Spinner size={24}/><span>جارٍ تحميل القسم…</span></div>}>
      {children}
    </Suspense>
  );
}

const REVIEW_STATUS = AUDIT_REVIEW_LABELS;

function CarrierInvoiceResultSummary({ audit }) {
  const result = auditPresentation(audit);
  const [statusLabel, statusColor] = REVIEW_STATUS[result.reviewStatus] || REVIEW_STATUS.pending;
  const values = [
    ['قيمة الفاتورة', `${fmt(result.totalBilled)} ر.س`],
    ['المتوقع', `${fmt(result.totalExpected)} ر.س`],
    ['الفرق', `${fmt(result.variance)} ر.س`, result.variance > 0 ? 'is-danger' : 'is-good'],
    ['عدد الشحنات', result.shipmentCount.toLocaleString('en-US')],
    ['المخالفات', result.issueCount.toLocaleString('en-US')],
    ['قيمة الاعتراض', `${fmt(result.claimAmount)} ر.س`, result.claimAmount > 0 ? 'is-danger' : ''],
  ];
  return (
    <div className="carrier360-result-summary" aria-label="ملخص مراجعة الفاتورة">
      {values.map(([label, value, tone]) => (
        <div key={label}><small>{label}</small><strong className={tone || ''}>{value}</strong></div>
      ))}
      <div><small>حالة المراجعة</small><span className="carrier360-status" style={{ '--status-color': statusColor }}>{statusLabel}</span></div>
    </div>
  );
}

function CarrierInvoicesView({ carrier, summary, carriers, mode, invoiceId, page, filter, reloadToken, onState, onRefresh }) {
  const [audit, setAudit] = useState(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditPage, setAuditPage] = useState(null);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    if (mode === 'upload' || invoiceId) return undefined;
    let live = true;
    setAuditPage(null);
    setPageError('');
    loadCarrierAuditsPage(carrier.id, { page, pageSize: 20, filter })
      .then(value => { if (live) setAuditPage(value); })
      .catch(error => { if (live) setPageError(error.message || 'تعذر تحميل فواتير الشركة'); });
    return () => { live = false; };
  }, [carrier.id, filter, invoiceId, mode, page, reloadToken]);

  useEffect(() => {
    if (!invoiceId) {
      setAudit(null);
      setAuditError('');
      return;
    }
    let live = true;
    const cached = (() => {
      try {
        const value = JSON.parse(sessionStorage.getItem('lastAudit') || 'null');
        return value?.id === invoiceId ? value : null;
      } catch { return null; }
    })();
    if (cached) {
      setAudit(cached);
      return () => { live = false; };
    }
    setLoadingAudit(true);
    setAuditError('');
    Promise.all([loadAuditByIdFromDB(invoiceId), countAuditShipments(invoiceId)])
      .then(([value, accessibleRowCount]) => {
        if (!live) return;
        if (String(value?.carrierId) !== String(carrier.id)) throw new Error('هذه المراجعة لا تخص شركة الشحن المفتوحة');
        setAudit({
          ...value,
          accessibleRowCount: accessibleRowCount || value?.results?.length || 0,
        });
      })
      .catch(error => { if (live) setAuditError(error.message || 'تعذر تحميل المراجعة'); })
      .finally(() => { if (live) setLoadingAudit(false); });
    return () => { live = false; };
  }, [invoiceId, carrier.id]);

  const startUpload = () => onState({ mode: 'upload', audit: null, invoice: null });
  if (mode === 'upload') {
    return (
      <div className="carrier360-contained-flow">
        <div className="carrier360-flow-bar">
          <button type="button" onClick={() => onState({ mode: null, audit: null, invoice: null })}><ChevronLeft size={15}/> فواتير {carrier.name}</button>
          <strong>رفع فاتورة للمراجعة</strong>
        </div>
        <LazyPanel>
          <UploadWizard
            carriers={carriers}
            initialCarrierId={carrier.id}
            lockCarrier
            embedded
            onComplete={nextAudit => {
              try { sessionStorage.setItem('lastAudit', JSON.stringify(nextAudit)); } catch { /* large drafts can exceed quota */ }
              setAudit(nextAudit);
              onState({ mode: 'result', audit: nextAudit.id, invoice: null });
            }}
          />
        </LazyPanel>
      </div>
    );
  }

  if (invoiceId) {
    return (
      <div className="carrier360-contained-flow">
        <div className="carrier360-flow-bar">
          <button type="button" onClick={() => onState({ mode: null, audit: null, invoice: null })}><ChevronLeft size={15}/> فواتير {carrier.name}</button>
          <strong>نتيجة مراجعة الفاتورة</strong>
        </div>
        {loadingAudit ? <div className="carrier360-loading"><Spinner size={24}/><span>جارٍ تحميل نتيجة المراجعة…</span></div> : null}
        {auditError ? <Card className="carrier360-error"><AlertTriangle size={18}/><span>{auditError}</span></Card> : null}
        {audit ? (
          <LazyPanel>
            <CarrierInvoiceResultSummary audit={audit}/>
            <AuditResults
              audit={audit}
              carriers={carriers}
              embedded
              onNewAudit={startUpload}
              onApproved={onRefresh}
            />
          </LazyPanel>
        ) : null}
      </div>
    );
  }

  const audits = auditPage?.rows || [];
  const totalVariance = Number(summary.totalVariance) || 0;
  const needsReview = Number(summary.auditsNeedAction) || 0;
  return (
    <div className="carrier360-section-stack">
      <div className="carrier360-section-heading">
        <div><span>فواتير شركة الشحن</span><h2>الفواتير والمراجعة</h2><p>كل فاتورة ونتيجتها ومخالفاتها تبقى داخل ملف {carrier.name}.</p></div>
        <Btn variant="primary" icon={<UploadCloud size={15}/>} onClick={startUpload}>+ رفع فاتورة للمراجعة</Btn>
      </div>
      <div className="carrier360-mini-kpis">
        <StatCard label="الفواتير" value={summary.audits || 0} sub="كل الفواتير المسجلة" icon={ReceiptText}/>
        <StatCard label="تحتاج مراجعة" value={needsReview} sub="لم تعتمد أو ترفض بعد" color={needsReview ? 'var(--gold)' : 'var(--green)'} icon={AlertTriangle}/>
        <StatCard label="إجمالي الفروقات" value={`${fmt(totalVariance)} ر.س`} sub="من نفس نتائج التدقيق" color={totalVariance > 0 ? 'var(--red)' : 'var(--green)'} icon={Scale}/>
      </div>
      <div className="carrier360-filter-pills" aria-label="تصفية الفواتير">
        {[["all","الكل"],["needs_action","تحتاج مراجعة"],["approved","معتمدة"],["rejected","مرفوضة"]].map(([id,label]) => (
          <button key={id} type="button" className={filter === id ? 'active' : ''} onClick={() => onState({ filter: id === 'all' ? null : id, page: 1 })}>{label}</button>
        ))}
      </div>
      {pageError ? <Card className="carrier360-error"><AlertTriangle size={18}/><span>المصدر غير متاح: {pageError}</span></Card> : null}
      {!auditPage && !pageError ? <div className="carrier360-loading"><Spinner size={24}/><span>جارٍ تحميل الفواتير…</span></div> : null}
      {auditPage && !(audits || []).length ? (
        <Card><Empty icon="🧾" title="لا توجد فواتير مراجعة" sub="ابدأ من زر رفع فاتورة للمراجعة؛ لن تُحفظ أي نتيجة قبل الاعتماد"/></Card>
      ) : (
        <div className="carrier360-invoice-list">
          {(audits || []).map(item => {
            const result = auditPresentation(item);
            const [statusLabel, statusColor] = REVIEW_STATUS[result.reviewStatus] || REVIEW_STATUS.pending;
            return (
              <button type="button" key={item.id} onClick={() => onState({ mode: 'result', audit: item.id, invoice: null })}>
                <div className="carrier360-invoice-primary">
                  <ReceiptText size={18}/>
                  <span><strong>{item.file_name || `فاتورة ${item.period || ''}`}</strong><small>{item.period || 'الفترة غير متاحة'} · {item.row_count || 0} شحنة</small></span>
                </div>
                <div><small>قيمة الفاتورة</small><strong>{fmt(item.total_billed)} ر.س</strong></div>
                <div><small>المتوقع</small><strong>{fmt(item.total_expected)} ر.س</strong></div>
                <div><small>الفرق</small><strong className={result.variance > 0 ? 'is-danger' : 'is-good'}>{fmt(result.variance)} ر.س</strong></div>
                <div><small>المخالفات</small><strong>{result.issueCount}</strong></div>
                <div><small>قيمة الاعتراض</small><strong>{fmt(result.claimAmount)} ر.س</strong></div>
                <span className="carrier360-status" style={{ '--status-color': statusColor }}>{statusLabel}</span>
              </button>
            );
          })}
        </div>
      )}
      {auditPage && auditPage.totalPages > 1 ? (
        <div className="carrier360-pagination" aria-label="صفحات الفواتير">
          <button type="button" disabled={auditPage.page <= 1} onClick={() => onState({ page: auditPage.page - 1 })}>السابق</button>
          <span>صفحة {auditPage.page} من {auditPage.totalPages} · {auditPage.totalRows} فاتورة</span>
          <button type="button" disabled={auditPage.page >= auditPage.totalPages} onClick={() => onState({ page: auditPage.page + 1 })}>التالي</button>
        </div>
      ) : null}
    </div>
  );
}

function CarrierShipmentsView({ carrier, audits, auditId, page, filter, onState }) {
  const [rows, setRows] = useState(null);
  const [totalRows, setTotalRows] = useState(0);
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [error, setError] = useState('');
  const selectedAuditId = auditId || audits?.[0]?.id || null;
  const pageSize = 100;

  useEffect(() => {
    if (!selectedAuditId) {
      setRows([]);
      setTotalRows(0);
      setSelectedAudit(null);
      return undefined;
    }
    let live = true;
    setRows(null);
    setError('');
    const status = filter === 'issues' ? 'issues' : 'all';
    const from = (page - 1) * pageSize;
    Promise.all([
      loadAuditByIdFromDB(selectedAuditId, { hydrateRows: false }),
      countAuditShipments(selectedAuditId, { status }),
      loadAuditShipments(selectedAuditId, { status, from, limit: pageSize }),
    ])
      .then(([audit, count, shipments]) => {
        if (!live) return;
        if (String(audit?.carrierId) !== String(carrier.id)) {
          throw new Error('هذه المراجعة لا تخص شركة الشحن المفتوحة');
        }
        setSelectedAudit(audit);
        setTotalRows(count);
        setRows(shipments.map(row => ({ ...row, auditId: selectedAuditId, period: audit.period || '' })));
      })
      .catch(loadError => { if (live) setError(loadError.message || 'تعذر تحميل الشحنات'); })
    return () => { live = false; };
  }, [carrier.id, filter, page, selectedAuditId]);

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div className="carrier360-section-stack">
      <div className="carrier360-section-heading"><div><span>مصدر البيانات: ملف المراجعة المحدد</span><h2>شحنات الفاتورة</h2><p>كل سجل قابل للوصول عبر الصفحات، دون قص النتائج أو تحميل التاريخ كاملًا في المتصفح.</p></div></div>
      {(audits || []).length ? (
        <div className="carrier360-filter-pills" aria-label="اختيار مراجعة الفاتورة">
          {(audits || []).map(item => (
            <button
              key={item.id}
              type="button"
              className={selectedAuditId === item.id ? 'active' : ''}
              onClick={() => onState({ audit: item.id, page: 1, filter: null })}
            >
              {item.period || item.file_name || 'مراجعة'}
            </button>
          ))}
        </div>
      ) : null}
      <div className="carrier360-filter-pills">
        {[['all', 'كل الشحنات'], ['issues', 'بها مخالفات']].map(([id, label]) => <button key={id} type="button" className={filter === id ? 'active' : ''} onClick={() => onState({ filter: id === 'all' ? null : id, page: 1 })}>{label}</button>)}
      </div>
      {error ? <Card className="carrier360-error"><AlertTriangle size={18}/><span>المصدر غير متاح: {error}</span></Card> : null}
      {!rows && !error ? <div className="carrier360-loading"><Spinner size={24}/><span>جارٍ تحميل شحنات المراجعات…</span></div> : null}
      {rows && !rows.length ? <Card><Empty icon="📦" title="لا توجد شحنات بهذا الفلتر"/></Card> : null}
      {rows?.length ? <div className="carrier360-shipment-list">{rows.map((row, index) => {
        const invoice = row.invoiced?.total ?? 0;
        const expected = row.expected?.total ?? 0;
        const variance = row.diffs?.total ?? 0;
        return <article key={`${row.auditId}-${row.awb}-${index}`}>
          <header><span><PackageSearch size={17}/><strong>{row.awb || 'AWB غير متاح'}</strong></span><span className={row.status === 'ok' ? 'is-good' : 'is-danger'}>{row.status === 'ok' ? 'مطابقة' : 'تحتاج مراجعة'}</span></header>
          <div className="carrier360-shipment-grid">
            <div><small>الفترة</small><strong>{row.period || '—'}</strong></div>
            <div><small>الوزن المفوتر</small><strong>{row.weight || '—'} كغ</strong></div>
            <div><small>الوزن المرجعي</small><strong>{row.expected?.weight ?? row.referenceWeight ?? 'غير متاح'}</strong></div>
            <div><small>المبلغ المفوتر</small><strong>{fmt(invoice)} ر.س</strong></div>
            <div><small>المتوقع</small><strong>{fmt(expected)} ر.س</strong></div>
            <div><small>الفرق</small><strong className={variance > 0 ? 'is-danger' : 'is-good'}>{fmt(variance)} ر.س</strong></div>
          </div>
          <footer><span>{row.issues?.map(issue => issue.label).filter(Boolean).join(' · ') || 'لا يوجد سبب فرق مسجل'}</span></footer>
        </article>;
      })}</div> : null}
      {rows && totalRows > 0 ? (
        <div className="carrier360-pagination" aria-label="صفحات شحنات الفاتورة">
          <button type="button" disabled={page <= 1} onClick={() => onState({ page: page - 1 })}>السابق</button>
          <span>{selectedAudit?.period || 'الفاتورة'} · صفحة {page} من {totalPages} · {totalRows.toLocaleString('en-US')} شحنة</span>
          <button type="button" disabled={page >= totalPages} onClick={() => onState({ page: page + 1 })}>التالي</button>
        </div>
      ) : null}
    </div>
  );
}

function CarrierAccountView({ carrier, summary, ops, zohoFinancial, canConfigure, onConfigure, carriers, panel, onPanel, showCod }) {
  const panels = [['overview', 'ملخص الحساب'], ['ledger', 'الحركات والمدفوعات'], ...(showCod ? [['cod', 'تصفية COD القديمة']] : []), ['statements', 'الكشوف']];
  return (
    <div className="carrier360-section-stack">
      <div className="carrier360-section-heading"><div><span>الحساب الحالي للشركة</span><h2>الحساب والمدفوعات</h2><p>الرصيد والمدفوعات والكشوف في سياق {carrier.name} نفسه{showCod ? '، مع تصفية الرصيد التاريخي المتبقي' : ''}.</p></div></div>
      <div className="carrier360-subnav">{panels.map(([id, label]) => <button type="button" key={id} className={panel === id ? 'active' : ''} onClick={() => onPanel(id)}>{label}</button>)}</div>
      {panel === 'overview' ? <>
        <div className="carrier360-mini-kpis">
          <StatCard icon={BookOpen} label="الرصيد المفتوح" value={`${fmt(Math.abs(summary.balance))} ر.س`} sub={summary.balance > 0 ? 'لها علينا' : summary.balance < 0 ? 'لنا عليها' : 'متعادل'} color={summary.balance ? 'var(--red)' : 'var(--green)'}/>
          {showCod ? <StatCard icon={Banknote} label="COD تاريخي متبقٍ" value={`${fmt(summary.codOutstanding)} ر.س`} sub={`${summary.codOutCount} متوقعة · ${summary.codInCount} مستلمة`} color="var(--gold)"/> : null}
          <StatCard icon={CreditCard} label="إجمالي الحركات المدينة" value={`${fmt(summary.totalDr)} ر.س`} sub="من دفتر الشركة الحالي"/>
        </div>
        <ZohoFinancialSection financial={zohoFinancial} canConfigure={canConfigure} onConfigure={onConfigure}/>
        <SectionCard title="آخر الحركات" accent="var(--accent)"><OpsList ops={ops}/></SectionCard>
      </> : null}
      {panel === 'ledger' ? <div className="carrier360-embedded"><LazyPanel><CarrierLedger isActive carrierId={carrier.id} embedded/></LazyPanel></div> : null}
      {panel === 'cod' ? <div className="carrier360-embedded"><LazyPanel><CodSettlements isActive carrierId={carrier.id} embedded/></LazyPanel></div> : null}
      {panel === 'statements' ? <div className="carrier360-embedded"><LazyPanel><CarrierStatements carriers={carriers} initialCarrierId={carrier.id} embedded/></LazyPanel></div> : null}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────
export default function CarrierProfile({ carriers = [], setCarriers, onCarriersChange }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const carrierId = searchParams.get('carrier') || searchParams.get('id');
  const navigate = useNavigate();
  const { can } = useAuth();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [showZohoLink, setShowZohoLink] = useState(false);

  const refresh = useCallback(async () => {
    if (!carrierId) return;
    setLoading(true);
    try {
      const result = await loadCarrierProfileRead(carrierId);
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

  const { carrier, summary, audits, webhooks, ops, zohoFinancial } = data;
  const hasLegacyCod = carrierHasOutstandingLegacyCod(summary.codOutstanding);
  const balColor = Math.abs(summary.balance) < 0.01 ? 'var(--muted)' : summary.balance > 0 ? 'var(--red)' : 'var(--accent)';
  const balLabel = Math.abs(summary.balance) < 0.01 ? 'صفر' : summary.balance > 0 ? 'لها علينا' : 'لنا عليها';
  const netColor = Math.abs(summary.netPosition) < 0.01 ? 'var(--muted)' : summary.netPosition > 0 ? 'var(--red)' : 'var(--accent)';
  const requestedView = searchParams.get('view');
  const view = CARRIER_VIEW_IDS.has(requestedView) ? requestedView : 'overview';
  const invoiceMode = searchParams.get('mode');
  const invoiceId = searchParams.get('audit') || searchParams.get('invoice');
  const detailPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const detailFilter = searchParams.get('filter') || 'all';
  const requestedPanel = searchParams.get('panel');
  const accountPanel = ['overview', 'ledger', 'statements', ...(hasLegacyCod ? ['cod'] : [])].includes(requestedPanel) ? requestedPanel : 'overview';
  const returnTo = searchParams.get('returnTo');
  const updateLocation = (patch, { replace = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace });
  };
  const returnToCarrierList = () => {
    if (returnTo) navigate(returnTo);
    else navigate('/hub');
  };

  return (
    <div className="carrier360-root">
      <Hero
        carrier={carrier}
        summary={summary}
        onBack={returnToCarrierList}
        canUpload={can('audits.create')}
        onUpload={() => updateLocation({ view: 'invoices', mode: 'upload', audit: null, invoice: null })}
      />
      {showZohoLink && (
        <ZohoLinkModal
          carrierId={carrierId}
          financial={zohoFinancial}
          onClose={() => setShowZohoLink(false)}
          onSaved={refresh}
        />
      )}

      {view === 'overview' && summary.setupGaps.length > 0 && (
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

      {view === 'overview' ? <>
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
          title="فتح حساب الشركة"
          onClick={() => updateLocation({ view: 'account', panel: 'ledger' })}
        />
        {hasLegacyCod ? <StatCard
          icon={Banknote}
          label="COD تاريخي متبقّي"
          value={`${fmt(summary.codOutstanding)} ر.س`}
          sub={`${summary.codOutCount} متوقّعة − ${summary.codInCount} مستلَمة`}
          color="var(--gold)"
          title="فتح تصفية الرصيد التاريخي"
          onClick={() => updateLocation({ view: 'account', panel: 'cod' })}
        /> : null}
        {hasLegacyCod ? <StatCard
          icon={Building2}
          label="المتبقّي بعد خصم التحصيل"
          value={`${fmt(Math.abs(summary.netPosition))} ر.س`}
          sub={summary.netPosition > 0 ? 'بعد خصم COD: مدينون لها' : summary.netPosition < 0 ? 'بعد خصم COD: مدينة لنا' : 'متعادل'}
          color={netColor}
          title="فتح حساب الشركة لمراجعة الصافي"
          onClick={() => updateLocation({ view: 'account', panel: 'overview' })}
        /> : null}
        <StatCard
          icon={FileText}
          label="المراجعات"
          value={summary.audits}
          sub={`${summary.auditsByStatus.approved} معتمدة · ${summary.auditsByStatus.pending} معلّقة${summary.auditsByStatus.legacy_unverified ? ` · ${summary.auditsByStatus.legacy_unverified} تاريخية غير موثقة` : ''}`}
          title="فتح فواتير ومراجعات هذه الشركة"
          onClick={() => updateLocation({ view: 'invoices' })}
        />
        <StatCard
          icon={Inbox}
          label="ملفات Webhook"
          value={summary.webhooks}
          sub={summary.webhookPending > 0 ? `${summary.webhookPending} بانتظار` : 'كلها معالَجة'}
          color={summary.webhookPending > 0 ? 'var(--gold)' : 'var(--muted)'}
          title="الملفات الواردة تلقائيًا لهذه الشركة"
          onClick={() => updateLocation({ view: 'invoices' })}
        />
        <StatCard
          icon={CheckCircle2}
          label="آخر نشاط"
          value={relTime(summary.lastActivityAt)}
        />
      </div>

      <ZohoFinancialSection
        financial={zohoFinancial}
        canConfigure={can('zoho.configure')}
        onConfigure={() => setShowZohoLink(true)}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <FileShapeSection signature={carrier.file_signature} onSaveKind={handleSaveKind} onSaveEmails={handleSaveEmails}/>
          <ContractSection contracts={carrier.contracts} onEdit={() => updateLocation({ view: 'contract' })}/>
        </div>
        <div>
          <SectionCard
            title="آخر المراجعات"
            action={<Btn size="sm" variant="ghost" icon={<ExternalLink size={12}/>} onClick={() => updateLocation({ view: 'invoices' })}>كل الفواتير</Btn>}
            accent="var(--gold)"
          >
            <AuditsList audits={audits} onOpen={() => updateLocation({ view: 'invoices' })}/>
          </SectionCard>
          <SectionCard
            title="آخر الملفات الواردة تلقائيًا"
            action={<Btn size="sm" variant="ghost" icon={<ExternalLink size={12}/>} onClick={() => updateLocation({ view: 'invoices' })}>كل الملفات</Btn>}
            accent="var(--brand)"
          >
            <WebhookList webhooks={webhooks}/>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="آخر الحركات"
        action={<Btn size="sm" variant="ghost" icon={<ExternalLink size={12}/>} onClick={() => updateLocation({ view: 'account', panel: 'ledger' })}>الحساب الكامل</Btn>}
        accent="var(--accent)"
      >
        <OpsList ops={ops}/>
      </SectionCard>
      </> : null}

      {view === 'invoices' ? (
        <CarrierInvoicesView
          carrier={carrier}
          summary={summary}
          carriers={carriers}
          mode={invoiceMode}
          invoiceId={invoiceId}
          page={detailPage}
          filter={detailFilter}
          reloadToken={data.generatedAt}
          onState={patch => updateLocation({ view: 'invoices', ...patch })}
          onRefresh={refresh}
        />
      ) : null}

      {view === 'shipments' ? (
        <CarrierShipmentsView
          carrier={carrier}
          audits={audits}
          auditId={invoiceId}
          page={detailPage}
          filter={detailFilter}
          onState={patch => updateLocation({ view: 'shipments', ...patch })}
        />
      ) : null}

      {view === 'claims' ? <div className="carrier360-embedded"><LazyPanel><Claims carriers={carriers} carrierId={carrier.id} isActive embedded/></LazyPanel></div> : null}

      {view === 'account' ? (
        <CarrierAccountView
          carrier={carrier}
          summary={summary}
          ops={ops}
          zohoFinancial={zohoFinancial}
          canConfigure={can('zoho.configure')}
          onConfigure={() => setShowZohoLink(true)}
          carriers={carriers}
          panel={accountPanel}
          onPanel={panel => updateLocation({ view: 'account', panel })}
          showCod={hasLegacyCod}
        />
      ) : null}

      {view === 'contract' ? <div className="carrier360-embedded carrier360-manager"><LazyPanel><CarrierManager carriers={carriers} setCarriers={setCarriers} scopedCarrierId={carrier.id} onSaved={async () => { await onCarriersChange?.(); await refresh(); }}/></LazyPanel></div> : null}

      {view === 'performance' ? <div className="carrier360-embedded"><LazyPanel><CarrierKpi isActive carrierId={carrier.id} embedded/></LazyPanel></div> : null}
    </div>
  );
}
