// CustomerReceivables — Zoho open invoices per customer. Single-page CFO view:
// hero totals → aging buckets →
// sortable customer table → click row to inspect their invoices.
// READ-ONLY: the app doesn't bill, it reflects the Zoho Books mirror.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import {
  RefreshCw, Download, Search, Users, AlertTriangle,
  CheckCircle2, Trash2, ChevronDown, ChevronLeft, FileText, Building2,
  ShieldCheck, Eye, EyeOff, MessageSquare, Filter, X,
  Phone, Hash, ShoppingBag, ArrowLeft,
} from 'lucide-react';
import { Card, Btn, Spinner, Empty, Modal, toast, PageHero, PageHeader } from '../components/UI.jsx';
import DataConfidenceBar from '../components/DataConfidenceBar.jsx';
import InteractionsLog from '../components/InteractionsLog.jsx';
import { useAuth } from '../lib/auth.jsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import WaActions from '../components/WaActions.jsx';
import {
  loadLatestReceivables, loadReceivablesSnapshots, deleteReceivablesSnapshot,
  setCustomerStatus,
} from '../lib/customerReceivablesService.js';
import { loadLatestMerchants } from '../lib/merchantsService.js';
import { computeRisk } from '../lib/customerRisk.js';
import { syncZohoDocs } from '../lib/pnlService.js';

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

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return iso; }
};
const isZohoSnapshot = (snapshot) => snapshot?.source === 'zoho';
const receivablesSourceLabel = (snapshot) => isZohoSnapshot(snapshot) ? 'Zoho Books API' : 'لقطة Excel قديمة';
const receivablesMeta = (snapshot) => {
  if (!snapshot) return null;
  if (isZohoSnapshot(snapshot)) return `Zoho Books API · آخر مزامنة ${fmtDate(snapshot.uploadedAt)}`;
  return `لقطة ${snapshot.id} · رُفعت ${fmtDate(snapshot.uploadedAt)}` +
    (snapshot.periodFrom ? ` · الفترة ${fmtDate(snapshot.periodFrom)} → ${fmtDate(snapshot.periodTo)}` : '');
};

// ── Tab pill ────────────────────────────────────────────────────
function Tab({ id, label, count, amount, active, accent, onClick }) {
  const isActive = active;
  const accentColor = accent || (isActive ? 'var(--accent)' : null);
  return (
    <button onClick={() => onClick(id)} style={{
      flex: 1,
      background: isActive ? 'var(--card)' : 'transparent',
      border: 'none',
      padding: '10px 14px',
      cursor: 'pointer',
      borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      fontFamily: 'var(--font-sans)',
      boxShadow: isActive ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? 'var(--text)' : accent || 'var(--muted)' }}>
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {amount != null && amount > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: accentColor || 'var(--muted)', fontWeight: 700 }}>
            {Number(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })} ر.س
          </span>
        )}
        <span style={{
          background: accent && count > 0 ? accent + '20' : 'var(--surface)',
          color: accent && count > 0 ? accent : (isActive ? 'var(--text)' : 'var(--muted)'),
          padding: '2px 9px', borderRadius: 9,
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
          border: `1px solid ${accent && count > 0 ? accent + '60' : 'var(--border)'}`,
        }}>{count}</span>
      </span>
    </button>
  );
}

// ── Hero ────────────────────────────────────────────────────────
function Hero({ total, overdueTotal, customerCount, snapshot, oldestDays }) {
  return (
    <PageHero
      variant="dark"
      icon={<Users size={22}/>}
      tag="LAMHA · CUSTOMER RECEIVABLES"
      title="مديونيات العملاء"
      meta={receivablesMeta(snapshot)}
      stats={[
        { label: 'إجمالي المستحقّات', value: `${fmt(total)} ر.س`, big: true },
        { label: 'المتجاوز 30 يوم',   value: `${fmt(overdueTotal)} ر.س`, color: '#FBBF24' },
        { label: 'عدد العملاء',       value: customerCount },
        {
          label: 'أقدم فاتورة',
          value: oldestDays != null ? `قبل ${oldestDays} يوم` : '—',
          color: oldestDays != null && oldestDays > 90 ? '#FCA5A5' : undefined,
        },
      ]}
    />
  );
}

// ── Aging cards ────────────────────────────────────────────────
function AgingGrid({ aging, total }) {
  const cells = [
    { key: 'd0_30',    label: '0–30 يوم',  amount: aging.d0_30,    color: 'var(--green)' },
    { key: 'd31_60',   label: '31–60 يوم', amount: aging.d31_60,   color: 'var(--gold)' },
    { key: 'd61_90',   label: '61–90 يوم', amount: aging.d61_90,   color: '#F97316' },
    { key: 'd90_plus', label: '+90 يوم',   amount: aging.d90_plus, color: '#EF4444' },
  ];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 10, marginBottom: 14,
    }}>
      {cells.map(c => {
        const pct = total > 0 ? Math.round((c.amount / total) * 100) : 0;
        return (
          <Card key={c.key} style={{ padding: '14px 18px', borderTop: `2px solid ${c.color}` }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 2, textTransform: 'uppercase' }}>
              {c.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.color, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
              {fmt(c.amount)} <span style={{ fontSize: 10, opacity: .55 }}>ر.س</span>
            </div>
            <div style={{ marginTop: 6, height: 6, background: 'var(--surface)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: c.color }}/>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              {pct}% من الإجمالي
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ── Customer invoices drawer ───────────────────────────────────
// Phone normaliser: strip non-digits, drop +966 / 00966 / 966 / leading
// 0 so all the variants of the same Saudi number collapse to one key.
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D/g, '');
  if (s.startsWith('00966')) s = s.slice(5);
  else if (s.startsWith('966')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  return s.length >= 8 ? s : null;
}

function CustomerDrawer({ customer, allCustomers = [], allMerchants = [], onSelect, onClose }) {
  if (!customer) return null;
  const m = customer.merchant;
  const myPhone   = normalizePhone(m?.phone);
  const myStoreId = m?.storeId || null;
  const showStoreSubtitle = customer.name && m?.storeName && m.storeName !== customer.name;

  // Phone siblings — every other merchant on the same phone, enriched
  // with their receivables row when one exists.
  const siblings = useMemo(() => {
    if (!myPhone) return [];
    const customerByStoreId = new Map();
    for (const cu of allCustomers) {
      const sid = cu.merchant?.storeId;
      if (sid) customerByStoreId.set(sid, cu);
    }
    const out = [];
    const seen = new Set(); if (myStoreId) seen.add(myStoreId);
    for (const mm of allMerchants) {
      if (seen.has(mm.store_id)) continue;
      if (normalizePhone(mm.phone) !== myPhone) continue;
      seen.add(mm.store_id);
      const cu = customerByStoreId.get(mm.store_id) || null;
      out.push({
        merchant: mm,
        customer: cu,
        debt: Number(cu?.total) || 0,
        wallet: Number(mm.wallet_balance) || 0,
        shipments: Number(mm.shipment_count) || 0,
      });
    }
    return out.sort((a, b) => (b.debt + Math.abs(b.wallet)) - (a.debt + Math.abs(a.wallet)));
  }, [myPhone, myStoreId, allCustomers, allMerchants]);

  return (
    <Modal title={customer.name} onClose={onClose} width={780}>
      {/* Identity strip — store info + phone + call CTA */}
      {m && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16,
          padding: '12px 14px', marginBottom: 14,
          background: 'var(--bg2)', borderRadius: 12,
          alignItems: 'center',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'var(--accent-dim)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 17,
          }}>
            {(m.storeName || customer.name).slice(0, 1)}
          </div>
          <div style={{ minWidth: 0 }}>
            {showStoreSubtitle && (
              <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, marginBottom: 2 }}>
                <ShoppingBag size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }}/>
                {m.storeName}
              </div>
            )}
            <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap', marginTop: 3 }}>
              {m.storeId && <span><Hash size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 3 }}/>{m.storeId}</span>}
              {m.phone && <span style={{ direction: 'ltr' }}><Phone size={11} style={{ verticalAlign: 'middle', marginInlineEnd: 3 }}/>{m.phone}</span>}
              {/* §هيكلة-0: كان الهاتف نصاً بلا أزرار — اتصال + حملة + محادثة */}
              {m.phone && <WaActions phone={m.phone} name={m.storeName || customer.name}
                amount={Number(customer.total) || 0}
                vars={[m.storeName || customer.name || '', Number(customer.total || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }), '']}
                campaignLabel="الكشف الداخلي" size={13}/>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {m.billingType && (
                <span style={{
                  fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
                  background: m.billingType === 'دفع مسبق' ? 'rgba(59,130,246,.14)' : 'rgba(245,158,11,.14)',
                  color: m.billingType === 'دفع مسبق' ? '#3B82F6' : 'var(--gold)',
                  fontWeight: 600,
                }}>{m.billingType}</span>
              )}
              {m.platformStatus && (
                <span style={{
                  fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
                  background: m.platformStatus === 'نشط' ? 'rgba(16,185,129,.14)' : 'rgba(113,113,122,.14)',
                  color: m.platformStatus === 'نشط' ? 'var(--green)' : 'var(--muted)',
                  fontWeight: 600,
                }}>{m.platformStatus}</span>
              )}
            </div>
          </div>
          {m.phone && (
            <a href={`tel:${m.phone}`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 999,
              background: 'var(--accent)', color: '#fff',
              fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
              boxShadow: '0 1px 2px rgba(16,185,129,.22)',
            }}>
              <Phone size={13}/> اتصل
            </a>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <StatPill label="إجمالي مديونيته" value={`${fmt(customer.total)} ر.س`}/>
        <StatPill label="عدد الفواتير" value={customer.invoiceCount}/>
        {customer.oldestInvoiceDate && (
          <StatPill
            label="أقدم فاتورة"
            value={`${fmtDate(customer.oldestInvoiceDate)} · ${customer.daysOutstanding} يوم`}
            color={customer.daysOutstanding > 90 ? 'var(--red)' : null}
          />
        )}
      </div>

      {/* Phone siblings — other stores owned by the same operator */}
      {siblings.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
              نفس الرقم · {siblings.length + 1} متجر
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              هذا الرقم يدير {siblings.length + 1} متاجر — اتصال واحد يكفي
            </div>
          </div>
          <div className="m-flow" style={{
            border: '1px solid var(--border)', borderRadius: 12,
            maxHeight: 220, overflowY: 'auto',
          }}>
            {siblings.map((s, i) => {
              const sm = s.merchant;
              const billingColor = sm.billing_type === 'دفع مسبق' ? '#3B82F6' : 'var(--gold)';
              const statusColor  = sm.status === 'نشط' ? 'var(--green)' : '#71717A';
              return (
                <div
                  key={sm.store_id}
                  onClick={() => onSelect?.(s.customer || {
                    name: sm.store_name,
                    total: 0, invoiceCount: 0, invoices: [],
                    merchant: {
                      storeId: sm.store_id, storeName: sm.store_name, phone: sm.phone,
                      billingType: sm.billing_type, platformStatus: sm.status,
                      shipmentCount: sm.shipment_count, lastShipmentAt: sm.last_shipment_at,
                      walletBalance: Number(sm.wallet_balance) || 0,
                    },
                  })}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto',
                    gap: 12, padding: '10px 12px',
                    borderBottom: i === siblings.length - 1 ? 'none' : '1px solid var(--border)',
                    alignItems: 'center', cursor: 'pointer',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700,
                  }}>{(sm.store_name || '?').slice(0, 1)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sm.store_name}
                    </div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                      {sm.billing_type && (
                        <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, background: `color-mix(in srgb, ${billingColor} 14%, transparent)`, color: billingColor, fontWeight: 600 }}>{sm.billing_type}</span>
                      )}
                      <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 999, background: `color-mix(in srgb, ${statusColor} 14%, transparent)`, color: statusColor, fontWeight: 600 }}>{sm.status || '—'}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{s.shipments} شحنة</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                    {s.debt > 0.5 ? (
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                        {fmt(s.debt)} <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>دين</span>
                      </div>
                    ) : s.wallet !== 0 ? (
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: s.wallet < 0 ? 'var(--red)' : 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                        {fmt(s.wallet)} <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 500 }}>محفظة</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>—</div>
                    )}
                  </div>
                  <ArrowLeft size={13} color="var(--muted2)"/>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invoices table */}
      <div className="m-flow" style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 9, marginBottom: 20 }}>
        <table style={{ fontSize: 12, width: '100%' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
            <tr>
              <th style={{ textAlign: 'right' }}>تاريخ الفاتورة</th>
              <th style={{ textAlign: 'left' }}>المبلغ</th>
              <th style={{ textAlign: 'center' }}>الأيام</th>
            </tr>
          </thead>
          <tbody>
            {customer.invoices.length === 0
              ? <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>لا توجد تفاصيل فواتير مفتوحة لهذا العميل</td></tr>
              : customer.invoices.map(inv => {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const days = inv.date
                  ? Math.floor((today - new Date(inv.date)) / 86_400_000)
                  : null;
                const color =
                  days == null ? 'var(--muted)' :
                  days > 90    ? '#EF4444' :   // red — critically overdue
                  days > 60    ? '#F97316' :   // orange — chase
                  days > 30    ? 'var(--gold)' :   // yellow — past due
                                 'var(--green)';    // green — current
                return (
                  <tr key={inv.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      <div>{fmtDate(inv.date)}</div>
                      {inv.invoiceNumber && <div style={{ color: 'var(--muted)', marginTop: 2 }}>{inv.invoiceNumber}</div>}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'left' }}>{fmt(inv.amount)} ر.س</td>
                    <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'center', color }}>
                      {days != null ? `${days} يوم` : '—'}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* SOA export — single-button handoff for the accountant. */}
      <div style={{
        display: 'flex', gap: 8, justifyContent: 'flex-end',
        padding: '10px 0', marginTop: 8, marginBottom: 6,
        borderTop: '1px solid var(--border)',
      }}>
        <Btn size="sm" variant="ghost" icon={<Download size={13}/>}
             onClick={async () => {
               try {
                 const { exportCustomerSOA } = await import('../lib/soaExport.js');
                 const r = await exportCustomerSOA(customer.name);
                 toast(`تم تصدير كشف الحساب · رصيد ${fmt(r.balance)} ر.س`, 'success');
               } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
             }}>
          📋 تصدير كشف الحساب
        </Btn>
      </div>

      {/* CRM activity log — same component used in /customers drill-down */}
      <InteractionsLog
        customerName={customer.name}
        storeId={customer.merchant?.storeId || null}
      />
    </Modal>
  );
}

function StatPill({ label, value, color }) {
  return (
    <div style={{
      padding: '6px 12px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 9,
    }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || 'var(--text)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

// ── Tag (exclude / restore) modal ──────────────────────────────
function TagCustomerModal({ customer, mode, onClose, onSubmit }) {
  const [notes, setNotes] = useState(customer.notes || '');
  const isExclude = mode === 'exclude';
  return (
    <Modal
      title={isExclude ? '🛡 نقل لمتابعة خاصة' : 'إرجاع للمتابعة الافتراضية'}
      onClose={onClose} width={480}
    >
      <div style={{
        marginBottom: 14, padding: '10px 14px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 9, fontSize: 12.5, lineHeight: 1.7,
      }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
          {customer.name}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>
          مديونيته الحالية: <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{fmt(customer.total)} ر.س</strong>
          {customer.invoiceCount > 0 && ` · ${customer.invoiceCount} فاتورة`}
        </div>
      </div>

      <div style={{
        marginBottom: 14, padding: '10px 14px',
        background: isExclude ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'rgba(251,191,36,.06)',
        border: `1px solid ${isExclude ? 'color-mix(in srgb, var(--accent) 32%, transparent)' : 'rgba(251,191,36,.32)'}`,
        borderRadius: 9, fontSize: 12, lineHeight: 1.7,
      }}>
        {isExclude ? (
          <>
            <strong style={{ color: 'var(--accent)' }}>ماذا يحدث؟</strong>
            <ul style={{ margin: '6px 0 0 0', paddingInlineStart: 18, color: 'var(--muted)' }}>
              <li>يخرج من جدول المديونيات الافتراضي</li>
              <li>لا يُحتسب في الإجماليات والأعمار</li>
              <li>يظهر في تبويب "مخفيون من الإجماليات"</li>
              <li>يبقى موسوماً حتى عبر الكشوف القادمة</li>
            </ul>
          </>
        ) : (
          <>
            <strong style={{ color: 'var(--gold)' }}>سيتم:</strong>
            <ul style={{ margin: '6px 0 0 0', paddingInlineStart: 18, color: 'var(--muted)' }}>
              <li>إرجاعه للمتابعة الافتراضية</li>
              <li>احتسابه في الإجماليات والأعمار</li>
              <li>إزالة الملاحظة إن وُجدت</li>
            </ul>
          </>
        )}
      </div>

      <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
        ملاحظة (اختياري)
      </label>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={isExclude ? "مثال: عميل ملتزم — دفع منتظم شهرياً" : "اتركها فارغة لإزالة الملاحظة الحالية"}
        rows={3}
        style={{
          width: '100%', padding: '8px 10px', borderRadius: 8,
          fontSize: 12, fontFamily: 'var(--font-sans)',
          resize: 'vertical',
        }}
      />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn
          variant="accent"
          icon={isExclude ? <ShieldCheck size={13}/> : <EyeOff size={13}/>}
          onClick={() => onSubmit(notes.trim() || null)}
        >
          {isExclude ? 'نقل لمتابعة خاصة' : 'إرجاع للافتراضية'}
        </Btn>
      </div>
    </Modal>
  );
}

// ── Main ───────────────────────────────────────────────────────
export default function CustomerReceivables({ isActive = true }) {
  const { user, can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data,    setData]    = useState(null);
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openCustomer, setOpenCustomer] = useState(null);
  const [search,  setSearch]  = useState('');
  const [sortBy,  setSortBy]  = useState('total');     // total | oldest | invoices | name
  const [sortDir, setSortDir] = useState('desc');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [syncingZoho, setSyncingZoho] = useState(false);
  // Tab: 'active' = الافتراضي, 'excluded' = متابعة خاصة
  const [tab, setTabRaw] = useState('active');
  // When the user clicks an anomaly card on the alerts tab, this
  // narrows the table below to only that bucket. null = show all.
  const [anomalyFilter, setAnomalyFilter] = useState(null);
  // "Stop now" filter — narrows the alerts table to customers who should be
  // suspended before their debt grows (active post-paid + overdue/over-limit).
  const [stopOnly, setStopOnly] = useState(false);
  // Changing tab resets the anomaly card filter so the alerts-tab
  // narrowing doesn't carry into the other tabs.
  const setTab = (t) => { setTabRaw(t); setAnomalyFilter(null); };
  // Filters
  const [minBalance, setMinBalance] = useState('');
  const [minDays,    setMinDays]    = useState('');
  const [bucketFilters, setBucketFilters] = useState(new Set()); // 'd0_30' | 'd31_60' | 'd61_90' | 'd90_plus'
  // Tag modal
  const [tagModal, setTagModal] = useState(null); // { customer, mode:'exclude'|'restore' }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Pull receivables + merchants in parallel — the anomalies tab
      // needs both (negative-wallet merchants surface even when they
      // have no AR row in the current snapshot).
      const [d, mResult] = await Promise.all([
        loadLatestReceivables(),
        loadLatestMerchants().catch(() => ({ merchants: [] })),
      ]);
      setData(d);
      setMerchants(mResult?.merchants || []);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  useEffect(() => {
    const customer = searchParams.get('customer');
    if (customer) setSearch(customer);
    const wantedTab = searchParams.get('tab');
    if (['active', 'anomalies', 'excluded'].includes(wantedTab)) setTab(wantedTab);
  }, [searchParams]);

  const oldestDays = useMemo(() => {
    if (!data?.customers?.length) return null;
    const days = data.customers
      .map(c => c.daysOutstanding)
      .filter(d => Number.isFinite(d) && d > 0);
    return days.length ? Math.max(...days) : null;
  }, [data]);

  // Anomalies — computed once whenever data changes so the tab badge
  // count and the table render share the same source of truth.
  // Each entry carries an `anomaly` tag for the UI to colour-code.
  //
  // Check order matters: the FIRST matching rule wins (continue exits
  // the loop body), so we put the most-severe technical errors first.
  //   1. negative_wallet     — prepaid wallet < 0 → technical bug,
  //                            shipping was allowed on credit somehow
  //   2. prepaid_with_debt   — prepaid customer carrying invoices →
  //                            should pay from wallet, technical error
  //   3. active_with_debt    — customer is still actively shipping
  //                            (last shipment ≤ 10d) but has debt →
  //                            accumulating, call them today
  //   4. postpaid_overdue    — postpaid invoice older than 60d →
  //                            suspension candidate
  //   5. inactive_with_debt  — deactivated store with open invoices →
  //                            collect before closing the account
  const anomalies = useMemo(() => {
    if (!data?.activeCustomers) return [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out = [];

    // PASS 1 — merchant-driven: negative-wallet bug surfaces for EVERY
    // store regardless of whether it has a receivables row, so the
    // count here matches the "محافظ بأرصدة سالبة" list on /customers.
    const customerByStoreId = new Map(
      data.activeCustomers
        .filter(c => c.merchant?.storeId)
        .map(c => [c.merchant.storeId, c]),
    );
    const handledByNegativeWallet = new Set();
    for (const m of merchants) {
      if (m.billing_type !== 'دفع مسبق') continue;
      const w = Number(m.wallet_balance) || 0;
      if (w >= -0.5) continue;
      handledByNegativeWallet.add(m.store_id);
      const c = customerByStoreId.get(m.store_id);
      if (c) {
        out.push({ ...c, anomaly: 'negative_wallet' });
      } else {
        // Phantom entry — store has negative wallet but no AR row.
        out.push({
          name: m.store_name,
          total: 0,
          invoiceCount: 0,
          daysOutstanding: 0,
          merchant: {
            storeId: m.store_id,
            storeName: m.store_name,
            phone: m.phone,
            billingType: m.billing_type,
            platformStatus: m.status,
            shipmentCount: m.shipment_count,
            lastShipmentAt: m.last_shipment_at,
            walletBalance: w,
          },
          anomaly: 'negative_wallet',
        });
      }
    }

    // PASS 2 — customer-driven: the remaining four buckets all need
    // receivables debt to be meaningful.
    for (const c of data.activeCustomers) {
      const m = c.merchant;
      if (!m) continue;
      if (m.storeId && handledByNegativeWallet.has(m.storeId)) continue;

      if (m.billingType === 'دفع مسبق' && (c.total || 0) > 0.5) {
        out.push({ ...c, anomaly: 'prepaid_with_debt' });
        continue;
      }
      if ((c.total || 0) > 0.5 && m.lastShipmentAt) {
        const daysSinceShip = Math.floor((today - new Date(m.lastShipmentAt)) / 86_400_000);
        if (daysSinceShip <= 10) {
          out.push({ ...c, anomaly: 'active_with_debt', daysSinceShip });
          continue;
        }
      }
      if (m.billingType === 'دفع لاحق' && (c.daysOutstanding || 0) > 60 && (c.total || 0) > 0.5) {
        out.push({ ...c, anomaly: 'postpaid_overdue' });
        continue;
      }
      if (m.platformStatus === 'غير نشط' && (c.total || 0) > 0.5) {
        out.push({ ...c, anomaly: 'inactive_with_debt' });
        continue;
      }
    }

    // PASS 3 — credit-limit overflow. Captures EVERY customer whose
    // total debt exceeded their effective credit limit (10K default
    // or per-customer override). Run as a separate pass so a
    // customer can show up in both "prepaid_with_debt" and
    // "over_credit_limit" simultaneously — they're independent
    // diagnostic signals.
    for (const c of data.activeCustomers) {
      if (c.overLimit && (c.total || 0) > 0.5) {
        out.push({ ...c, anomaly: 'over_credit_limit' });
      }
    }
    // Merge duplicate entries for the same customer (e.g. postpaid_overdue
    // from Pass 2 + over_credit_limit from Pass 3) into a single row.
    const byName = new Map();
    for (const item of out) {
      if (!byName.has(item.name)) {
        byName.set(item.name, { ...item, anomalyExtras: [] });
      } else {
        byName.get(item.name).anomalyExtras.push(item.anomaly);
      }
    }
    // Attach a 0–100 risk score + "stop now" signal to every flagged customer.
    return [...byName.values()].map(c => ({ ...c, risk: computeRisk(c) }));
  }, [data, merchants]);

  // The "stop now" list — active post-paid customers whose debt is already
  // overdue/over-limit and still growing. Highest-leverage collection action.
  const stopNow = useMemo(
    () => anomalies.filter(c => c.risk?.shouldStop)
      .sort((a, b) => (b.risk?.score || 0) - (a.risk?.score || 0)),
    [anomalies],
  );

  // Group anomalies by type for the breakdown banner.
  const anomalyBreakdown = useMemo(() => {
    const groups = {
      negative_wallet:    [],
      prepaid_with_debt:  [],
      active_with_debt:   [],
      postpaid_overdue:   [],
      inactive_with_debt: [],
      over_credit_limit:  [],
    };
    for (const c of anomalies) {
      if (groups[c.anomaly]) groups[c.anomaly].push(c);
      for (const a of (c.anomalyExtras || [])) {
        if (groups[a]) groups[a].push(c);
      }
    }
    return groups;
  }, [anomalies]);

  const visibleCustomers = useMemo(() => {
    if (!data) return [];
    // Pick the right pool first — excluded customers are tracked
    // separately so the active KPIs don't count them.
    let pool = tab === 'anomalies'
      ? anomalies
      : tab === 'excluded'
        ? (data.excludedCustomers || [])
        : (data.activeCustomers   || []);
    // Anomaly-card click narrows the pool to one bucket only.
    if (tab === 'anomalies' && anomalyFilter) {
      pool = pool.filter(c => c.anomaly === anomalyFilter || c.anomalyExtras?.includes(anomalyFilter));
    }
    // "Stop now" narrows to the suspend-before-it-grows list.
    if (tab === 'anomalies' && stopOnly) {
      pool = pool.filter(c => c.risk?.shouldStop);
    }
    // Text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      pool = pool.filter(c => c.name.toLowerCase().includes(q));
    }
    // Filter: min balance
    const mb = parseFloat(minBalance);
    if (Number.isFinite(mb) && mb > 0) {
      pool = pool.filter(c => (c.total || 0) >= mb);
    }
    // Filter: min days outstanding
    const md = parseInt(minDays, 10);
    if (Number.isFinite(md) && md > 0) {
      pool = pool.filter(c => (c.daysOutstanding || 0) >= md);
    }
    // Filter: aging bucket — INVOICE-level. A customer enters the list
    // if they have ANY invoice in the active buckets, and the displayed
    // "filteredTotal" reflects only the slice within those buckets
    // (NOT the customer's full balance). This matches the user's
    // expectation: filtering "+90" should show the +90 portion of each
    // customer's debt, not their whole receivable.
    if (bucketFilters.size > 0) {
      pool = pool
        .map(c => {
          const filteredTotal = [...bucketFilters].reduce(
            (s, k) => s + (c.bucketAmounts?.[k] || 0), 0,
          );
          return { ...c, filteredTotal: +filteredTotal.toFixed(2) };
        })
        .filter(c => c.filteredTotal > 0.005);
    }
    // Sort — sort by the FILTERED amount when bucket filter is on,
    // otherwise by the full total.
    const dir = sortDir === 'asc' ? 1 : -1;
    const totalKey = (c) => bucketFilters.size > 0 ? (c.filteredTotal || 0) : (c.total || 0);
    return [...pool].sort((a, b) => {
      // In the alerts tab, default ordering is by RISK SCORE (highest first)
      // so the most urgent customers float to the top — unless the operator
      // explicitly picks another column or an aging-bucket filter.
      if (tab === 'anomalies' && sortBy === 'total' && bucketFilters.size === 0) {
        return ((b.risk?.score || 0) - (a.risk?.score || 0))
          || ((b.total || 0) - (a.total || 0));
      }
      if (sortBy === 'name')     return a.name.localeCompare(b.name) * dir;
      if (sortBy === 'oldest')   return ((a.daysOutstanding || 0) - (b.daysOutstanding || 0)) * dir;
      if (sortBy === 'invoices') return ((a.invoiceCount || 0) - (b.invoiceCount || 0)) * dir;
      return (totalKey(a) - totalKey(b)) * dir;
    });
  }, [data, anomalies, tab, anomalyFilter, stopOnly, search, minBalance, minDays, bucketFilters, sortBy, sortDir]);

  const toggleBucket = (k) => {
    setBucketFilters(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const clearFilters = () => {
    setMinBalance('');
    setMinDays('');
    setBucketFilters(new Set());
    setSearch('');
  };

  const hasFilters = !!minBalance || !!minDays || bucketFilters.size > 0 || !!search.trim();

  const handleTagCustomer = async (customerName, status, notes) => {
    try {
      await setCustomerStatus({
        customerName,
        status,
        notes,
        userId: user?.id,
      });
      toast(
        status === 'excluded' ? `تم نقل ${customerName} إلى متابعة خاصة` :
        status === 'normal'   ? `تم إرجاع ${customerName} للمتابعة الافتراضية` :
                                'تم التحديث',
        'success',
      );
      setTagModal(null);
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const handleExport = () => {
    if (!visibleCustomers.length) {
      toast('لا توجد بيانات للتصدير', 'info');
      return;
    }
    const bucketActive = bucketFilters.size > 0;
    // Merchant columns are appended after the financial columns so the
    // operator can see *which store* every customer name resolves to —
    // store_id and clean store_name come from customer_merchant_links.
    const baseHeaders = bucketActive
      ? ['اسم العميل (كما في كشف الفواتير)', 'في الشريحة (ر.س)', 'إجمالي الرصيد (ر.س)', 'عدد الفواتير', 'أقدم فاتورة', 'الأيام']
      : ['اسم العميل (كما في كشف الفواتير)', 'الإجمالي (ر.س)', 'عدد الفواتير', 'أقدم فاتورة', 'الأيام منذ أقدم فاتورة'];
    const merchantHeaders = [
      'رقم المتجر',
      'اسم المتجر (من المنصّة)',
      'هاتف المتجر',
      'نوع الفوترة',
      'حالة المتجر',
      'الرصيد في المحفظة',
      'آخر شحنة',
      'تنبيه',
      'حالة الربط',
      'نسبة تطابق الاسم',
    ];
    const headers = [...baseHeaders, ...merchantHeaders];

    const linkStatusFor = (c) => {
      if (c.merchant) return c.merchantMatch?.method === 'manual' ? 'مرتبط يدوياً' : 'مرتبط تلقائياً';
      if (c.merchantMatch) return 'تم التخطّي يدوياً';
      return 'غير مرتبط';
    };

    const rows = visibleCustomers.map(c => {
      const m = c.merchant;
      const baseRow = bucketActive
        ? [c.name, Number(c.filteredTotal || 0).toFixed(2), Number(c.total || 0).toFixed(2),
           c.invoiceCount, c.oldestInvoiceDate || '', c.daysOutstanding || '']
        : [c.name, Number(c.total || 0).toFixed(2),
           c.invoiceCount, c.oldestInvoiceDate || '', c.daysOutstanding || ''];
      const merchantRow = [
        m?.storeId || '',
        m?.storeName || '',
        m?.phone || '',
        m?.billingType || '',
        m?.platformStatus || '',
        m ? Number(m.walletBalance || 0).toFixed(2) : '',
        m?.lastShipmentAt ? new Date(m.lastShipmentAt).toLocaleDateString('en-CA') : '',
        c.anomaly ? anomalyLabel(c.anomaly) : '',
        linkStatusFor(c),
        c.merchantMatch?.confidence != null ? `${Math.round(c.merchantMatch.confidence * 100)}%` : '',
      ];
      return [...baseRow, ...merchantRow];
    });

    const sumSlice = visibleCustomers.reduce((s, c) => s + (c.filteredTotal || 0), 0);
    const sumTotal = visibleCustomers.reduce((s, c) => s + (c.total || 0), 0);
    const linked = visibleCustomers.filter(c => c.merchant).length;
    const totalRowBase = bucketActive
      ? ['الإجمالي', sumSlice.toFixed(2), sumTotal.toFixed(2), '', '', '']
      : ['الإجمالي', sumTotal.toFixed(2), '', '', ''];
    const totalRow = [...totalRowBase, '', '', '', '', '', '', '', '', `${linked} / ${visibleCustomers.length} مرتبط`, ''];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, [], totalRow]);
    const colWidths = bucketActive
      ? [{ wch: 50 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
      : [{ wch: 50 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 20 }];
    ws['!cols'] = [
      ...colWidths,
      { wch: 14 }, // store id
      { wch: 28 }, // store name
      { wch: 16 }, // phone
      { wch: 14 }, // billing
      { wch: 14 }, // status
      { wch: 14 }, // wallet
      { wch: 14 }, // last shipment
      { wch: 26 }, // anomaly
      { wch: 18 }, // link status
      { wch: 10 }, // confidence
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مديونيات العملاء');
    const dateStr = new Date().toISOString().slice(0, 10);
    // §1.13: عبر السجل (كان XLSX.writeFile خاماً)
    persistAndDownloadExport({ wb: rtl(wb), fileName: `مديونيات_العملاء_${dateStr}.xlsx`,
      kind: 'receivables', rowCount: visibleCustomers.length, total: null, userId: user?.id || null })
      .then(() => toast(`تم تصدير ${visibleCustomers.length} عميل (${linked} مرتبط بمتجر)`, 'success'))
      .catch(e => toast(`فشل التصدير: ${e.message}`, 'error'));
  };

  // تصدير ملف متابعة مبني على مرجع الدين الحالي (Zoho) + دليل المتاجر.
  // يمرّ عبر persistAndDownloadExport (تخزين + سجل، §1.13) بدل XLSX.writeFile المباشر.
  const handleCollectionExport = async () => {
    if (!visibleCustomers.length) {
      toast('لا توجد بيانات للتصدير', 'info');
      return;
    }
    const today = new Date(); today.setHours(0,0,0,0);
    // When an aging-bucket filter is active, the collection amount must be
    // the slice WITHIN the selected buckets, not the customer's full
    // balance — otherwise a "+90 day" campaign shows the whole debt.
    const bucketActive = bucketFilters.size > 0;
    const amtOf = (c) => bucketActive ? (c.filteredTotal || 0) : (c.total || 0);
    const amtHeader = bucketActive ? 'المبلغ في الشريحة (ر.س)' : 'الإجمالي (ر.س)';
    const headers = [
      'اسم المتجر', 'هاتف', 'نوع الفوترة', 'الحالة في المنصّة',
      amtHeader, 'عدد الفواتير', 'أقدم فاتورة', 'الأيام',
      'آخر شحنة', 'الأيام منذ آخر شحنة', 'الرصيد في المحفظة',
      'حالة الربط', 'ملاحظة',
    ];
    const rows = visibleCustomers.map(c => {
      const m = c.merchant;
      const daysSinceShip = m?.lastShipmentAt
        ? Math.floor((today - new Date(m.lastShipmentAt)) / 86_400_000)
        : '';
      return [
        m?.storeName || c.name,
        m?.phone || '',
        m?.billingType || '',
        m?.platformStatus || '',
        Number(amtOf(c)).toFixed(2),
        c.invoiceCount || 0,
        c.oldestInvoiceDate || '',
        c.daysOutstanding || '',
        m?.lastShipmentAt ? new Date(m.lastShipmentAt).toLocaleDateString('en-CA') : '',
        daysSinceShip,
        m ? Number(m.walletBalance || 0).toFixed(2) : '',
        c.anomaly ? anomalyLabel(c.anomaly) : (m ? 'مرتبط' : 'غير مرتبط بمتجر'),
        c.notes || '',
      ];
    });
    const totalDebt = visibleCustomers.reduce((s, c) => s + amtOf(c), 0);
    const footer = ['الإجمالي', '', '', '', totalDebt.toFixed(2), '', '', '', '', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, [], footer]);
    ws['!cols'] = [
      { wch: 40 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 10 },
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 30 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'متابعة العملاء');
    const dateStr = new Date().toISOString().slice(0, 10);
    try {
      await persistAndDownloadExport({
        wb, fileName: `متابعة_مديونيات_العملاء_${dateStr}.xlsx`,
        kind: 'internal_watchlist', rowCount: visibleCustomers.length,
        total: +totalDebt.toFixed(2), userId: user?.id || null,
      });
      toast(`صُدّر ${visibleCustomers.length} عميل من مرجع زوهو/المتاجر، محفوظ في السجل`, 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  // Stop-list export — the 🛑 "suspend before debt grows" customers, with
  // the risk score + stop reason so the team can action them directly.
  const handleExportStopList = () => {
    if (!stopNow.length) { toast('لا توجد قائمة إيقاف', 'info'); return; }
    const headers = ['اسم المتجر', 'الهاتف', 'الدين (ر.س)', 'الأيام', 'أولوية المتابعة', 'سبب الإيقاف', 'نوع الفوترة', 'الحالة', 'آخر شحنة'];
    const rows = stopNow.map(c => {
      const m = c.merchant;
      return [
        m?.storeName || c.name,
        m?.phone || '',
        Number(c.total || 0).toFixed(2),
        c.daysOutstanding || '',
        c.risk?.score ?? '',
        c.risk?.stopReason || '',
        m?.billingType || '',
        m?.platformStatus || '',
        m?.lastShipmentAt ? new Date(m.lastShipmentAt).toLocaleDateString('en-CA') : '',
      ];
    });
    const total = stopNow.reduce((s, c) => s + (Number(c.total) || 0), 0);
    const footer = ['الإجمالي', '', total.toFixed(2), '', '', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, [], footer]);
    ws['!cols'] = [{ wch: 40 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'قائمة الإيقاف');
    persistAndDownloadExport({ wb: rtl(wb), fileName: `قائمة_الإيقاف_${new Date().toISOString().slice(0, 10)}.xlsx`,
      kind: 'stop_list', rowCount: stopNow.length, total: null, userId: user?.id || null })
      .then(() => toast(`تم تصدير ${stopNow.length} عميل للإيقاف`, 'success'))
      .catch(e => toast(`فشل التصدير: ${e.message}`, 'error'));
  };


  const handleShowHistory = async () => {
    try {
      const list = await loadReceivablesSnapshots();
      setHistory(list);
      setShowHistory(true);
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const handleSyncZoho = async () => {
    setSyncingZoho(true);
    try {
      const res = await syncZohoDocs();
      const count = res?.results?.invoices;
      toast(count != null ? `تمت مزامنة فواتير زوهو: ${count}` : 'تمت مزامنة زوهو', 'success');
      await refresh();
    } catch (e) {
      toast(`فشلت مزامنة زوهو: ${e.message}`, 'error');
    } finally {
      setSyncingZoho(false);
    }
  };

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Users size={22}/>}
        title="مديونيات العملاء"
        subtitle={loading
          ? 'جارٍ التحميل…'
          : data?.customerCount
            ? `${data.customerCount} عميل من ${receivablesSourceLabel(data.snapshot)}`
            : 'لا توجد بيانات بعد'}
        meta={receivablesMeta(data?.snapshot)}
        actions={
          <>
            <Btn size="sm" variant="ghost" icon={<ChevronDown size={14}/>} onClick={handleShowHistory}>
              سجل الرفعات القديمة
            </Btn>
            <Btn size="sm" variant="ghost" icon={<Download size={14}/>} onClick={handleExport} disabled={!visibleCustomers.length}>
              تصدير
            </Btn>
            <Btn size="sm" variant="ghost" icon={<Download size={14}/>} onClick={handleCollectionExport} disabled={!visibleCustomers.length}
              title="قائمة فرز مبنية على نفس مرجع مديونيات العملاء الحالي">
              ملف الحملة
            </Btn>
          </>
        }
      />
      <DataConfidenceBar
        active={isActive}
        sourceLabel={receivablesSourceLabel(data?.snapshot)}
        snapshotMeta={receivablesMeta(data?.snapshot)}
        canSync={can?.('money.pnl')}
        syncing={syncingZoho}
        refreshing={loading}
        onSync={handleSyncZoho}
        onRefresh={refresh}
        sourcePath="/zoho-data?type=invoices"
      />
      <Hero
        total={data?.total || 0}
        overdueTotal={data ? (data.aging.d31_60 + data.aging.d61_90 + data.aging.d90_plus) : 0}
        customerCount={data?.customerCount || 0}
        snapshot={data?.snapshot}
        oldestDays={oldestDays}
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size={28}/></div>
      ) : !data?.customerCount ? (
        <Card>
          <Empty
            icon="💰"
            title="لا توجد فواتير مفتوحة"
            sub="زامن Zoho Books أولاً. مديونيات العملاء تأتي من زوهو API فقط."
          />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <Btn size="md" variant="primary" icon={<RefreshCw size={14} className={syncingZoho ? 'spin' : ''}/>} onClick={handleSyncZoho} disabled={syncingZoho}>
              مزامنة زوهو
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          {/* ── Merchant-link status banner ──────────────────────────
              Tells the operator at-a-glance how many of their receivables
              customers are linked to a platform store. Click to jump
              to /merchants where the auto-link button + unmatched
              modal live. Hidden when 100% of customers are linked. */}
          {(() => {
            const all = data.customers || [];
            if (!all.length) return null;
            const linked = all.filter(c => c.merchant).length;
            const unlinked = all.length - linked;
            const pct = Math.round((linked / all.length) * 100);
            if (unlinked === 0) {
              return (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 18px', marginBottom: 16,
                  background: 'rgba(16,185,129,.08)',
                  borderRadius: 12,
                }}>
                  <CheckCircle2 size={18} color="var(--green)"/>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>
                    كل العملاء ({all.length}) مرتبطون بمتاجرهم على المنصّة — التصدير يحتوي معلومات المتجر الكاملة.
                  </span>
                </div>
              );
            }
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 18px', marginBottom: 16,
                background: linked === 0 ? 'rgba(239,68,68,.06)' : 'rgba(245,158,11,.08)',
                borderRadius: 12,
              }}>
                <AlertTriangle size={18} color={linked === 0 ? 'var(--red)' : 'var(--gold)'}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                    {linked} من {all.length} عميل مرتبط بمتجر <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({pct}%)</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {unlinked} عميل بدون متجر — التصدير سيظهر الأعمدة فارغة لهم. اربطهم يدوياً للحصول على هاتف + نوع فوترة + حالة كل عميل.
                  </div>
                </div>
                <Btn size="md" variant="primary" onClick={() => navigate('/merchants')}>
                  افتح صفحة المتاجر
                </Btn>
              </div>
            );
          })()}

          <AgingGrid aging={data.aging} total={data.total}/>

          {/* Tabs */}
          <Card style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 0, padding: 6, background: 'var(--surface)', flexWrap: 'wrap' }}>
              <Tab
                id="active" label="كل العملاء"
                count={data.activeCustomers?.length || 0}
                amount={data.total}
                active={tab === 'active'} onClick={setTab}
              />
              <Tab
                id="anomalies" label="🚨 تنبيهات"
                count={anomalies.length}
                amount={anomalies.reduce((s, c) => s + (c.total || 0), 0)}
                active={tab === 'anomalies'} onClick={setTab}
                accent={anomalies.length > 0 ? '#EF4444' : null}
              />
              <Tab
                id="excluded" label="🛡 مخفيون من الإجماليات"
                count={data.excludedCustomers?.length || 0}
                amount={data.excludedTotal}
                active={tab === 'excluded'} onClick={setTab}
              />
            </div>
          </Card>

          {/* Anomalies breakdown — visible only when on the alerts tab.
              Shows 5 type-tiles in a row, each clickable to filter the
              table to just that anomaly type. Counts + total debt per
              bucket so the operator can triage by financial impact. */}
          {/* "Stop now" banner — the prevent-accumulation action list. */}
          {tab === 'anomalies' && stopNow.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <button
                onClick={() => { setStopOnly(v => !v); setAnomalyFilter(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 240,
                  textAlign: 'right', padding: '12px 16px',
                  borderRadius: 12, cursor: 'pointer',
                  border: `1.5px solid ${stopOnly ? 'var(--red)' : 'rgba(220,38,38,.35)'}`,
                  background: stopOnly ? 'rgba(220,38,38,.12)' : 'rgba(220,38,38,.06)',
                }}
                title="عملاء نشطون بدفع لاحق ودينهم متأخّر/تجاوز الحد — أوقفهم قبل ما يكبر الدين"
              >
                <span style={{ fontSize: 22 }}>🛑</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--red)' }}>
                    يُوقَف الآن — {stopNow.length} عميل نشط يتراكم دينه
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                    إجمالي دينهم {fmt(stopNow.reduce((s, c) => s + (Number(c.total) || 0), 0))} ر.س — أوقفهم قبل ما يكبر
                  </div>
                </div>
                <span style={{
                  fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 999,
                  background: stopOnly ? 'var(--red)' : 'rgba(220,38,38,.15)',
                  color: stopOnly ? '#fff' : 'var(--red)', whiteSpace: 'nowrap',
                }}>
                  {stopOnly ? '✓ معروضون' : 'اعرضهم'}
                </span>
              </button>
              <Btn
                size="sm" variant="ghost"
                icon={<Download size={15}/>}
                onClick={handleExportStopList}
                title="تصدير قائمة الإيقاف إلى Excel (الاسم · الهاتف · الدين · الخطر · السبب)"
              >
                تصدير القائمة
              </Btn>
            </div>
          )}

          {tab === 'anomalies' && anomalies.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10, marginBottom: 14,
            }}>
              {Object.entries(anomalyBreakdown).map(([key, list]) => {
                const meta = ANOMALY_META[key];
                if (!meta || list.length === 0) return null;
                // negative_wallet aggregates by wallet balance (phantom
                // entries have 0 debt); other buckets aggregate by debt.
                const total = key === 'negative_wallet'
                  ? list.reduce((s, c) => s + Math.abs(Number(c.merchant?.walletBalance) || 0), 0)
                  : list.reduce((s, c) => s + (Number(c.total) || 0), 0);
                const isActive = anomalyFilter === key;
                return (
                  <div
                    key={key}
                    onClick={() => setAnomalyFilter(isActive ? null : key)}
                    style={{
                      background: isActive ? `color-mix(in srgb, ${meta.color} 8%, var(--card))` : 'var(--card)',
                      borderRadius: 'var(--r-lg)',
                      padding: '16px 18px',
                      boxShadow: isActive ? `0 0 0 2px ${meta.color}, var(--shadow-sm)` : 'var(--shadow-sm)',
                      borderRight: `3px solid ${meta.color}`,
                      cursor: 'pointer',
                      transition: 'background .15s, box-shadow .15s, transform .15s',
                      transform: isActive ? 'translateY(-1px)' : 'none',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {meta.label}
                      </span>
                      <span style={{
                        minWidth: 24, height: 24, borderRadius: 999,
                        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                        color: meta.color,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
                        padding: '0 7px',
                      }}>{list.length}</span>
                    </div>
                    <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 700, color: meta.color, letterSpacing: -0.3, lineHeight: 1 }}>
                      {fmt(total)}
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4, fontWeight: 500 }}> ر.س</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                      {meta.hint}
                    </div>
                    <div style={{ fontSize: 10.5, color: isActive ? meta.color : 'var(--muted2)', marginTop: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isActive ? '✓ مفعّل — اضغط للإلغاء' : 'اضغط لتصفية الجدول'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Filter bar */}
          <Card style={{ padding: 12, marginBottom: 12 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px,1fr) auto auto auto auto',
              gap: 8, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Search size={14} color="var(--muted)"/>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="بحث باسم العميل…"
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 7, fontSize: 12, minWidth: 0 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)' }}>
                <span style={{ whiteSpace: 'nowrap' }}>أكثر من</span>
                <input
                  type="number" value={minBalance} onChange={e => setMinBalance(e.target.value)}
                  placeholder="0"
                  style={{ width: 90, padding: '7px 8px', borderRadius: 7, fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'left' }}
                />
                <span style={{ whiteSpace: 'nowrap' }}>ر.س</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)' }}>
                <span style={{ whiteSpace: 'nowrap' }}>أقدم من</span>
                <input
                  type="number" value={minDays} onChange={e => setMinDays(e.target.value)}
                  placeholder="0"
                  style={{ width: 70, padding: '7px 8px', borderRadius: 7, fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'left' }}
                />
                <span style={{ whiteSpace: 'nowrap' }}>يوم</span>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {[
                  { k: 'd0_30',    l: '0–30',  c: 'var(--green)' },
                  { k: 'd31_60',   l: '31–60', c: 'var(--gold)' },
                  { k: 'd61_90',   l: '61–90', c: '#F97316' },
                  { k: 'd90_plus', l: '+90',   c: '#EF4444' },
                ].map(b => {
                  const on = bucketFilters.has(b.k);
                  return (
                    <button key={b.k} onClick={() => toggleBucket(b.k)} style={{
                      padding: '4px 9px', borderRadius: 12,
                      background: on ? `${b.c}20` : 'var(--surface)',
                      color: on ? b.c : 'var(--muted)',
                      border: `1px solid ${on ? `${b.c}80` : 'var(--border)'}`,
                      fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}>
                      {b.l}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px', borderRadius: 11,
                  background: hasFilters ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface)',
                  border: `1px solid ${hasFilters ? 'color-mix(in srgb, var(--accent) 32%, transparent)' : 'var(--border)'}`,
                  fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  color: hasFilters ? 'var(--accent)' : 'var(--muted)',
                  whiteSpace: 'nowrap',
                }}>
                  {visibleCustomers.length} عميل
                  <span style={{ opacity: .55 }}>·</span>
                  {fmt(visibleCustomers.reduce(
                    (s, c) => s + (bucketFilters.size > 0 ? (c.filteredTotal || 0) : (c.total || 0)), 0,
                  ))} ر.س
                </span>
                {hasFilters && (
                  <Btn size="sm" variant="ghost" icon={<X size={12}/>} onClick={clearFilters} title="مسح الفلاتر">
                    مسح
                  </Btn>
                )}
              </div>
            </div>
          </Card>

          {/* Table */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-flow" style={{ maxHeight: 600, overflowY: 'auto' }}>
              <table className="m-compact" style={{ fontSize: 12, width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                  <tr>
                    <th onClick={() => handleSort('name')} style={thStyle}>
                      العميل {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSort('total')} style={{ ...thStyle, textAlign: 'left' }}>
                      الإجمالي (ر.س) {sortBy === 'total' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSort('invoices')} style={{ ...thStyle, textAlign: 'center' }}>
                      الفواتير {sortBy === 'invoices' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={thStyle}>أقدم فاتورة</th>
                    <th onClick={() => handleSort('oldest')} style={{ ...thStyle, textAlign: 'center' }}>
                      الأيام {sortBy === 'oldest' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ ...thStyle, width: 80, textAlign: 'center', cursor: 'default' }}>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCustomers.map(c => {
                    const ageColor =
                      c.daysOutstanding == null ? 'var(--muted)'
                      : c.daysOutstanding > 90 ? '#EF4444'
                      : c.daysOutstanding > 60 ? '#F97316'
                      : c.daysOutstanding > 30 ? 'var(--gold)'
                      : 'var(--green)';
                    const isExcluded = c.status === 'excluded';
                    const m = c.merchant;
                    // Pick a tinted row background based on anomaly tag.
                    const anomalyTint = c.anomaly === 'negative_wallet'    ? 'rgba(220,38,38,.08)'
                      : c.anomaly === 'prepaid_with_debt'   ? 'rgba(239,68,68,.06)'
                      : c.anomaly === 'active_with_debt'    ? 'rgba(249,115,22,.06)'
                      : c.anomaly === 'postpaid_overdue'    ? 'rgba(245,158,11,.06)'
                      : c.anomaly === 'inactive_with_debt'  ? 'rgba(122,130,196,.06)'
                      : null;
                    const baseBg = anomalyTint || (isExcluded ? 'color-mix(in srgb, var(--accent) 4%, transparent)' : undefined);
                    return (
                      <tr
                        key={c.name}
                        onClick={() => setOpenCustomer(c)}
                        style={{ cursor: 'pointer', background: baseBg }}
                        onMouseEnter={e => e.currentTarget.style.background = anomalyTint ? anomalyTint.replace('.06','.12') : isExcluded ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface)'}
                        onMouseLeave={e => e.currentTarget.style.background = baseBg || ''}
                      >
                        <td style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {isExcluded && <ShieldCheck size={12} color="var(--accent)"/>}
                            <span>{m?.storeName || c.name}</span>
                            {/* Risk score badge — only on the alerts tab where it's computed */}
                            {c.risk && (
                              <span
                                title={`درجة الخطر ${c.risk.score}/100 — ${c.risk.reasons.map(r => r.label).join('، ')}`}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 3,
                                  padding: '1px 7px', borderRadius: 9, fontSize: 9.5, fontWeight: 700,
                                  fontFamily: 'var(--font-mono)',
                                  background: `color-mix(in srgb, ${c.risk.level.color} 14%, transparent)`,
                                  color: c.risk.level.color,
                                  border: `1px solid color-mix(in srgb, ${c.risk.level.color} 35%, transparent)`,
                                }}>
                                {c.risk.shouldStop && '🛑 '}خطر {c.risk.score}
                              </span>
                            )}
                            {/* Merchant info chips — only when linked */}
                            {m && (
                              <>
                                {m.billingType === 'دفع لاحق' && (
                                  <span style={miniChip('var(--gold)')} title="نوع الفوترة">📋 لاحق</span>
                                )}
                                {m.billingType === 'دفع مسبق' && (
                                  <span style={miniChip('#3B82F6')} title="نوع الفوترة">💳 مسبق</span>
                                )}
                                {m.platformStatus === 'غير نشط' && (
                                  <span style={miniChip('var(--muted)')} title="حالة المتجر">○ غير نشط</span>
                                )}
                                {m.phone && (
                                  <span style={{
                                    fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', direction: 'ltr',
                                  }} title="هاتف">{m.phone}</span>
                                )}
                              </>
                            )}
                            {/* Anomaly badge(s) — primary + extras in one row */}
                            {c.anomaly && (
                              <span style={anomalyChip(c.anomaly)} title={anomalyHint(c.anomaly)}>
                                {anomalyLabel(c.anomaly)}
                              </span>
                            )}
                            {c.anomalyExtras?.map(a => (
                              <span key={a} style={anomalyChip(a)} title={anomalyHint(a)}>
                                {anomalyLabel(a)}
                              </span>
                            ))}
                            {c.notes && (
                              <span title={c.notes} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                padding: '1px 6px', borderRadius: 9,
                                background: 'rgba(122,130,196,.10)',
                                color: 'var(--muted)',
                                border: '1px solid var(--border)',
                                fontSize: 9.5, fontFamily: 'var(--font-mono)',
                              }}>
                                <MessageSquare size={9}/>
                                ملاحظة
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'left', fontWeight: 700 }}>
                          {bucketFilters.size > 0 ? (
                            <>
                              <div>{fmt(c.filteredTotal)}</div>
                              <div style={{ fontSize: 9.5, color: 'var(--muted)', fontWeight: 500, marginTop: 1 }}>
                                من {fmt(c.total)}
                              </div>
                            </>
                          ) : (
                            fmt(c.total)
                          )}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                          {c.invoiceCount}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {fmtDate(c.oldestInvoiceDate)}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: ageColor, fontWeight: 700 }}>
                          {c.daysOutstanding != null ? `${c.daysOutstanding} يوم` : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          {isExcluded ? (
                            <button
                              onClick={() => setTagModal({ customer: c, mode: 'restore' })}
                              title="إرجاع للمتابعة الافتراضية"
                              style={tagBtnStyle('restore')}
                            >
                              <EyeOff size={11}/>
                              إرجاع
                            </button>
                          ) : (
                            <button
                              onClick={() => setTagModal({ customer: c, mode: 'exclude' })}
                              title="نقل لمتابعة خاصة (يخرج من الإجماليات)"
                              style={tagBtnStyle('exclude')}
                            >
                              <ShieldCheck size={11}/>
                              إخفاء من الإجماليات
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Drawer for one customer's invoices */}
      <CustomerDrawer
        customer={openCustomer}
        allCustomers={data?.customers || []}
        allMerchants={merchants}
        onSelect={(c) => setOpenCustomer(c)}
        onClose={() => setOpenCustomer(null)}
      />

      {/* Tag modal — exclude / restore + optional note */}
      {tagModal && (
        <TagCustomerModal
          customer={tagModal.customer}
          mode={tagModal.mode}
          onClose={() => setTagModal(null)}
          onSubmit={(notes) => handleTagCustomer(
            tagModal.customer.name,
            tagModal.mode === 'exclude' ? 'excluded' : 'normal',
            notes,
          )}
        />
      )}

      {/* Snapshot history modal */}
      {showHistory && (
      <Modal title="سجل الرفعات القديمة" onClose={() => setShowHistory(false)} width={620}>
          {history.length === 0
            ? <Empty icon="📁" title="لا توجد رفعات قديمة بعد"/>
            : (
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {history.map(s => (
                  <div key={s.snapshotId} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto',
                    gap: 10, alignItems: 'center',
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 12,
                  }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s.snapshotId}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        {fmtDate(s.uploadedAt)} · {s.sourceFile || '—'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 70 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s.customerCount}</div>
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>عميل</div>
                    </div>
                    <div style={{ textAlign: 'left', minWidth: 100 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
                        {fmt(s.total)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>ر.س</div>
                    </div>
                    <Btn
                      size="sm" variant="ghost"
                      icon={<Trash2 size={12}/>}
                      onClick={async () => {
                        try {
                          await deleteReceivablesSnapshot(s.snapshotId);
                          toast('تم حذف اللقطة', 'success');
                          handleShowHistory();
                          refresh();
                        } catch (e) { toast(e.message, 'error'); }
                      }}
                      style={{ color: 'var(--red)' }}
                    />
                  </div>
                ))}
              </div>
            )}
        </Modal>
      )}

    </div>
  );
}

const thStyle = {
  textAlign: 'right',
  padding: '8px 12px',
  fontSize: 10.5,
  fontWeight: 700,
  color: 'var(--muted)',
  fontFamily: 'var(--font-mono)',
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  cursor: 'pointer',
  userSelect: 'none',
};

function miniChip(color) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '1px 6px', borderRadius: 9,
    background: color === 'var(--muted)' ? 'var(--surface)' : `${color}18`,
    color,
    border: `1px solid ${color === 'var(--muted)' ? 'var(--border)' : color + '40'}`,
    fontSize: 9.5, fontFamily: 'var(--font-mono)', fontWeight: 700,
    whiteSpace: 'nowrap',
  };
}

const ANOMALY_META = {
  negative_wallet:     { color: 'var(--red)', label: '💥 رصيد محفظة سالب',       hint: 'متجر دفع مسبق ورصيده ناقص — خطأ تقني، سُمح بشحن على الـ credit بدون رصيد' },
  prepaid_with_debt:   { color: '#EF4444', label: '🚨 دفع مسبق وعليه دين',    hint: 'متجر يدفع من المحفظة لكن عليه فواتير — احتمال خطأ تقني، يحتاج تحقق' },
  active_with_debt:    { color: '#F97316', label: '🔥 يشحن الآن وعليه دين',   hint: 'العميل لا يزال يشحن (آخر شحنة خلال 10 أيام) — اتصل عليه اليوم قبل ما يتراكم أكثر' },
  postpaid_overdue:    { color: 'var(--gold)', label: '⏰ متأخر +60 يوم',          hint: 'متجر دفع لاحق متأخر — مرشّح للإيقاف بعد تنبيه' },
  inactive_with_debt:  { color: '#7A82C4', label: '😴 موقوف وعليه دين',        hint: 'متجر غير نشط لكن عليه مديونية — حصّل قبل الإغلاق النهائي' },
  over_credit_limit:   { color: '#B91C1C', label: '🛑 تجاوز السقف الائتماني',   hint: 'تجاوز رصيد العميل سقفه الائتماني (الافتراضي 10,000 ر.س) — يحتاج وقف الخدمة أو رفع السقف' },
};
function anomalyChip(kind) {
  const m = ANOMALY_META[kind]; if (!m) return {};
  return {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '2px 8px', borderRadius: 10,
    background: m.color + '20', color: m.color, border: `1px solid ${m.color}50`,
    fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
  };
}
function anomalyLabel(kind) { return ANOMALY_META[kind]?.label || kind; }
function anomalyHint(kind)  { return ANOMALY_META[kind]?.hint  || ''; }

function tagBtnStyle(kind) {
  const isExclude = kind === 'exclude';
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px',
    borderRadius: 8,
    background: isExclude ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'rgba(122,130,196,.10)',
    color:      isExclude ? 'var(--accent)'        : 'var(--muted)',
    border: `1px solid ${isExclude ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--border2)'}`,
    fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
