// Customer-facing payment-request portal.
//
// Path: /portal (no auth, no sidebar — standalone full-screen page).
// Four steps:
//   1. Phone entry
//   2. Stores list (every merchant on that phone, with total due)
//   3. Invoice selection for one store
//   4. Confirmation + submit → request lands in /payment-requests
//      where an admin/accountant picks it up.

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Phone, ArrowLeft, CheckCircle2, Building2, Receipt, Send,
  ShoppingBag, Loader, CreditCard, ShieldCheck,
} from 'lucide-react';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import { Spinner, toast, ToastContainer } from '../components/UI.jsx';
import {
  portalLookup, submitPaymentRequest, attachMoyasarPayment,
  uploadReceipt, getPaymentConfig,
} from '../lib/paymentRequestsService.js';
import { DropZone } from '../components/UI.jsx';

// Bank transfer destination — shown to customers who pick "حوالة بنكية".
const BANK_INFO = {
  bank:        'مصرف الإنماء',
  iban:        'SA0605000068204891807000',
  beneficiary: 'شركة فور تيك لتقنية المعلومات',
};

// Build-time env-var fallback so existing Vercel deployments that
// already set this var keep working without DB config.
const ENV_MOYASAR_PK = import.meta.env.VITE_MOYASAR_PUBLISHABLE_KEY || '';

// Moyasar publishable key — safe to expose, only allows initiating
// payments (no balance / refund / customer data access).
// Loaded at runtime from app_settings (so the admin can change it
// from the Settings UI without a redeploy). Falls back to the
// build-time env var VITE_MOYASAR_PUBLISHABLE_KEY for compatibility.

// Load the Moyasar SDK on demand — keeps the bundle small and the
// portal usable even when Moyasar is unconfigured.
let moyasarLoadPromise = null;
function loadMoyasarSDK() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Moyasar) return Promise.resolve(true);
  if (moyasarLoadPromise) return moyasarLoadPromise;
  moyasarLoadPromise = new Promise((resolve) => {
    // CSS
    if (!document.querySelector('link[data-moyasar]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.moyasar.com/mpf/1.15.0/moyasar.css';
      link.setAttribute('data-moyasar', '1');
      document.head.appendChild(link);
    }
    // JS
    if (document.querySelector('script[data-moyasar]')) {
      // Already loading — wait for window.Moyasar
      const tick = () => window.Moyasar ? resolve(true) : setTimeout(tick, 50);
      tick(); return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.moyasar.com/mpf/1.15.0/moyasar.js';
    s.setAttribute('data-moyasar', '1');
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
  return moyasarLoadPromise;
}

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  } catch { return iso; }
};

export default function CustomerPortal() {
  // Runtime-fetched Moyasar publishable key, with env-var fallback.
  // Loaded on first mount; the UI uses moyasarPK below to decide
  // whether to show the online-pay button.
  const [moyasarPK, setMoyasarPK] = useState(ENV_MOYASAR_PK);
  useEffect(() => {
    getPaymentConfig().then(cfg => {
      if (cfg.moyasarPublishableKey) setMoyasarPK(cfg.moyasarPublishableKey);
    }).catch(() => {});
  }, []);

  const [step, setStep] = useState('phone');     // phone | stores | invoices | pay | done
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState(null);    // { phone, stores: [...] }
  const [loading, setLoading] = useState(false);
  const [selectedStore, setSelectedStore] = useState(null);
  const [payMode, setPayMode] = useState('full');         // 'full' | 'partial'
  const [partialAmount, setPartialAmount] = useState(''); // user-entered for partial
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [bankModalOpen, setBankModalOpen] = useState(false);

  // ── Step 1: phone lookup ────────────────────────────────────
  const handleLookup = async () => {
    if (!phone.trim()) return toast('اكتب رقم الجوال', 'warn');
    setLoading(true);
    try {
      const result = await portalLookup(phone.trim());
      // Filter out stores with no outstanding debt — the portal is for
      // sadad, so a zero-balance store is just noise.
      const storesWithDebt = (result?.stores || []).filter(
        s => (Number(s.total_due) || 0) > 0.5
      );
      const cleaned = { ...(result || {}), stores: storesWithDebt };
      setLookup(cleaned);
      if (!storesWithDebt.length) {
        toast(
          result?.stores?.length
            ? 'كل متاجرك مسدّدة — لا توجد فواتير معلّقة'
            : 'لم نجد متاجر مرتبطة بهذا الرقم',
          'success',
        );
        setLoading(false);
        return;
      }
      setStep('stores');
    } catch (e) {
      toast(`خطأ: ${e.message}`, 'error');
    }
    setLoading(false);
  };

  // ── Step 2 → 3: pick a store ────────────────────────────────
  const openStore = (store) => {
    setSelectedStore(store);
    setPayMode('full');
    setPartialAmount('');
    setStep('invoices');
  };

  // The headline amount the customer ends up sending — full balance
  // or a partial figure they typed in.
  const paymentAmount = useMemo(() => {
    if (!selectedStore) return 0;
    if (payMode === 'full') return Number(selectedStore.total_due) || 0;
    const v = parseFloat(partialAmount);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }, [selectedStore, payMode, partialAmount]);

  // Common snapshot helper — we always include the FULL invoice list
  // as a snapshot on the request so the admin sees what existed at
  // payment time (even when the customer chose "partial" or "all").
  const buildRefs = () => (selectedStore?.invoices || []).map(i => ({
    id: i.id, date: i.date, amount: Number(i.amount) || 0,
  }));

  const validateAmount = () => {
    if (!paymentAmount || paymentAmount <= 0) {
      toast(payMode === 'partial' ? 'اكتب المبلغ المراد سداده' : 'لا يوجد مبلغ للسداد', 'warn');
      return false;
    }
    return true;
  };

  // Online flow → create the request + route to Moyasar.
  const handleOnlinePayment = async () => {
    if (!validateAmount()) return;
    setSubmitting(true);
    try {
      const res = await submitPaymentRequest({
        phone:         lookup.phone,
        customerName:  selectedStore.customer_name || null,
        storeId:       selectedStore.store_id,
        storeName:     selectedStore.store_name,
        amountTotal:   paymentAmount,
        invoiceCount:  (selectedStore.invoices || []).length,
        invoiceRefs:   buildRefs(),
        notes,
        paymentType:   'online',
        isPartial:     payMode === 'partial',
      });
      setSubmitResult(res);
      setStep(moyasarPK ? 'pay' : 'done');
    } catch (e) {
      toast(`فشل الإرسال: ${e.message}`, 'error');
    }
    setSubmitting(false);
  };

  // Bank transfer flow → open the modal which handles the rest.
  const handleBankTransfer = () => {
    if (!validateAmount()) return;
    setBankModalOpen(true);
  };

  // Submit after the customer uploads a receipt in the bank modal.
  const handleBankSubmit = async (receiptFile) => {
    setSubmitting(true);
    try {
      let receiptPath = null;
      if (receiptFile) {
        const upload = await uploadReceipt(receiptFile);
        receiptPath = upload.path;
      }
      const res = await submitPaymentRequest({
        phone:         lookup.phone,
        customerName:  selectedStore.customer_name || null,
        storeId:       selectedStore.store_id,
        storeName:     selectedStore.store_name,
        amountTotal:   paymentAmount,
        invoiceCount:  (selectedStore.invoices || []).length,
        invoiceRefs:   buildRefs(),
        notes,
        paymentType:   'bank_transfer',
        receiptPath,
        isPartial:     payMode === 'partial',
      });
      setSubmitResult(res);
      setBankModalOpen(false);
      setStep('done');
    } catch (e) {
      toast(`فشل الإرسال: ${e.message}`, 'error');
    }
    setSubmitting(false);
  };

  const restart = () => {
    setStep('phone');
    setPhone('');
    setLookup(null);
    setSelectedStore(null);
    setSelectedInvoices(new Set());
    setNotes('');
    setSubmitResult(null);
  };

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      background: 'linear-gradient(180deg, #FAFAFA 0%, #F4F4F5 100%)',
      direction: 'rtl', fontFamily: 'var(--font-sans)',
      overflowY: 'auto',
    }}>
      {/* Brand header */}
      <div style={{
        background: '#0A0A0B', color: '#fff',
        padding: '20px 24px',
        boxShadow: '0 4px 12px rgba(0,0,0,.08)',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <LamhaLogo height={24} color="#fff" accent="#10B981"/>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>
            CUSTOMER PORTAL
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 80px' }}>
        {/* Progress dots */}
        {(() => {
          const stages = moyasarPK
            ? ['phone', 'stores', 'invoices', 'pay', 'done']
            : ['phone', 'stores', 'invoices', 'done'];
          const idx = stages.indexOf(step);
          return (
            <div style={{ display: 'flex', gap: 8, marginBottom: 28, justifyContent: 'center' }}>
              {stages.map((s, i) => (
                <div key={s} style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: i <= idx ? '#10B981' : '#E4E4E7',
                  transition: 'background .2s',
                }}/>
              ))}
            </div>
          );
        })()}

        {/* ── STEP 1: phone ──────────────────────────────────── */}
        {step === 'phone' && (
          <div style={{
            background: '#fff', borderRadius: 24, padding: '40px 32px',
            boxShadow: '0 4px 16px rgba(24,24,27,.06), 0 2px 4px rgba(24,24,27,.04)',
            textAlign: 'center',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto 18px',
              background: 'rgba(16,185,129,.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#10B981',
            }}><Phone size={26}/></div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#18181B', margin: 0, letterSpacing: -0.5 }}>
              بوابة سداد فواتير الشحن
            </h1>
            <p style={{ fontSize: 14, color: '#71717A', marginTop: 8, marginBottom: 24 }}>
              اكتب رقم جوالك لتشاهد متاجرك وفواتيرك المعلّقة
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                placeholder="05XXXXXXXX"
                autoComplete="off"
                data-lpignore="true"
                style={{
                  flex: 1, padding: '14px 18px', borderRadius: 12,
                  fontSize: 16, fontFamily: 'var(--font-mono)',
                  direction: 'ltr', textAlign: 'center',
                  border: '1px solid #E4E4E7',
                }}
              />
              <button
                onClick={handleLookup}
                disabled={loading}
                style={{
                  padding: '14px 22px', borderRadius: 12,
                  background: '#10B981', color: '#fff', border: 'none',
                  fontSize: 14.5, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  boxShadow: '0 1px 2px rgba(16,185,129,.22)',
                }}
              >
                {loading ? <Loader size={16} className="spin"/> : 'بحث'}
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: '#A1A1AA', marginTop: 20, lineHeight: 1.7 }}>
              مدعوم: 05XXXXXXXX · 9665XXXXXXXX · 009665XXXXXXXX
            </p>
          </div>
        )}

        {/* ── STEP 2: stores ─────────────────────────────────── */}
        {step === 'stores' && lookup && (
          <div>
            <button onClick={restart} style={{
              background: 'transparent', border: 'none', color: '#71717A',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: 500, marginBottom: 14, fontFamily: 'inherit',
            }}>
              <ArrowLeft size={14}/> رجوع
            </button>
            <h2 style={{ fontSize: 19, fontWeight: 700, color: '#18181B', marginBottom: 4, letterSpacing: -0.3 }}>
              متاجرك ({lookup.stores.length})
            </h2>
            <p style={{ fontSize: 13, color: '#71717A', marginBottom: 18 }}>
              اختر متجراً لعرض فواتيره المعلّقة
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lookup.stores.map(s => {
                const due = Number(s.total_due) || 0;
                const invCount = (s.invoices || []).length;
                return (
                  <div key={s.store_id} onClick={() => openStore(s)} style={{
                    background: '#fff', borderRadius: 16, padding: '18px 20px',
                    boxShadow: '0 1px 3px rgba(24,24,27,.04), 0 1px 2px rgba(24,24,27,.04)',
                    cursor: 'pointer',
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto auto',
                    gap: 14, alignItems: 'center',
                    transition: 'transform .15s, box-shadow .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(24,24,27,.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(24,24,27,.04), 0 1px 2px rgba(24,24,27,.04)'; }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 12,
                      background: 'rgba(16,185,129,.10)', color: '#10B981',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}><ShoppingBag size={20}/></div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#18181B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.store_name}
                      </div>
                      <div style={{ fontSize: 12, color: '#71717A', marginTop: 2 }}>
                        {s.billing_type ? `${s.billing_type} · ` : ''}{invCount} فاتورة معلّقة
                      </div>
                    </div>
                    <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: due > 0 ? '#EF4444' : '#71717A', fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
                        {fmt(due)} <span style={{ fontSize: 11, color: '#A1A1AA', fontWeight: 500 }}>ر.س</span>
                      </div>
                    </div>
                    <ArrowLeft size={16} color="#A1A1AA"/>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP 3: invoices ───────────────────────────────── */}
        {step === 'invoices' && selectedStore && (
          <div>
            <button onClick={() => { setStep('stores'); setSelectedStore(null); }} style={{
              background: 'transparent', border: 'none', color: '#71717A',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: 500, marginBottom: 14, fontFamily: 'inherit',
            }}>
              <ArrowLeft size={14}/> اختر متجراً آخر
            </button>

            {/* Store summary */}
            <div style={{ background: '#fff', borderRadius: 16, padding: '20px 22px', boxShadow: '0 1px 3px rgba(24,24,27,.04)', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(16,185,129,.10)', color: '#10B981',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><Building2 size={20}/></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#18181B' }}>{selectedStore.store_name}</div>
                  <div style={{ fontSize: 12, color: '#71717A', marginTop: 2 }}>
                    {(selectedStore.invoices || []).length} فاتورة · إجمالي معلّق <strong style={{ color: '#EF4444', fontFamily: 'var(--font-mono)' }}>{fmt(selectedStore.total_due)}</strong> ر.س
                  </div>
                </div>
              </div>
            </div>

            {/* Read-only invoice list */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 0, boxShadow: '0 1px 3px rgba(24,24,27,.04)', overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #F4F4F5' }}>
                <h3 style={{ fontSize: 14.5, fontWeight: 700, color: '#18181B', margin: 0 }}>الفواتير المعلّقة</h3>
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {(selectedStore.invoices || []).length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: '#71717A', fontSize: 13 }}>
                    لا توجد فواتير معلّقة على هذا المتجر — كل شيء مسدّد
                  </div>
                ) : (selectedStore.invoices || []).map((inv, i, arr) => (
                  <div
                    key={inv.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr auto', gap: 14,
                      padding: '12px 18px', alignItems: 'center',
                      borderBottom: i === arr.length - 1 ? 'none' : '1px solid #F4F4F5',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#18181B', fontFamily: 'var(--font-mono)' }}>
                        {fmtDate(inv.date)}
                      </div>
                      <div style={{ fontSize: 11, color: '#71717A', marginTop: 1 }}>
                        فاتورة #{String(inv.id).slice(0, 8)}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#18181B', fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
                      {fmt(inv.amount)} <span style={{ fontSize: 10, color: '#A1A1AA', fontWeight: 500 }}>ر.س</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Amount mode selector */}
            <div style={{ background: '#fff', borderRadius: 16, padding: '16px 18px', boxShadow: '0 1px 3px rgba(24,24,27,.04)', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#18181B', marginBottom: 12 }}>
                المبلغ المراد سداده
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  onClick={() => setPayMode('full')}
                  style={{
                    padding: '14px 14px', borderRadius: 12, textAlign: 'center',
                    border: `2px solid ${payMode === 'full' ? '#10B981' : '#E4E4E7'}`,
                    background: payMode === 'full' ? 'rgba(16,185,129,.06)' : '#fff',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#71717A', fontWeight: 600, marginBottom: 4 }}>
                    سداد الكل
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: payMode === 'full' ? '#10B981' : '#18181B', fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
                    {fmt(selectedStore.total_due)} <span style={{ fontSize: 11, color: '#A1A1AA' }}>ر.س</span>
                  </div>
                </button>
                <button
                  onClick={() => setPayMode('partial')}
                  style={{
                    padding: '12px 14px', borderRadius: 12, textAlign: 'center',
                    border: `2px solid ${payMode === 'partial' ? '#10B981' : '#E4E4E7'}`,
                    background: payMode === 'partial' ? 'rgba(16,185,129,.06)' : '#fff',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#71717A', fontWeight: 600, marginBottom: 6 }}>
                    سداد جزئي
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={partialAmount}
                    onChange={e => { setPayMode('partial'); setPartialAmount(e.target.value); }}
                    onClick={e => e.stopPropagation()}
                    placeholder="مثلاً 200"
                    style={{
                      width: '100%', padding: '6px 10px', borderRadius: 8, textAlign: 'center',
                      fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)',
                      border: '1px solid #E4E4E7', direction: 'ltr',
                    }}
                  />
                </button>
              </div>

              {/* Optional note */}
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="ملاحظة (اختياري) — مثلاً: سأحوّل اليوم بنكي"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 10,
                  fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
                  marginTop: 12, border: '1px solid #E4E4E7',
                }}
              />
            </div>

            {/* Payment method buttons — online button is shown only
                when Moyasar is configured. Otherwise bank transfer
                takes the full row so the customer doesn't see an
                "online" option that silently falls back to "we'll
                contact you" (current bug the operator caught). */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: moyasarPK ? '1fr 1fr' : '1fr',
              gap: 10,
            }}>
              {moyasarPK && (
                <button
                  onClick={handleOnlinePayment}
                  disabled={submitting || paymentAmount <= 0}
                  style={{
                    padding: '16px', borderRadius: 14,
                    background: '#10B981', color: '#fff', border: 'none',
                    fontSize: 14.5, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer',
                    fontFamily: 'inherit', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 4,
                    opacity: paymentAmount <= 0 ? 0.4 : 1,
                    boxShadow: '0 4px 14px rgba(16,185,129,.22)',
                  }}
                >
                  <CreditCard size={20}/>
                  <span>دفع أون لاين</span>
                  <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.85 }}>mada · Visa · Apple Pay</span>
                </button>
              )}
              <button
                onClick={handleBankTransfer}
                disabled={submitting || paymentAmount <= 0}
                style={{
                  padding: '16px', borderRadius: 14,
                  background: '#0A0A0B', color: '#fff', border: 'none',
                  fontSize: 14.5, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 4,
                  opacity: paymentAmount <= 0 ? 0.4 : 1,
                  boxShadow: '0 4px 14px rgba(0,0,0,.18)',
                }}
              >
                <ShoppingBag size={20}/>
                <span>حوالة بنكية</span>
                <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.75 }}>
                  {moyasarPK ? 'تحويل بنكي يدوي' : 'الطريقة الوحيدة المتاحة حالياً'}
                </span>
              </button>
            </div>

            {paymentAmount <= 0 && payMode === 'partial' && (
              <div style={{ textAlign: 'center', fontSize: 12, color: '#71717A', marginTop: 10 }}>
                اكتب المبلغ المراد سداده في خانة "سداد جزئي"
              </div>
            )}
          </div>
        )}

        {/* ── STEP 4: pay (Moyasar) ──────────────────────────── */}
        {step === 'pay' && submitResult && (
          <MoyasarStep
            request={submitResult}
            publishableKey={moyasarPK}
            onPaid={(paymentId, method) => {
              attachMoyasarPayment(submitResult.id, paymentId, method)
                .catch(() => { /* silent — admin still gets the request */ });
              setStep('done');
            }}
            onSkip={() => setStep('done')}
          />
        )}

        {/* ── STEP 5: done ───────────────────────────────────── */}
        {step === 'done' && submitResult && (
          <div style={{
            background: '#fff', borderRadius: 24, padding: '48px 32px',
            boxShadow: '0 4px 16px rgba(24,24,27,.06)',
            textAlign: 'center',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: 24, margin: '0 auto 22px',
              background: 'rgba(16,185,129,.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#10B981',
            }}><CheckCircle2 size={36}/></div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#18181B', margin: 0, letterSpacing: -0.4 }}>
              تم استلام طلبك بنجاح
            </h1>
            <p style={{ fontSize: 14, color: '#71717A', marginTop: 10, lineHeight: 1.7 }}>
              راح يتواصل معك المحاسب قريباً لتأكيد السداد.<br/>
              رقم الطلب: <strong style={{ fontFamily: 'var(--font-mono)', color: '#18181B' }}>{String(submitResult.id).slice(0, 8)}</strong>
            </p>
            <div style={{ background: '#FAFAFA', borderRadius: 12, padding: '16px 20px', margin: '24px auto 24px', maxWidth: 360 }}>
              <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 600, fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                ملخّص الطلب
              </div>
              <div style={{ fontSize: 13, color: '#3F3F46' }}>
                {submitResult.store_name}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#10B981', fontFamily: 'var(--font-mono)', marginTop: 4, letterSpacing: -0.4 }}>
                {fmt(submitResult.amount_total)} <span style={{ fontSize: 13, color: '#71717A', fontWeight: 500 }}>ر.س</span>
              </div>
              <div style={{ fontSize: 12, color: '#71717A', marginTop: 2 }}>
                {submitResult.invoice_count} فاتورة
              </div>
            </div>
            <button onClick={restart} style={{
              padding: '12px 22px', borderRadius: 999,
              background: 'transparent', border: '1px solid #E4E4E7', color: '#3F3F46',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              طلب آخر
            </button>
          </div>
        )}
      </div>

      {bankModalOpen && selectedStore && (
        <BankTransferModal
          amount={paymentAmount}
          submitting={submitting}
          onClose={() => setBankModalOpen(false)}
          onSubmit={handleBankSubmit}
        />
      )}

      <ToastContainer/>
    </div>
  );
}

// ── Bank transfer modal ─────────────────────────────────────────
// Displays the bank account info + accepts a receipt upload (image
// or PDF). On submit, uploads to the receipts bucket then triggers
// the request creation in the parent (handleBankSubmit).
function BankTransferModal({ amount, submitting, onClose, onSubmit }) {
  const [file, setFile] = useState(null);
  const [copied, setCopied] = useState('');

  const copyToClipboard = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      toast('فشل النسخ', 'error');
    }
  };

  const Row = ({ label, value, copyKey }) => (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center',
      padding: '12px 14px',
      background: '#FAFAFA', borderRadius: 12, marginBottom: 8,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#71717A', fontWeight: 600, marginBottom: 3 }}>{label}</div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: '#18181B',
          fontFamily: copyKey === 'iban' ? 'var(--font-mono)' : 'inherit',
          direction: copyKey === 'iban' ? 'ltr' : 'rtl',
          textAlign: 'right',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value}
        </div>
      </div>
      <button
        onClick={() => copyToClipboard(value, copyKey)}
        style={{
          background: copied === copyKey ? '#10B981' : '#fff',
          color: copied === copyKey ? '#fff' : '#3F3F46',
          border: `1px solid ${copied === copyKey ? '#10B981' : '#E4E4E7'}`,
          padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
        }}
      >
        {copied === copyKey ? '✓ نُسخ' : 'نسخ'}
      </button>
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,18,53,.45)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}
    onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: 24,
        width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 24px 56px rgba(0,0,0,.24)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#18181B', margin: 0, letterSpacing: -0.3 }}>
            حوالة بنكية
          </h2>
          <button onClick={onClose} style={{
            background: '#F4F4F5', border: 'none', color: '#3F3F46',
            width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        {/* Amount headline */}
        <div style={{
          background: '#0A0A0B', color: '#fff',
          borderRadius: 14, padding: '16px 18px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
            مبلغ التحويل
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: -0.6 }}>
            {fmt(amount)} <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>ر.س</span>
          </div>
        </div>

        {/* Bank details */}
        <div style={{ marginBottom: 16 }}>
          <Row label="البنك"      value={BANK_INFO.bank}        copyKey="bank"/>
          <Row label="رقم الآيبان" value={BANK_INFO.iban}        copyKey="iban"/>
          <Row label="المستفيد"   value={BANK_INFO.beneficiary} copyKey="ben"/>
        </div>

        {/* Receipt upload */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#18181B', marginBottom: 8 }}>
            إيصال التحويل
          </div>
          {file ? (
            <div style={{
              padding: '14px 16px', borderRadius: 12,
              background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.28)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <CheckCircle2 size={20} color="#10B981"/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#18181B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 11, color: '#71717A', marginTop: 2 }}>
                  {(file.size / 1024).toFixed(0)} كيلوبايت
                </div>
              </div>
              <button onClick={() => setFile(null)} style={{
                background: 'transparent', border: 'none', color: '#71717A',
                cursor: 'pointer', padding: 4,
              }}>✕</button>
            </div>
          ) : (
            <DropZone
              onFile={setFile}
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              title="ارفع إيصال التحويل"
              hint={<>صورة أو PDF · حتى 10 ميجا<br/>اسحب الملف أو <span style={{ color: '#10B981', fontWeight: 600 }}>اضغط للاختيار</span></>}
            />
          )}
        </div>

        {/* Submit */}
        <button
          onClick={() => onSubmit(file)}
          disabled={submitting || !file}
          style={{
            width: '100%', padding: '14px', borderRadius: 12,
            background: !file ? '#E4E4E7' : '#10B981',
            color: !file ? '#A1A1AA' : '#fff', border: 'none',
            fontSize: 14.5, fontWeight: 700, cursor: (!file || submitting) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {submitting
            ? <><Loader size={18} className="spin"/> جارٍ الإرسال…</>
            : !file
              ? 'ارفع الإيصال أولاً'
              : <><CheckCircle2 size={16}/> تم التحويل — أرسل الطلب</>}
        </button>
      </div>
    </div>
  );
}

// ── Moyasar payment step ─────────────────────────────────────────
// Loads the Moyasar SDK, renders their hosted form into a div, and
// wires the on_completed callback to mark the payment as attached.
// The form supports mada / Visa / Mastercard / Apple Pay / STC Pay
// depending on what's enabled in the Moyasar dashboard.
function MoyasarStep({ request, publishableKey, onPaid, onSkip }) {
  const containerRef = useRef(null);
  const [ready, setReady]   = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let alive = true;
    let initInstance = null;
    (async () => {
      const ok = await loadMoyasarSDK();
      if (!alive) return;
      if (!ok || !window.Moyasar) { setErrored(true); return; }
      try {
        initInstance = window.Moyasar.init({
          element:        containerRef.current,
          amount:         Math.round(Number(request.amount_total) * 100), // halalas
          currency:       'SAR',
          description:    `سداد ${request.invoice_count} فاتورة · ${request.store_name || ''}`.trim(),
          publishable_api_key: publishableKey,
          callback_url:   window.location.href,
          // We listen to the completion callback below; callback_url is
          // a fallback for hosted-redirect flows.
          methods:        ['creditcard', 'applepay', 'stcpay'],
          metadata: {
            payment_request_id: request.id,
            phone:              request.phone,
            store_id:           request.store_id || '',
            store_name:         request.store_name || '',
          },
          on_completed: (payment) => {
            // Moyasar returns { id, status, source: { type } }
            if (payment?.id) {
              const method = payment?.source?.type || payment?.source?.method || 'card';
              onPaid(payment.id, method);
            }
          },
        });
        setReady(true);
      } catch (e) {
        console.error('Moyasar init failed:', e);
        setErrored(true);
      }
    })();
    return () => { alive = false; /* SDK has no explicit teardown */ };
  }, [request, onPaid]);

  return (
    <div>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '20px 22px',
        boxShadow: '0 1px 3px rgba(24,24,27,.04)', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'rgba(16,185,129,.10)', color: '#10B981',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><CreditCard size={20}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#18181B' }}>الدفع الإلكتروني</div>
            <div style={{ fontSize: 12, color: '#71717A', marginTop: 2 }}>
              {request.invoice_count} فاتورة · إجمالي <strong style={{ color: '#10B981', fontFamily: 'var(--font-mono)' }}>{fmt(request.amount_total)}</strong> ر.س
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', marginBottom: 14,
          background: 'rgba(16,185,129,.06)', borderRadius: 10,
          fontSize: 11.5, color: '#3F3F46',
        }}>
          <ShieldCheck size={14} color="#10B981"/>
          الدفع مؤمَّن عبر Moyasar — يدعم mada و Apple Pay و Visa و Mastercard
        </div>

        {/* Moyasar form mounts here */}
        <div ref={containerRef} className="moyasar-form" style={{ minHeight: 200 }}/>

        {!ready && !errored && (
          <div style={{ textAlign: 'center', padding: 20, color: '#71717A', fontSize: 13 }}>
            <Loader size={20} className="spin" style={{ verticalAlign: 'middle', marginInlineEnd: 6 }}/>
            جارٍ تحميل نموذج الدفع…
          </div>
        )}
        {errored && (
          <div style={{
            padding: 14, fontSize: 13, color: '#EF4444',
            background: 'rgba(239,68,68,.06)', borderRadius: 10,
            textAlign: 'center',
          }}>
            تعذّر تحميل بوابة الدفع — تم استلام طلبك وراح يتواصل معك المحاسب
          </div>
        )}
      </div>

      <button onClick={onSkip} style={{
        width: '100%', padding: '12px', borderRadius: 12,
        background: 'transparent', border: '1px solid #E4E4E7', color: '#3F3F46',
        fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      }}>
        تخطّي الدفع الإلكتروني — أفضّل أنّ المحاسب يتواصل معي
      </button>
    </div>
  );
}
