import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { Card, Btn, Modal, Spinner, toast } from '../components/UI.jsx';
import { loadEmployees, createEmployee, updateEmployee, deleteEmployee } from '../lib/employeeService.js';
import { useAuth } from '../lib/auth.jsx';

const ROLES = [
  { value: 'admin',       label: 'مدير',        color: 'var(--accent)' },
  { value: 'accountant1', label: 'محاسب أول',   color: 'var(--green)'  },
  { value: 'accountant2', label: 'محاسب ثانٍ',  color: 'var(--gold)'   },
];

const AVATAR_COLORS = [
  '#38bdf8','#34d399','#fbbf24','#f87171',
  '#a78bfa','#fb923c','#e879f9','#4ade80',
];

function RoleBadge({ role }) {
  const r = ROLES.find(x => x.value === role);
  if (!r) return null;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 9px',
      borderRadius: 20,
      fontSize: 10,
      fontWeight: 600,
      fontFamily: 'var(--font-mono)',
      background: `color-mix(in srgb, ${r.color} 15%, transparent)`,
      color: r.color,
      border: `1px solid color-mix(in srgb, ${r.color} 30%, transparent)`,
    }}>
      {r.label}
    </span>
  );
}

function Avatar({ name, color, size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: color || '#38bdf8',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: '#000',
    }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  );
}

// ── Employee Form Modal ───────────────────────────────────────────────────────
function EmployeeModal({ employee, onClose, onSave }) {
  const isNew = !employee?.id;
  const [form, setForm] = useState({
    name:         employee?.name         || '',
    email:        employee?.email        || '',
    password:     '',
    role:         employee?.role         || 'accountant1',
    avatar_color: employee?.avatar_color || '#38bdf8',
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim())  return toast('أدخل الاسم', 'error');
    if (isNew) {
      if (!form.email.trim())    return toast('أدخل البريد الإلكتروني', 'error');
      if (form.password.length < 6) return toast('كلمة المرور 6 أحرف على الأقل', 'error');
    }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, type = 'text', placeholder = '') => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 5, fontFamily: 'var(--font-mono)' }}>
        {label}
      </div>
      <input
        type={type}
        value={form[key]}
        placeholder={placeholder}
        onChange={e => set(key, e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: 'var(--surface)', border: '1px solid var(--border2)',
          borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13,
          outline: 'none',
        }}
      />
    </div>
  );

  return (
    <Modal title={isNew ? 'إضافة موظف جديد' : 'تعديل الموظف'} onClose={onClose} width={420}>
      <div style={{ padding: '4px 0' }}>

        {/* Preview avatar */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <Avatar name={form.name || '?'} color={form.avatar_color} size={56}/>
        </div>

        {field('الاسم الكامل', 'name', 'text', 'أحمد محمد')}

        {isNew && <>
          {field('البريد الإلكتروني', 'email', 'email', 'example@company.com')}
          {field('كلمة المرور', 'password', 'password', '6 أحرف على الأقل')}
        </>}

        {/* Role */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 5, fontFamily: 'var(--font-mono)' }}>
            الصلاحية
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {ROLES.map(r => (
              <button key={r.value} onClick={() => set('role', r.value)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 600, transition: 'all .15s',
                background: form.role === r.value
                  ? `color-mix(in srgb, ${r.color} 18%, transparent)`
                  : 'var(--surface)',
                border: form.role === r.value
                  ? `1px solid ${r.color}`
                  : '1px solid var(--border2)',
                color: form.role === r.value ? r.color : 'var(--muted)',
              }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Avatar color */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            لون الأفاتار
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {AVATAR_COLORS.map(c => (
              <button key={c} onClick={() => set('avatar_color', c)} style={{
                width: 28, height: 28, borderRadius: '50%', background: c,
                border: form.avatar_color === c ? '3px solid #fff' : '2px solid transparent',
                cursor: 'pointer', outline: form.avatar_color === c ? `2px solid ${c}` : 'none',
                outlineOffset: 1,
              }}/>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size={14}/> : (isNew ? 'إضافة الموظف' : 'حفظ التعديلات')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────
function DeleteConfirm({ employee, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="حذف الموظف" onClose={onClose} width={360}>
      <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
        <Avatar name={employee.name} color={employee.avatar_color} size={52}/>
        <div style={{ marginTop: 12, fontSize: 15, fontWeight: 600 }}>{employee.name}</div>
        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>{employee.email}</div>
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 8,
          background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)',
          fontSize: 12, color: 'var(--red)', lineHeight: 1.6,
        }}>
          سيتم حذف الحساب نهائياً ولا يمكن التراجع عن هذا الإجراء.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant="danger" onClick={handleDelete} disabled={loading}>
          {loading ? <Spinner size={14}/> : 'حذف نهائياً'}
        </Btn>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function EmployeeManager() {
  const { profile: myProfile } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null); // { type: 'add' | 'edit' | 'delete', employee? }

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEmployees(await loadEmployees());
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleSave = async (form) => {
    if (modal.type === 'add') {
      await createEmployee(form);
      toast('تم إضافة الموظف بنجاح', 'success');
    } else {
      await updateEmployee(modal.employee.id, {
        name:         form.name,
        role:         form.role,
        avatar_color: form.avatar_color,
      });
      toast('تم تحديث بيانات الموظف', 'success');
    }
    await reload();
  };

  const handleDelete = async () => {
    await deleteEmployee(modal.employee.id);
    toast('تم حذف الموظف', 'success');
    await reload();
  };

  const roleCounts = ROLES.reduce((acc, r) => {
    acc[r.value] = employees.filter(e => e.role === r.value).length;
    return acc;
  }, {});

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>إدارة الموظفين</h2>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>
            {employees.length} موظف مسجل
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" size="sm" icon={<RefreshCw size={13}/>} onClick={reload}>
            تحديث
          </Btn>
          <Btn size="sm" icon={<UserPlus size={14}/>} onClick={() => setModal({ type: 'add' })}>
            إضافة موظف
          </Btn>
        </div>
      </div>

      {/* ── Stats ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {ROLES.map(r => (
          <div key={r.value} style={{
            flex: 1, padding: '12px 16px', borderRadius: 10,
            background: 'var(--card)', border: `1px solid var(--border)`,
            borderTop: `2px solid ${r.color}`,
          }}>
            <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              {r.label}
            </div>
            <div style={{ color: r.color, fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {roleCounts[r.value] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* ── List ── */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spinner size={28}/>
        </div>
      ) : employees.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
            لا يوجد موظفون بعد
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {employees.map(emp => (
            <Card key={emp.id} style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>

                <Avatar name={emp.name} color={emp.avatar_color}/>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</span>
                    <RoleBadge role={emp.role}/>
                    {emp.id === myProfile?.id && (
                      <span style={{
                        fontSize: 10, color: 'var(--accent)',
                        fontFamily: 'var(--font-mono)', opacity: 0.7,
                      }}>
                        أنت
                      </span>
                    )}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{emp.email}</div>
                </div>

                <div style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                  {new Date(emp.created_at).toLocaleDateString('ar-SA')}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setModal({ type: 'edit', employee: emp })}
                    title="تعديل"
                    style={{
                      background: 'var(--surface)', border: '1px solid var(--border2)',
                      borderRadius: 7, padding: '6px 9px', cursor: 'pointer',
                      color: 'var(--muted)', display: 'flex', alignItems: 'center',
                    }}
                  >
                    <Pencil size={13}/>
                  </button>
                  <button
                    onClick={() => emp.id !== myProfile?.id && setModal({ type: 'delete', employee: emp })}
                    title={emp.id === myProfile?.id ? 'لا يمكنك حذف حسابك' : 'حذف'}
                    disabled={emp.id === myProfile?.id}
                    style={{
                      background: emp.id === myProfile?.id ? 'var(--surface)' : 'rgba(248,113,113,.08)',
                      border: '1px solid rgba(248,113,113,.2)',
                      borderRadius: 7, padding: '6px 9px',
                      cursor: emp.id === myProfile?.id ? 'not-allowed' : 'pointer',
                      color: emp.id === myProfile?.id ? 'var(--border2)' : 'var(--red)',
                      display: 'flex', alignItems: 'center',
                      opacity: emp.id === myProfile?.id ? 0.4 : 1,
                    }}
                  >
                    <Trash2 size={13}/>
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <EmployeeModal
          employee={modal.employee ?? null}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteConfirm
          employee={modal.employee}
          onClose={() => setModal(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
