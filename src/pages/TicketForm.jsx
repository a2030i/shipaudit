// «/ticket» — نموذج تذكرة دعم سريع (§1.35). شاشة مستقلة بلا قائمة جانبية:
// موظف الخدمة يرد على العميل في هاتف، يفتح الرابط، يسجّل المشكلة بثوانٍ.
// يتطلب دخولاً + صلاحية support.create. النموذج نفسه مكوّن مشترك
// (TicketCreateForm) يُعرض أيضاً كمودال في لوحة /support — مصدر واحد.
// ?phone=9665... يملأ المتجر تلقائياً (رابط مستقبلي من داخل هاتف).
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card, Btn } from '../components/UI.jsx';
import { LamhaMark } from '../components/BrandLogo.jsx';
import { useAuth } from '../lib/auth.jsx';
import TicketCreateForm from '../components/TicketCreateForm.jsx';

export default function TicketForm() {
  const { can } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // ملاحظة: ‎#root نفسه ‎display:flex + overflow:hidden — فالغلاف يأخذ flex:1
  // وعرضاً كاملاً وتمريراً داخلياً، وإلا التصق النموذج يميناً بلا توسيط ولا تمرير.
  return (
    <div style={{ flex: 1, width: '100%', height: '100vh', overflowY: 'auto', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 14px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <LamhaMark size={34}/>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>تذكرة دعم جديدة</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>سجّل مشكلة العميل قبل أن تضيع من المحادثة</div>
        </div>
      </div>
      <Card style={{ width: '100%', maxWidth: 560, padding: '20px 20px' }}>
        <TicketCreateForm prefillPhone={searchParams.get('phone') || ''}/>
      </Card>
      {can('support.view') && (
        <Btn variant="ghost" size="sm" onClick={() => navigate('/support')} style={{ marginTop: 16, color: 'var(--accent)' }}>
          لوحة متابعة التذاكر <ArrowRight size={13} style={{ transform: 'scaleX(-1)' }}/>
        </Btn>
      )}
    </div>
  );
}
