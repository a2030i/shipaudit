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
import { portalLookup, submitPaymentRequest, attachMoyasarPayment } from '../lib/paymentRequestsService.js';

// Moyasar publishable key — safe to expose, only allows initiating
// payments (no balance / refund / customer data access). Set in
// Vercel as VITE_MOYASAR_PUBLISHABLE_KEY to enable the pay-online
// flow; the request-only flow still works without it.
const MOYASAR_PK = import.meta.env.VITE_MOYASAR_PUBLISHABLE_KEY || '';

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
  const [step, setStep] = useState('phone');     // phone | stores | invoices | pay | done
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState(null);    // { phone, stores: [...] }
  const [loading, setLoading] = useState(false);
  const [selectedStore, setSelectedStore] = useState(null);
  const [selectedInvoices, setSelectedInvoices] = useState(new Set());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

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
    setSelectedInvoices(new Set());
    setStep('invoices');
  };

  // ── Step 3 helpers ──────────────────────────────────────────
  const toggleInvoice = (invId) => {
    setSelectedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(invId)) next.delete(invId);
      else next.add(invId);
      return next;
    });
  };
  const toggleAll = () => {
    if (!selectedStore?.invoices) return;
    if (selectedInvoices.size === selectedStore.invoices.length) {
      setSelectedInvoices(new Set());
    } else {
      setSelectedInvoices(new Set(selectedStore.invoices.map(i => i.id)));
    }
  };
  const selectedTotal = useMemo(() => {
    if (!selectedStore?.invoices) return 0;
    return selectedStore.invoices
      .filter(i => selectedInvoices.has(i.id))
      .reduce((s, i) => s + (Number(i.amount) || 0), 0);
  }, [selectedStore, selectedInvoices]);

  // ── Step 4: submit ──────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedInvoices.size) return toast('اختر فاتورة على الأقل', 'warn');
    setSubmitting(true);
    try {
      const refs = selectedStore.invoices
        .filter(i => selectedInvoices.has(i.id))
        .map(i => ({ id: i.id, date: i.date, amount: Number(i.amount) || 0 }));
      const res = await submitPaymentRequest({
        phone:         lookup.phone,
        customerName:  selectedStore.customer_name || null,
        storeId:       selectedStore.store_id,
        storeName:     selectedStore.store_name,
        amountTotal:   selectedTotal,
        invoiceCount:  refs.length,
        invoiceRefs:   refs,
        notes,
      });
      setSubmitResult(res);
      // If Moyasar is configured → offer immediate online payment.
      // Otherwise the customer waits for the accountant.
      setStep(MOYASAR_PK ? 'pay' : 'done');
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
          const stages = MOYASAR_PK
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

            <div style={{ background: '#fff', borderRadius: 16, padding: 0, boxShadow: '0 1px 3px rgba(24,24,27,.04)', overflow: 'hidden' }}>
              <div style={{
                padding: '14px 18px', borderBottom: '1px solid #F4F4F5',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <h3 style={{ fontSize: 14.5, fontWeight: 700, color: '#18181B', margin: 0 }}>الفواتير</h3>
                <button onClick={toggleAll} style={{
                  background: 'transparent', border: '1px solid #E4E4E7', color: '#3F3F46',
                  padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                  {selectedInvoices.size === (selectedStore.invoices || []).length ? 'إلغاء التحديد' : 'تحديد الكل'}
                </button>
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {(selectedStore.invoices || []).length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: '#71717A', fontSize: 13 }}>
                    لا توجد فواتير معلّقة على هذا المتجر — كل شيء مسدّد
                  </div>
                ) : (selectedStore.invoices || []).map((inv, i, arr) => {
                  const checked = selectedInvoices.has(inv.id);
                  return (
                    <label
                      key={inv.id}
                      style={{
                        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14,
                        padding: '14px 18px', alignItems: 'center', cursor: 'pointer',
                        borderBottom: i === arr.length - 1 ? 'none' : '1px solid #F4F4F5',
                        background: checked ? 'rgba(16,185,129,.04)' : 'transparent',
                        transition: 'background .12s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInvoice(inv.id)}
                        style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#10B981' }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#18181B', fontFamily: 'var(--font-mono)' }}>
                          {fmtDate(inv.date)}
                        </div>
                        <div style={{ fontSize: 11, color: '#71717A', marginTop: 1 }}>
                          فاتورة #{String(inv.id).slice(0, 8)}
                        </div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#18181B', fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
                        {fmt(inv.amount)} <span style={{ fontSize: 10, color: '#A1A1AA', fontWeight: 500 }}>ر.س</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {selectedInvoices.size > 0 && (
              <div style={{
                position: 'sticky', bottom: 16, marginTop: 16,
                background: '#0A0A0B', borderRadius: 16, padding: '18px 20px',
                boxShadow: '0 16px 40px rgba(0,0,0,.18)',
                color: '#fff',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>
                      مجموع المختار · {selectedInvoices.size} فاتورة
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: -0.5, marginTop: 4 }}>
                      {fmt(selectedTotal)} <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>ر.س</span>
                    </div>
                  </div>
                </div>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="ملاحظة (اختياري) — مثلاً: سأحوّل اليوم بنكي"
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)',
                    color: '#fff', fontSize: 13, fontFamily: 'inherit',
                    resize: 'vertical', marginBottom: 12,
                  }}
                />
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 12,
                    background: '#10B981', color: '#fff', border: 'none',
                    fontSize: 15, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer',
                    fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  {submitting ? <Loader size={18} className="spin"/> : <><Send size={16}/> إرسال طلب السداد</>}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 4: pay (Moyasar) ──────────────────────────── */}
        {step === 'pay' && submitResult && (
          <MoyasarStep
            request={submitResult}
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

      <ToastContainer/>
    </div>
  );
}

// ── Moyasar payment step ─────────────────────────────────────────
// Loads the Moyasar SDK, renders their hosted form into a div, and
// wires the on_completed callback to mark the payment as attached.
// The form supports mada / Visa / Mastercard / Apple Pay / STC Pay
// depending on what's enabled in the Moyasar dashboard.
function MoyasarStep({ request, onPaid, onSkip }) {
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
          publishable_api_key: MOYASAR_PK,
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
