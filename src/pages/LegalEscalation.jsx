// «/legal» — التصعيد القانوني. سؤال واحد: مَن يجب تحويله للقانونية الآن؟
//  (١) أهداف الأعمار: 31–60 ≤ 50ألف · 61–90 ≤ 25ألف · 91+ = صفر (بطاقات هدف).
//  (٢) 🚨 تجاوز 90 يوم (فواتير زوهو) → تحويل فوري.
//  (٣) 🚨 دفع مسبق برصيد محفظة سالب (المنصّة) → تحويل فوري.
// المصدر: RPC legal_escalation_dashboard (المرآة المحلية). تصدير «ملف القانونية».
import { useState, useEffect } from 'react';
import { Scale, RefreshCw, Phone, MessageCircle, Download, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { persistAndDownloadExport } from '../lib/internalExportsService.js';
import { Card, Btn, Spinner, Empty, toast, PageHeader } from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { loadLegalDashboard } from '../lib/legalService.js';
import WaActions from '../components/WaActions.jsx';
import WhatsAppSendModal from '../components/WhatsAppSendModal.jsx';
import { normalizeSaudiPhone } from '../lib/whatsappService.js';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : '';

// خانة تواصل موحّدة: اتصال + إطلاق حملة (الفعل الرئيسي) + محادثة ثانوية (§هيكلة-0)
function PhoneCell({ phone, name, amount, count }) {
  if (!phone) return <span style={{ fontSize: 11, color: 'var(--muted2)' }}>لا هاتف</span>;
  return <WaActions phone={phone} name={name} amount={amount} count={count}
    vars={[name || '', fmt(amount), String(count ?? '')]} campaignLabel="التصعيد القانوني" size={14}/>;
}

// بطاقة هدف عمر: فعليّ مقابل هدف (أخضر تحت الهدف، أحمر فوقه)
function TargetCard({ label, actual, target, zeroTarget }) {
  const over = zeroTarget ? actual > 0.5 : actual > target + 0.5;
  const color = over ? 'var(--red)' : 'var(--green)';
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : (actual > 0.5 ? 100 : 0);
  return (
    <div style={{ border: `1.5px solid color-mix(in srgb, ${color} 35%, var(--border))`, borderRadius: 12, padding: '12px 14px',
      background: `color-mix(in srgb, ${color} 6%, transparent)` }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', color, lineHeight: 1.25 }}>{fmt0(actual)}</div>
      <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>
        الهدف: {zeroTarget ? 'صفر ر.س' : `≤ ${fmt0(target)} ر.س`} · {over ? '🚨 تجاوز' : '✅ ضمن الهدف'}
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden', marginTop: 7 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .3s' }}/>
      </div>
    </div>
  );
}

export default function LegalEscalation({ isActive = true }) {
  const { can, user } = useAuth();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  // حملة مطالبة جماعية لأصحاب المحافظ السالبة (فحص الوكلاء: الـ23 وصلتهم رسالة
  // مبيعات بدل المطالبة — هذا الزر يوجّه المطالبة الصحيحة للقائمة كلها دفعة واحدة)
  const [walletWaOpen, setWalletWaOpen] = useState(false);
  const walletRecipients = (d?.prepaidNegative || [])
    .filter(r => r.phone)
    .map(r => {
      const amt = Math.abs(Number(r.wallet) || 0);
      return {
        to: normalizeSaudiPhone(r.phone), name: r.storeName, amount: amt,
        vars: [r.storeName || '', fmt(amt), ''],
        fields: { name: r.storeName, amount: amt, wallet: r.wallet, last_shipment: r.lastShipmentAt },
      };
    });

  const refresh = async () => {
    setBusy(true);
    try { setD(await loadLegalDashboard()); }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); setD(prev => prev || { aging: {}, overdue90: [], prepaidNegative: [] }); }
    setBusy(false);
  };
  useEffect(() => { if (isActive && d == null) refresh(); }, [isActive]); // eslint-disable-line

  const exportLegal = async () => {
    if (!d) return;
    const wb = XLSX.utils.book_new();
    // ورقة ١: تجاوز 90 يوم
    const s1 = [
      ['عملاء تجاوزوا 90 يوماً — تحويل للقانونية', '', new Date().toISOString().slice(0, 10)],
      [],
      ['العميل', 'المتجر', 'الهاتف', 'مبلغ +90 يوم', 'إجمالي المفتوح', 'أقدم (يوم)', 'عدد الفواتير'],
      ...d.overdue90.map(r => [r.name, r.storeName, r.phone, r.amount90, r.totalOpen, r.oldestDays, r.invCnt]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(s1);
    ws1['!cols'] = [{ wch: 34 }, { wch: 22 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'تجاوز 90 يوم');
    // ورقة ٢: دفع مسبق برصيد سالب
    const s2 = [
      ['دفع مسبق برصيد محفظة سالب — تحويل للقانونية', '', new Date().toISOString().slice(0, 10)],
      [],
      ['المتجر', 'الهاتف', 'رصيد المحفظة', 'الحالة', 'آخر شحنة', 'أيام منذ آخر شحنة'],
      ...d.prepaidNegative.map(r => [r.storeName, r.phone, r.wallet, r.status,
        r.lastShipmentAt ? new Date(r.lastShipmentAt).toLocaleDateString('en-CA') : '', daysSince(r.lastShipmentAt)]),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'محفظة سالبة');
    try {
      await persistAndDownloadExport({
        wb, fileName: `ملف_القانونية_${new Date().toISOString().slice(0, 10)}.xlsx`,
        kind: 'legal', rowCount: d.overdue90.length + d.prepaidNegative.length, userId: user?.id || null,
      });
      toast('صُدّر ملف القانونية ✓ (محفوظ في السجل)', 'success');
    } catch (e) { toast(`فشل التصدير: ${e.message}`, 'error'); }
  };

  if (!can('legal.view') && !can('receivables.view')) return <div style={{ padding: 40 }}><Empty icon="🔒" title="لا صلاحية" sub="تحتاج صلاحية «عرض المديونيات»"/></div>;
  if (d == null) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={26}/></div>;

  const ag = d.aging;
  const totalEscalate = d.overdue90.length + d.prepaidNegative.length;

  return (
    <div style={{ padding: '18px 20px 80px', maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader icon={<Scale size={22}/>} iconColor="var(--red)"
        title="التصعيد القانوني"
        subtitle="أهداف أعمار الديون + مَن يجب تحويله للقانونية فوراً"
        actions={
          <>
            <Btn size="sm" variant="ghost" icon={<Download size={13}/>} onClick={exportLegal} disabled={!totalEscalate}>ملف القانونية</Btn>
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={14} className={busy ? 'spin' : ''}/>} onClick={refresh} disabled={busy}>تحديث</Btn>
          </>
        }/>

      {/* ── أهداف الأعمار ── */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '4px 0 8px' }}>🎯 أهداف أعمار الديون (فواتير زوهو المفتوحة)</div>
      <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 18 }}>
        <TargetCard label="31 – 60 يوم" actual={ag.b31_60} target={ag.t31_60}/>
        <TargetCard label="61 – 90 يوم" actual={ag.b61_90} target={ag.t61_90}/>
        <TargetCard label="91 يوم فأكثر" actual={ag.b90plus} target={ag.t90plus} zeroTarget/>
      </div>

      {/* ── 🚨 تجاوز 90 يوم ── */}
      <SectionHeader icon="🚨" title={`تجاوز 90 يوم — تحويل فوري للقانونية (${d.overdue90.length})`}
        note="فواتير عمرها +90 يوم في زوهو (الهدف صفر)"/>
      {!d.overdue90.length ? <Card style={{ marginBottom: 18 }}><Empty icon="✅" title="لا أحد تجاوز 90 يوم" sub="الهدف محقّق"/></Card> : (
        <Card style={{ padding: 0, marginBottom: 18, overflow: 'hidden', border: '1.5px solid color-mix(in srgb, var(--red) 25%, var(--border))' }}>
          <div className="m-flow" style={{ overflowX: 'auto' }}>
            <table className="m-cards" style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--surface)' }}>
                <tr>{['العميل', 'مبلغ +90 يوم', 'إجمالي المفتوح', 'أقدم (يوم)', 'فواتير', 'تواصل'].map(h => (
                  <th key={h} style={{ padding: '9px 12px', fontSize: 11, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {d.overdue90.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td data-label="" style={{ padding: '9px 12px', fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.storeName || r.name}
                    </td>
                    <td data-label="مبلغ +90 يوم" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--red)', whiteSpace: 'nowrap' }}>{fmt(r.amount90)}</td>
                    <td data-label="إجمالي المفتوح" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmt(r.totalOpen)}</td>
                    <td data-label="أقدم (يوم)" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', color: 'var(--red)', whiteSpace: 'nowrap' }}>{r.oldestDays}</td>
                    <td data-label="فواتير" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.invCnt}</td>
                    <td data-label="تواصل" style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}><PhoneCell phone={r.phone} name={r.storeName || r.name} amount={r.totalOpen} count={r.invCnt}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── 🚨 دفع مسبق برصيد سالب ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <SectionHeader icon="🚨" title={`دفع مسبق برصيد سالب — تحويل فوري للقانونية (${d.prepaidNegative.length})`}
            note="متاجر شحنت أكثر من رصيدها (المحفظة سالبة) — من كشف المنصّة"/>
        </div>
        {can('campaigns.send') && walletRecipients.length > 0 && (
          <Btn size="sm" variant="accent" icon={<MessageCircle size={13}/>} onClick={() => setWalletWaOpen(true)}>
            حملة مطالبة للكل ({walletRecipients.length})
          </Btn>
        )}
      </div>
      {!d.prepaidNegative.length ? <Card><Empty icon="✅" title="لا محافظ سالبة" sub="كل الدفع المسبق موجب"/></Card> : (
        <Card style={{ padding: 0, overflow: 'hidden', border: '1.5px solid color-mix(in srgb, var(--red) 25%, var(--border))' }}>
          <div className="m-flow" style={{ overflowX: 'auto' }}>
            <table className="m-cards" style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--surface)' }}>
                <tr>{['المتجر', 'رصيد المحفظة', 'الحالة', 'آخر شحنة', 'تواصل'].map(h => (
                  <th key={h} style={{ padding: '9px 12px', fontSize: 11, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {d.prepaidNegative.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td data-label="" style={{ padding: '9px 12px', fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.storeName}</td>
                    <td data-label="رصيد المحفظة" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--red)', whiteSpace: 'nowrap' }}>{fmt(r.wallet)}</td>
                    <td data-label="الحالة" style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{r.status || '—'}</td>
                    <td data-label="آخر شحنة" style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {r.lastShipmentAt ? new Date(r.lastShipmentAt).toLocaleDateString('en-CA') : '—'}
                    </td>
                    <td data-label="تواصل" style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}><PhoneCell phone={r.phone} name={r.storeName} amount={Math.abs(Number(r.wallet) || 0)}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--muted2)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <AlertTriangle size={13}/> {totalEscalate} حالة مرشّحة للتصعيد القانوني · المصدر: زوهو (المتأخرة) + كشف المنصّة (المحافظ)
      </div>

      {/* حملة المطالبة الجماعية للمحافظ السالبة — {{2}} = |رصيد المحفظة| */}
      <WhatsAppSendModal open={walletWaOpen} onClose={() => setWalletWaOpen(false)}
        recipients={walletRecipients} bucketLabel="مطالبة محافظ سالبة"
        onSent={() => setWalletWaOpen(false)}/>
    </div>
  );
}

function SectionHeader({ icon, title, note }) {
  return (
    <div style={{ margin: '2px 0 10px' }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 7 }}>
        <span>{icon}</span> {title}
      </div>
      {note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{note}</div>}
    </div>
  );
}
