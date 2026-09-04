// «النقد والأعمار» — manager view: who holds our COD cash (and how long),
// and what we owe carriers bucketed by due date. Read-only.

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, HandCoins, Hourglass } from 'lucide-react';
import { toast } from '../lib/toast.js';
import { loadCashAging } from '../lib/cashAgingService.js';
import { Breadcrumbs, Button as Btn, DataTable, EmptyState as Empty, LoadingState as WorkspaceLoadingState, PageHeader, Panel as Card, StatStrip } from '../design-system/EnterpriseUI.jsx';
import FinanceWorkspaceNav from '../components/enterprise/FinanceWorkspaceNav.jsx';

const fmt = (v) => (v == null || Number.isNaN(v) || Math.abs(v) < 0.005) ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const th = { padding: '10px 12px', fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right', fontSize: 12 };
const td = { padding: '10px 12px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 12.5 };

function SectionTable({ title, icon, columns, children, footer }) {
  return (
    <Card className="data-ledger cash-aging-section" style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
      <div className="data-ledger__header" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
        {icon} {title}
      </div>
      <div className="cash-aging-table-wrap">
        <DataTable className="m-cards cash-aging-table" caption={title}>
          <thead><tr style={{ background: 'var(--bg2)' }}>{columns.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
          <tbody>{children}</tbody>
          {footer}
        </DataTable>
      </div>
    </Card>
  );
}

export default function CashAging({ isActive }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setData(await loadCashAging()); }
    catch (e) { toast(`تعذّر التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { if (isActive && !data) refresh(); }, [isActive, data, refresh]);

  if (loading && !data) return (
    <div className="workspace-page" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<HandCoins size={22}/>} title="أعمار التحصيل والسداد"
        subtitle="مدة تحصيل COD وما يستحق لشركات الشحن حسب التأخير"
      />
      <WorkspaceLoadingState title="جارٍ حساب أعمار الأرصدة" source="دفتر الناقلين والتحصيلات" rows={4}/>
    </div>
  );

  return (
    <div className="workspace-page cash-aging-page">
      <Breadcrumbs items={[{ label: 'المالية' }, { label: 'الرقابة المالية' }, { label: 'أعمار النقد' }]}/>
      <PageHeader
        icon={<HandCoins size={22}/>}
        title="أعمار التحصيل والسداد"
        subtitle="من يحبس تحصيلك وكم يوم؟ ووش عليك للناقلين حسب الاستحقاق؟"
        actions={<Btn size="sm" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/> تحديث أعمار الأرصدة</Btn>}
      />

      <FinanceWorkspaceNav active="control"/>

      {/* Headline KPIs */}
      <StatStrip className="cash-aging-kpi-grid" items={[
          { key: 'cod', label: 'COD معلّق عند الناقلين', value: <>{fmt(data?.codTotal)} <small>ر.س</small></>, tone: Number(data?.codTotal) > 0.5 ? 'warning' : 'neutral' },
          { key: 'ap', label: 'مستحق علينا للناقلين', value: <>{fmt(data?.apTotal)} <small>ر.س</small></> },
          { key: 'overdue', label: 'منه فات موعد سداده', value: <>{fmt(data?.apOverdue)} <small>ر.س</small></>, tone: data?.apOverdue > 0.5 ? 'danger' : 'neutral' },
          // أرصدة دائنة (COD محتجز لم يُورَّد) — منفصلة عن الذمم حتى لا تُطرَح مضلِّلةً
          ...(Math.abs(data?.apCreditTotal || 0) > 0.5
            ? [{ key: 'credits', label: 'أرصدة لصالحنا (COD محتجز)', value: <>{fmt(Math.abs(data.apCreditTotal))} <small>ر.س</small></>, tone: 'success' }]
            : []),
        ]}/>

      {/* 1 — COD cash cycle */}
      <SectionTable
        title="كم تأخذ كل شركة حتى تحوّل لك COD"
        icon={<Hourglass size={16}/>}
        columns={['الناقل','متوسط أيام التحصيل','معلّق 0-15ي','16-30ي','31-60ي','+60ي','إجمالي المعلّق','أقدم شحنة']}
      >
        {(data?.cod || []).map(r => (
          <tr key={r.carrierId} style={{ borderTop: '1px solid var(--border)' }}>
            <td data-label="الناقل" style={{ ...td, fontWeight: 600 }}>{r.carrierName}</td>
            <td data-label="متوسط أيام التحصيل" style={{ ...td, color: r.avgDays == null ? 'var(--muted)' : r.avgDays > 14 ? 'var(--red)' : 'var(--green2)', fontWeight: 700 }}>
              {r.avgDays == null ? 'لا تحويلات بعد' : r.avgDays <= 0 ? '≤ يوم' : `${r.avgDays} يوم`}
            </td>
            <td data-label="معلّق 0–15 يوم" style={td}>{fmt(r.buckets[0])}</td>
            <td data-label="معلّق 16–30 يوم" style={{ ...td, color: r.buckets[1] > 0.5 ? 'var(--gold)' : 'inherit' }}>{fmt(r.buckets[1])}</td>
            <td data-label="معلّق 31–60 يوم" style={{ ...td, color: r.buckets[2] > 0.5 ? 'var(--red)' : 'inherit' }}>{fmt(r.buckets[2])}</td>
            <td data-label="معلّق أكثر من 60 يوم" style={{ ...td, color: r.buckets[3] > 0.5 ? 'var(--red)' : 'inherit', fontWeight: r.buckets[3] > 0.5 ? 700 : 400 }}>{fmt(r.buckets[3])}</td>
            <td data-label="إجمالي المعلّق" style={{ ...td, fontWeight: 700 }}>{fmt(r.outTotal)}</td>
            <td data-label="أقدم شحنة" style={{ ...td, color: r.oldestDays > 30 ? 'var(--red)' : 'var(--muted)' }}>{r.oldestDays ? `${r.oldestDays} يوم` : '—'}</td>
          </tr>
        ))}
      </SectionTable>

      {/* 2 — AP aging */}
      <SectionTable
        title="المطلوب منك لشركات الشحن — حسب التأخير"
        icon={<HandCoins size={16}/>}
        columns={['الناقل','متأخر ⚠','يستحق 0-30ي','31-60ي','+60ي','مبالغ لصالحك (تُخصم)','الإجمالي']}
        footer={data?.ap?.length ? (
          <tfoot><tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg2)', fontWeight: 700 }}>
            <td data-label="الناقل" style={td}>الإجمالي</td>
            <td data-label="متأخر" style={{ ...td, color: 'var(--red)' }}>{fmt(data.ap.reduce((s, r) => s + r.overdue, 0))}</td>
            <td data-label="يستحق 0–30 يوم" style={td}>{fmt(data.ap.reduce((s, r) => s + r.d0_30, 0))}</td>
            <td data-label="يستحق 31–60 يوم" style={td}>{fmt(data.ap.reduce((s, r) => s + r.d31_60, 0))}</td>
            <td data-label="أكثر من 60 يوم" style={td}>{fmt(data.ap.reduce((s, r) => s + r.over60, 0))}</td>
            <td data-label="مبالغ لصالحك" style={{ ...td, color: 'var(--green2)' }}>{fmt(data.ap.reduce((s, r) => s + r.credits, 0))}</td>
            <td data-label="الإجمالي" style={td}>{fmt(data.apTotal)}</td>
          </tr></tfoot>
        ) : null}
      >
        {(data?.ap || []).length === 0
          ? <tr><td colSpan={7}><Empty icon="✓" title="لا ذمم مفتوحة"/></td></tr>
          : data.ap.map(r => (
            <tr key={r.carrierId} style={{ borderTop: '1px solid var(--border)' }}>
              <td data-label="الناقل" style={{ ...td, fontWeight: 600 }}>{r.carrierName}</td>
              <td data-label="متأخر" style={{ ...td, color: r.overdue > 0.5 ? 'var(--red)' : 'inherit', fontWeight: r.overdue > 0.5 ? 700 : 400 }}>{fmt(r.overdue)}</td>
              <td data-label="يستحق 0–30 يوم" style={td}>{fmt(r.d0_30)}</td>
              <td data-label="يستحق 31–60 يوم" style={td}>{fmt(r.d31_60)}</td>
              <td data-label="أكثر من 60 يوم" style={td}>{fmt(r.over60)}</td>
              <td data-label="مبالغ لصالحك" style={{ ...td, color: r.credits < -0.5 ? 'var(--green2)' : 'inherit' }}>{fmt(r.credits)}</td>
              <td data-label="الإجمالي" style={{ ...td, fontWeight: 700 }}>{fmt(r.total)}</td>
            </tr>
          ))}
      </SectionTable>

      <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.8 }}>
        متوسط أيام التحصيل = من رفع «المتوقّع» حتى وصول التحويل (للشحنات المحصَّلة). «لا تحويلات بعد» = ناقل لم يصلنا منه أي تحويل مطابق.
        أعمار الذمم تُحسب على الاستحقاق (أو تاريخ المستند +30 يوم إن غاب). «مبالغ لصالحك (تُخصم)» = أرصدة دائنة تخصم من المطلوب.
      </p>
    </div>
  );
}
