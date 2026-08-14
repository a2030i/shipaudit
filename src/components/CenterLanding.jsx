import { ArrowLeft, Sparkles } from 'lucide-react';

const OUTCOMES = {
  customers: 'ابدأ من العميل، ثم انتقل إلى خدمته وحالته دون البحث في أقسام أخرى.',
  sales: 'تابع الفرصة من دخولها حتى الإغلاق والحملة والمسؤول عنها.',
  finance: 'اعرف ما لك وما عليك، ثم انتقل للتحصيل والبنك وزوهو والربحية.',
  shipping: 'شغّل دورة الشحن والفوترة الشهرية من نقطة واحدة واضحة.',
  reports: 'اقرأ المؤشرات والتقارير والمصادر التي تحتاج مراجعة.',
  settings: 'أدر الفريق والصلاحيات والعقود والتكاملات من مركز واحد.',
};

export default function CenterLanding({ section, groups, onNavigate, onQuickAction }) {
  if (!section) return null;
  const Icon = section.icon;
  const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="center-landing" style={{ '--center-accent': section.accent }}>
      <header className="center-landing__hero">
        <div className="center-landing__icon"><Icon size={26}/></div>
        <div>
          <span className="center-landing__eyebrow">مركز عمل</span>
          <h1>{section.label}</h1>
          <p>{OUTCOMES[section.id] || section.hint}</p>
        </div>
        <button type="button" className="center-landing__action" onClick={onQuickAction}>
          <Sparkles size={17}/><span>إجراء جديد</span>
        </button>
      </header>

      <div className="center-landing__summary">
        <strong>{itemCount}</strong>
        <span>مسارات عمل متاحة حسب صلاحياتك</span>
      </div>

      <div className="center-landing__groups">
        {groups.map(group => (
          <section className="center-landing__group" key={group.id}>
            {group.label && <h2>{group.label}</h2>}
            <div className="center-landing__grid">
              {group.items.map(item => {
                const ItemIcon = item.icon;
                return (
                  <button type="button" className="center-landing__card" key={item.id} onClick={() => onNavigate(item.path)}>
                    <span className="center-landing__card-icon"><ItemIcon size={19}/></span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>فتح مساحة العمل</small>
                    </span>
                    <ArrowLeft size={17}/>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
