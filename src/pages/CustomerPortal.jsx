// Customer-facing payment-request portal.
//
// Path: /portal (no auth, no sidebar — standalone full-screen page).
// Four steps:
//   1. Phone entry
//   2. Stores list (every merchant on that phone, with total due)
//   3. Invoice selection for one store
//   4. Confirmation + submit → request lands in /payment-requests
//      where an admin/accountant picks it up.

import { useState, useMemo } from 'react';
import {
  Phone, ArrowLeft, CheckCircle2, Building2, Receipt, Send,
  ShoppingBag, Loader,
} from 'lucide-react';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import { Spinner, toast, ToastContainer } from '../components/UI.jsx';
import { portalLookup, submitPaymentRequest } from '../lib/paymentRequestsService.js';

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
  const [step, setStep] = useState('phone');     // phone | stores | invoices | done
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
      setLookup(result);
      if (!result?.stores?.length) {
        toast('لم نجد متاجر مرتبطة بهذا الرقم', 'warn');
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 28, justifyContent: 'center' }}>
          {['phone', 'stores', 'invoices', 'done'].map(s => (
            <div key={s} style={{
              width: 10, height: 10, borderRadius: '50%',
              background: step === s ? '#10B981'
                : ['phone', 'stores', 'invoices', 'done'].indexOf(step) > ['phone', 'stores', 'invoices', 'done'].indexOf(s) ? '#10B981'
                : '#E4E4E7',
              transition: 'background .2s',
            }}/>
          ))}
        </div>

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

        {/* ── STEP 4: done ───────────────────────────────────── */}
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
