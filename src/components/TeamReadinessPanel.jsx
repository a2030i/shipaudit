import { Calculator, Landmark, Users, ArrowLeft, Clock3 } from 'lucide-react';

const STATUS = {
  ready: { label: 'جاهز', tone: 'ready' },
  pilot: { label: 'جاهز للتجربة المنضبطة', tone: 'pilot' },
  blocked: { label: 'يحتاج إعداداً قبل التشغيل', tone: 'blocked' },
  unavailable: { label: 'المصدر غير متاح', tone: 'unavailable' },
};

const number = (value) => Number(value || 0).toLocaleString('en-US');
const money = (value) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function statusOf(section) {
  return STATUS[section?.status] || STATUS.unavailable;
}

function ReadinessCard({ icon, title, section, evidence, staffing, note, actions = [], onNavigate }) {
  const state = statusOf(section);
  const visibleActions = actions.filter(Boolean);
  return (
    <article className={`team-readiness-card is-${state.tone}`}>
      <div className="team-readiness-card__head">
        <span className="team-readiness-card__icon" aria-hidden="true">{icon}</span>
        <div>
          <h3>{title}</h3>
          <span className={`team-readiness-status is-${state.tone}`}>{state.label}</span>
        </div>
      </div>
      <strong className="team-readiness-card__evidence">{section ? evidence : 'تعذّر قراءة بيانات الجاهزية'}</strong>
      {section && <span className="team-readiness-card__staffing">{staffing || 'تعذّر قراءة تغطية صلاحيات الفريق'}</span>}
      <p>{section ? note : 'أعد التحديث قبل اتخاذ قرار نقل الفريق إلى النظام.'}</p>
      <div className="team-readiness-card__actions">
        {visibleActions.map((action, index) => (
          <button
            key={`${action.path}:${action.label}`}
            type="button"
            className={index > 0 ? 'is-secondary' : ''}
            onClick={() => onNavigate(action.path)}
          >
            {action.label}<ArrowLeft size={15}/>
          </button>
        ))}
      </div>
    </article>
  );
}

export default function TeamReadinessPanel({ readiness, onNavigate }) {
  const accounting = readiness?.accounting;
  const finance = readiness?.finance;
  const sales = readiness?.sales;
  const checkedAt = readiness?.checked_at
    ? new Date(readiness.checked_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })
    : 'لم يكتمل التحديث';

  return (
    <section className="team-readiness-panel" aria-labelledby="team-readiness-title">
      <div className="team-readiness-panel__head">
        <div>
          <span className="team-readiness-panel__eyebrow">قرار الانتقال للنظام</span>
          <h2 id="team-readiness-title">جاهزية فرق العمل</h2>
          <p>حالة تشغيلية حيّة؛ لا تغيّر الأرصدة أو القيود أو إسناد الموظفين.</p>
        </div>
        <span className="team-readiness-panel__freshness"><Clock3 size={14}/> {checkedAt}</span>
      </div>

      <div className="team-readiness-grid">
        <ReadinessCard
          icon={<Calculator size={20}/>}
          title="المحاسبة"
          section={accounting}
          evidence={`${number(accounting?.missing_carriers)} شركات · ${number(accounting?.missing_schedules)} جداول ناقصة`}
          staffing={accounting?.staffing
            ? `${number(accounting.staffing.cycle_operators)} مشغّل دورة · ${number(accounting.staffing.cycle_closers)} مفوّض إقفال`
            : ''}
          note={accounting?.missing_schedules > 0
            ? 'حدّد مواعيد الفاتورة والتحصيل الناقصة، ثم أغلق دورة شهر تجريبية.'
            : `${number(accounting?.closed_cycles)} دورات شهرية مغلقة بنجاح.`}
          actions={[
            accounting?.missing_schedules > 0
              ? { label: 'ضبط جداول الناقلين', path: '/tasks' }
              : { label: 'فتح دورة المحاسب', path: '/accounting-cycle' },
            accounting?.staffing?.cycle_closers === 0
              ? { label: 'تعيين مشرف الإقفال', path: '/employees' }
              : null,
          ]}
          onNavigate={onNavigate}
        />
        <ReadinessCard
          icon={<Landmark size={20}/>}
          title="المالية"
          section={finance}
          evidence={`${number(finance?.uncategorized_bank_operations)} عملية بنكية غير مصنفة`}
          staffing={finance?.staffing
            ? `${number(finance.staffing.finance_operators)} مشغّل مالي · ${number(finance.staffing.financial_report_viewers)} قارئ تقارير مالية`
            : ''}
          note={finance
            ? `فرق كشف البنك عن دفتر زوهو: ${money(finance.statement_vs_book_difference)} ر.س · سلامة أرصدة العملاء: ${number(finance.customer_integrity_issues)} مشكلة.`
            : ''}
          actions={[
            finance?.staffing?.finance_operators === 0
              ? { label: 'تهيئة موظف المالية', path: '/employees' }
              : { label: 'فتح البنوك والمطابقة', path: '/zoho-data?tab=banks' },
            finance?.staffing?.finance_operators === 0
              ? { label: 'فتح البنوك والمطابقة', path: '/zoho-data?tab=banks' }
              : null,
          ]}
          onNavigate={onNavigate}
        />
        <ReadinessCard
          icon={<Users size={20}/>}
          title="المبيعات والتحصيل"
          section={sales}
          evidence={`${number(sales?.unassigned_collections)} تحصيل · ${number(sales?.unassigned_followups)} متابعة بلا مسؤول`}
          staffing={sales?.staffing
            ? `${number(sales.staffing.sales_operators)} مبيعات · ${number(sales.staffing.collection_operators)} تحصيل · ${number(sales.staffing.collection_supervisors)} مشرف توزيع`
            : ''}
          note={sales
            ? `${number(sales.campaign_recipients)} مستلمي عملاء حملات مهيئين · ${number(sales.unassigned_crm_tasks)} مهام CRM بلا مسؤول. مستلم الحملة يُضبط من الفريق والصلاحيات.`
            : ''}
          actions={[
            { label: 'توزيع مهام التحصيل', path: '/collections' },
            sales?.staffing?.collection_supervisors === 0 || sales?.campaign_recipients === 0
              ? { label: 'تهيئة مشرف ومستلم الحملات', path: '/employees' }
              : null,
          ]}
          onNavigate={onNavigate}
        />
      </div>
    </section>
  );
}
