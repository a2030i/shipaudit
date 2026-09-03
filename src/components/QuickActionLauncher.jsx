import { Building2, FileSpreadsheet, HandCoins, Landmark, Lock, Target, Upload, X } from 'lucide-react';

const ACTIONS = [
  {
    id: 'lamha',
    title: 'مراقبة مزامنة لمحة',
    description: 'راجع آخر مزامنة آلية لدليل المتاجر وكشف الحساب.',
    icon: FileSpreadsheet,
    path: '/operations',
    featured: true,
  },
  {
    id: 'carrier-file',
    title: 'رفع فاتورة شركة شحن',
    description: 'اختر الشركة ثم ارفع الفاتورة للمراجعة من ملفها.',
    icon: Upload,
    path: '/hub?action=upload-invoice',
  },
  {
    id: 'collection',
    title: 'إنشاء قائمة تنفيذ',
    description: 'ضع شروطك المتغيرة، شاهد النتائج، ثم نفّذ إجراءً فرديًا أو جماعيًا.',
    icon: HandCoins,
    path: '/customer-money?worklist=1',
  },
  {
    id: 'bank',
    title: 'مراجعة الحسابات البنكية',
    description: 'فتح كشوف الحساب والأرصدة والعمليات غير المصنفة.',
    icon: Landmark,
    path: '/bank',
  },
  {
    id: 'period-close',
    title: 'إقفال الفترة',
    description: 'راجع جاهزية الفترة ثم نفّذ الإقفال بصلاحيتك الحالية.',
    icon: Lock,
    path: '/periods',
  },
  {
    id: 'lead',
    title: 'تسجيل فرصة بيع',
    description: 'إضافة ومتابعة فرصة داخل مسار المبيعات.',
    icon: Target,
    path: '/crm',
  },
  {
    id: 'carrier',
    title: 'إدارة شركة شحن',
    description: 'العقود والجداول وبيانات الناقل.',
    icon: Building2,
    path: '/carriers',
  },
];

export default function QuickActionLauncher({ open, onClose, onNavigate }) {
  if (!open) return null;
  return (
    <div className="quick-action-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="quick-action-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-action-title">
        <header>
          <div>
            <span>ابدأ من النتيجة المطلوبة</span>
            <h2 id="quick-action-title">إجراء جديد</h2>
          </div>
          <button type="button" aria-label="إغلاق" onClick={onClose}><X size={19}/></button>
        </header>
        <div className="quick-action-grid">
          {ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                type="button"
                key={action.id}
                className={action.featured ? 'is-featured' : ''}
                onClick={() => { onNavigate(action.path); onClose(); }}
              >
                <span className="quick-action-icon"><Icon size={20}/></span>
                <span><strong>{action.title}</strong><small>{action.description}</small></span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
