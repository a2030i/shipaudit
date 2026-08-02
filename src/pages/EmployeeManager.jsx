import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  UserPlus, Pencil, Trash2, RefreshCw, Shield, ShieldCheck, Lock, Check, Search,
  LayoutDashboard, Inbox, Mail, FileCheck2, Truck, Coins, Users, PhoneCall,
  Store, Wallet, BookOpenCheck, Send, GitMerge, Settings, LifeBuoy, History,
} from 'lucide-react';
import { Card, Btn, Modal, Spinner, toast, PageHeader } from '../components/UI.jsx';
import {
  loadEmployees, createEmployee, updateEmployee, deleteEmployee, updateEmployeePermissions,
  loadEmployeeActivitySummary, loadEmployeeActivity,
} from '../lib/employeeService.js';
import { useAuth } from '../lib/auth.jsx';
import { pageTitle } from '../lib/pageTitles.js';
import './EmployeeManager.css';
import {
  PERMISSION_CATALOG, PRESETS, ALL_PERMISSION_KEYS, FULL_ACCOUNTANT_KEYS,
} from '../lib/permissions.js';

const ROLES = [
  { value: 'admin',      label: 'مدير',  color: 'var(--accent)', desc: 'يشاهد ويفعل كل شيء' },
  // القيمة 'accountant' تاريخية في DB — العرض «موظف» (قرار المستخدم 2026-07-16):
  // الدور واحد لكل الموظفين، والتفصيل بالصلاحيات لكل موظف على حدة.
  { value: 'accountant', label: 'موظف', color: 'var(--green)',  desc: 'صلاحياته تُدار من زر "الصلاحيات"' },
];

const AVATAR_COLORS = [
  'var(--accent)','#34d399','#fbbf24','#f87171',
  '#a78bfa','#fb923c','#e879f9','#4ade80',
];

// Icon lookup for permission catalog sections
const SECTION_ICONS = {
  LayoutDashboard, Inbox, Mail, FileCheck2, Truck, Coins, Users, PhoneCall,
  Store, Wallet, BookOpenCheck, Send, GitMerge, Settings, LifeBuoy,
};

function RoleBadge({ role }) {
  const r = ROLES.find(x => x.value === role);
  if (!r) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 9px',
      borderRadius: 20,
      fontSize: 10,
      fontWeight: 600,
      fontFamily: 'var(--font-mono)',
      background: `color-mix(in srgb, ${r.color} 15%, transparent)`,
      color: r.color,
      border: `1px solid color-mix(in srgb, ${r.color} 30%, transparent)`,
    }}>
      {role === 'admin' ? <ShieldCheck size={10}/> : <Shield size={10}/>}
      {r.label}
    </span>
  );
}

function Avatar({ name, color, size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: color || 'var(--accent)',
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
    role:         employee?.role         || 'accountant',
    avatar_color: employee?.avatar_color || 'var(--accent)',
    lead_notification_phone: employee?.lead_notification_phone || '',
    accepts_campaign_leads: employee?.accepts_campaign_leads === true,
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
        autoComplete="off"
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

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <Avatar name={form.name || '?'} color={form.avatar_color} size={56}/>
        </div>

        {field('الاسم الكامل', 'name', 'text', 'أحمد محمد')}

        {isNew && <>
          {field('البريد الإلكتروني', 'email', 'email', 'example@company.com')}
          {field('كلمة المرور', 'password', 'password', '6 أحرف على الأقل')}
        </>}

        {field('رقم واتساب لاستقبال تنبيهات العملاء الجدد', 'lead_notification_phone', 'tel', '05xxxxxxxx')}
        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 16, padding: '10px 12px',
          border: '1px solid var(--border2)', borderRadius: 8, background: 'var(--surface)' }}>
          <input type="checkbox" checked={form.accepts_campaign_leads}
            onChange={e => set('accepts_campaign_leads', e.target.checked)} style={{ marginTop: 2 }}/>
          <span><b style={{ display: 'block', fontSize: 12 }}>استقبال العملاء الجدد من الحملات</b>
            <small style={{ color: 'var(--muted)' }}>يدخل الموظف في التوزيع التلقائي، ويصله قالب واتساب ببيانات العميل.</small></span>
        </label>

        {/* Role */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 5, fontFamily: 'var(--font-mono)' }}>
            الدور
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {ROLES.map(r => (
              <button key={r.value} type="button" onClick={() => set('role', r.value)} style={{
                flex: 1, padding: '10px 8px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 600, transition: 'all .15s', textAlign: 'right',
                background: form.role === r.value
                  ? `color-mix(in srgb, ${r.color} 18%, transparent)`
                  : 'var(--surface)',
                border: form.role === r.value
                  ? `1px solid ${r.color}`
                  : '1px solid var(--border2)',
                color: form.role === r.value ? r.color : 'var(--muted)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  {r.value === 'admin' ? <ShieldCheck size={12}/> : <Shield size={12}/>}
                  {r.label}
                </div>
                <div style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>{r.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            لون الأفاتار
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {AVATAR_COLORS.map(c => (
              <button key={c} type="button" onClick={() => set('avatar_color', c)} style={{
                width: 28, height: 28, borderRadius: '50%', background: c,
                border: form.avatar_color === c ? '3px solid #fff' : '2px solid transparent',
                cursor: 'pointer', outline: form.avatar_color === c ? `2px solid ${c}` : 'none',
                outlineOffset: 1,
              }}/>
            ))}
          </div>
        </div>

        {form.role === 'accountant' && isNew && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 8,
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
            fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6,
          }}>
            <Lock size={12} style={{ verticalAlign: 'middle', marginLeft: 4 }}/>
            بعد الإضافة، افتح "الصلاحيات" لتحديد ما يقدر يفعله بالضبط — يبدأ <strong>بدون صلاحيات</strong> افتراضياً.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn variant="accent" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size={14}/> : (isNew ? 'إضافة الموظف' : 'حفظ التعديلات')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Permissions Editor Modal ──────────────────────────────────────────────────
// Granular per-employee permission editor. Lists every key from
// PERMISSION_CATALOG grouped by section, with checkboxes. Top bar has
// search + preset shortcuts.
function PermissionsModal({ employee, onClose, onSave }) {
  const [perms,  setPerms]  = useState(employee.permissions || {});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const grantedCount = useMemo(
    () => Object.values(perms).filter(Boolean).length,
    [perms],
  );

  const toggle = (key) => setPerms(p => ({ ...p, [key]: !p[key] }));

  const applyPreset = (keys) => {
    const next = {};
    for (const k of keys) next[k] = true;
    setPerms(next);
  };

  const toggleSection = (sectionPerms) => {
    const keys = sectionPerms.map(p => p.key);
    const allOn = keys.every(k => perms[k]);
    const next = { ...perms };
    for (const k of keys) next[k] = !allOn;
    setPerms(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Strip falsy entries so the JSON stays compact.
      const clean = {};
      for (const [k, v] of Object.entries(perms)) if (v) clean[k] = true;
      await onSave(clean);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const searchLower = search.trim().toLowerCase();
  const filteredCatalog = useMemo(() => {
    if (!searchLower) return PERMISSION_CATALOG;
    return PERMISSION_CATALOG
      .map(section => ({
        ...section,
        perms: section.perms.filter(p =>
          p.label.toLowerCase().includes(searchLower) ||
          p.key.toLowerCase().includes(searchLower)   ||
          section.label.toLowerCase().includes(searchLower),
        ),
      }))
      .filter(section => section.perms.length > 0);
  }, [searchLower]);

  return (
    <Modal title={`صلاحيات ${employee.name}`} onClose={onClose} width={760}>
      {/* Sticky top bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 2,
        background: 'var(--card)', borderBottom: '1px solid var(--border)',
        padding: '6px 0 14px', marginBottom: 12,
      }}>
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap',
        }}>
          <div style={{
            position: 'relative', flex: 1, minWidth: 200,
          }}>
            <Search size={13} style={{
              position: 'absolute', insetInlineStart: 10, top: '50%',
              transform: 'translateY(-50%)', color: 'var(--muted2)',
            }}/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث في الصلاحيات…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 12px 8px 32px',
                background: 'var(--surface)', border: '1px solid var(--border2)',
                borderRadius: 8, color: 'var(--text)', fontSize: 12.5,
                outline: 'none', fontFamily: 'var(--font-sans)',
              }}
            />
          </div>
          <div style={{
            fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
            padding: '4px 10px', background: 'var(--surface)', borderRadius: 6,
            border: '1px solid var(--border2)', whiteSpace: 'nowrap',
          }}>
            {grantedCount} / {ALL_PERMISSION_KEYS.length}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, color: 'var(--muted)', alignSelf: 'center', marginInlineEnd: 4 }}>
            تطبيق سريع:
          </span>
          {PRESETS.map(p => (
            <Btn key={p.id} variant="ghost" size="sm" onClick={() => applyPreset(p.keys)}>
              {p.label}
            </Btn>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
        {filteredCatalog.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30, fontSize: 12 }}>
            لا توجد صلاحيات تطابق البحث
          </div>
        ) : filteredCatalog.map(section => {
          const Icon = SECTION_ICONS[section.icon] || Settings;
          const allOn = section.perms.every(p => perms[p.key]);
          const someOn = section.perms.some(p => perms[p.key]);
          return (
            <div key={section.id} style={{
              marginBottom: 14, borderRadius: 10, overflow: 'hidden',
              border: `1px solid color-mix(in srgb, ${section.color} 22%, var(--border))`,
              background: `color-mix(in srgb, ${section.color} 3%, transparent)`,
            }}>
              <button type="button" onClick={() => toggleSection(section.perms)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', cursor: 'pointer',
                background: `color-mix(in srgb, ${section.color} 8%, transparent)`,
                border: 'none', borderBottom: '1px solid var(--border)',
                color: 'var(--text)', textAlign: 'right',
              }}>
                <Icon size={15} color={section.color}/>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>
                  {section.label}
                </span>
                <span style={{
                  fontSize: 10.5, fontFamily: 'var(--font-mono)',
                  color: allOn ? section.color : someOn ? 'var(--muted)' : 'var(--muted2)',
                }}>
                  {section.perms.filter(p => perms[p.key]).length} / {section.perms.length}
                </span>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: allOn ? section.color
                            : someOn ? `color-mix(in srgb, ${section.color} 35%, transparent)`
                                     : 'var(--surface)',
                  border: `1px solid ${allOn ? section.color : 'var(--border2)'}`,
                  color: allOn ? '#fff' : 'transparent',
                }}>
                  {(allOn || someOn) && <Check size={13}/>}
                </div>
              </button>
              <div style={{ padding: '4px 0' }}>
                {section.perms.map(p => {
                  const on = !!perms[p.key];
                  return (
                    <label key={p.key} title={p.key} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 14px', cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      background: on ? `color-mix(in srgb, ${section.color} 6%, transparent)` : 'transparent',
                    }}
                      onClick={(e) => { e.preventDefault(); toggle(p.key); }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: on ? section.color : 'var(--surface)',
                        border: `1px solid ${on ? section.color : 'var(--border2)'}`,
                        color: '#fff',
                      }}>
                        {on && <Check size={11}/>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {p.label}
                          {p.sensitive && (
                            <span title="إجراء حسّاس" style={{
                              fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                              background: 'rgba(248,113,113,.14)', color: 'var(--red)',
                            }}>
                              حسّاس
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center',
        marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {grantedCount === 0 && '⚠ الموظف لا يستطيع فعل أي شيء حالياً'}
          {grantedCount > 0 && grantedCount < FULL_ACCOUNTANT_KEYS.length && `${grantedCount} صلاحية مفعّلة`}
          {grantedCount >= FULL_ACCOUNTANT_KEYS.length && '✓ صلاحيات كاملة (عدا إدارة الموظفين)'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn variant="accent" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size={14}/> : 'حفظ الصلاحيات'}
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
          سيتم حذف الحساب نهائياً. القيود التي أنشأها (المراجعات/الدفعات/المهام) تبقى محفوظة بدون اسم منشئ.
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
// ── سجل تحركات موظف (§1.36): دخول/تنقّل/ممنوع/تصدير/تعديل بيانات — بالـIP والدولة ──
const ACT_KINDS = {
  '':     { label: 'الكل',       color: 'var(--muted)' },
  login:  { label: '🔑 دخول',    color: 'var(--green)' },
  page:   { label: '👣 تنقّل',    color: 'var(--accent3)' },
  denied: { label: '⛔ ممنوع',    color: 'var(--red)' },
  export: { label: '📤 تصدير',   color: 'var(--gold)' },
  data:   { label: '✏️ بيانات',  color: 'var(--accent)' },
  action: { label: '⚙️ إجراء',   color: 'var(--muted)' },
};
const DATA_TABLE_AR = {
  payments: 'الدفعات', carrier_operations: 'حركات حسابات الشركات', audits: 'المراجعات',
  period_closes: 'إقفال الشهور', support_tickets: 'تذاكر الدعم', app_settings: 'الإعدادات',
  profiles: 'الموظفين/الصلاحيات',
};
const DATA_OP_AR = { insert: 'إضافة', update: 'تعديل', delete: 'حذف' };
const actLabel = (r) => {
  if (r.kind === 'data') {
    const [t, op] = String(r.action).split(':');
    return `${DATA_OP_AR[op] || op} في ${DATA_TABLE_AR[t] || t}`;
  }
  // التنقّل/الممنوع: اسم الصفحة بالنظام بدل المسار الخام (طلب المستخدم 2026-07-16)
  if (r.kind === 'page') return `زيارة «${pageTitle(r.path)}»`;
  if (r.kind === 'denied') return `حاول فتح «${pageTitle(r.path)}» بلا صلاحية`;
  return r.action;
};
const fmtWhen = (d) => { try { return new Date(d).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(d).slice(0, 16); } };

function ActivityModal({ employee, onClose }) {
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const PAGE = 100;

  const load = async (reset) => {
    setBusy(true);
    try {
      const offset = reset ? 0 : (rows?.length || 0);
      const r = await loadEmployeeActivity(employee.id, { kind: kind || null, limit: PAGE, offset });
      setRows(prev => reset ? r : [...(prev || []), ...r]);
      setDone(r.length < PAGE);
    } catch (e) { toast(e.message, 'error'); setRows(prev => prev || []); }
    setBusy(false);
  };
  useEffect(() => { setRows(null); setDone(false); load(true); }, [kind]); // eslint-disable-line

  return (
    <Modal title={`سجل تحركات — ${employee.name}`} width={660} onClose={onClose}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(ACT_KINDS).map(([k, v]) => (
          <button key={k} onClick={() => setKind(k)} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 11.5, cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontWeight: kind === k ? 700 : 500,
            border: `1.5px solid ${kind === k ? v.color : 'var(--border)'}`,
            background: kind === k ? `color-mix(in srgb, ${v.color} 10%, transparent)` : 'transparent',
            color: kind === k ? v.color : 'var(--muted)',
          }}>{v.label}</button>
        ))}
      </div>
      <div className="m-flow" style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7, paddingInlineEnd: 4 }}>
        {rows == null ? <div style={{ padding: 30, textAlign: 'center' }}><Spinner size={20}/></div>
          : !rows.length ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted2)', fontSize: 12 }}>لا تحركات مسجَّلة{kind ? ' لهذا النوع' : ''} — السجل بدأ من تفعيل الميزة</div>
          : rows.map(r => {
            const km = ACT_KINDS[r.kind] || ACT_KINDS.action;
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px',
                borderRadius: 9, border: '1px solid var(--border)',
                background: r.kind === 'denied' ? 'color-mix(in srgb, var(--red) 5%, transparent)' : 'var(--surface)',
              }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: km.color, whiteSpace: 'nowrap', paddingTop: 1 }}>{km.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>
                    {actLabel(r)}
                    {r.detail?.fileName ? <span style={{ color: 'var(--muted)' }}> — {r.detail.fileName}</span> : null}
                  </div>
                  {r.path && !['page', 'denied'].includes(r.kind) && (
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{pageTitle(r.path)}</div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted2)', textAlign: 'start', whiteSpace: 'nowrap' }}>
                  <div>{fmtWhen(r.createdAt)}</div>
                  {(r.ip || r.country) && (
                    <div style={{ fontFamily: 'var(--font-mono)', direction: 'ltr' }}>{r.country ? `${r.country} · ` : ''}{r.ip || ''}</div>
                  )}
                </div>
              </div>
            );
          })}
        {rows?.length > 0 && !done && (
          <Btn variant="ghost" size="sm" onClick={() => load(false)} disabled={busy}>
            {busy ? 'يحمّل…' : 'تحميل المزيد'}
          </Btn>
        )}
      </div>
    </Modal>
  );
}

export default function EmployeeManager() {
  const { profile: myProfile, can } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);
  // modal: { type: 'add'|'edit'|'delete'|'perms', employee? }

  const canManageEmployees   = can('system.manage_employees');
  const canManagePermissions = can('system.manage_permissions');
  const [actSummary, setActSummary] = useState(() => new Map()); // سجل التحركات — ملخّص/موظف

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEmployees(await loadEmployees());
      loadEmployeeActivitySummary().then(setActSummary).catch(() => {});
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
        lead_notification_phone: form.lead_notification_phone,
        accepts_campaign_leads: form.accepts_campaign_leads,
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

  const handleSavePerms = async (permissions) => {
    await updateEmployeePermissions(modal.employee.id, permissions);
    toast('تم تحديث الصلاحيات', 'success');
    await reload();
  };

  const roleCounts = ROLES.reduce((acc, r) => {
    acc[r.value] = employees.filter(e => e.role === r.value).length;
    return acc;
  }, {});

  return (
    <div className="employee-manager-page" style={{ padding: '24px 28px 80px', maxWidth: 920, margin: '0 auto' }}>

      <PageHeader
        icon={<Users size={22}/>}
        title="إدارة الموظفين"
        subtitle={`${employees.length} في الفريق · ${roleCounts.admin} مدير · ${roleCounts.accountant} موظف`}
        actions={<>
          <Btn variant="ghost" size="sm" icon={<RefreshCw size={13}/>} onClick={reload}>
            تحديث قائمة الفريق
          </Btn>
          {canManageEmployees && (
            <Btn size="sm" icon={<UserPlus size={14}/>} onClick={() => setModal({ type: 'add' })}>
              إضافة موظف
            </Btn>
          )}
        </>}
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {ROLES.map(r => (
          <div key={r.value} className="stat-card" style={{
            flex: 1, padding: '12px 16px', borderRadius: 10,
            background: 'var(--card)', border: `1px solid var(--border)`,
            '--sc-tone': r.color,
          }}>
            <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="stat-icon-tile">{r.value === 'admin' ? <ShieldCheck size={14}/> : <Shield size={14}/>}</span>
              {r.label}
            </div>
            <div style={{ color: r.color, fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {roleCounts[r.value] ?? 0}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 4 }}>
              {r.desc}
            </div>
          </div>
        ))}
      </div>

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
          {employees.map(emp => {
            const isMe = emp.id === myProfile?.id;
            const permCount = Object.values(emp.permissions || {}).filter(Boolean).length;
            return (
              <Card key={emp.id} style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>

                  <Avatar name={emp.name} color={emp.avatar_color}/>

                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{emp.name}</span>
                      <RoleBadge role={emp.role}/>
                      {emp.role === 'accountant' && (
                        <span style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 4,
                          background: permCount === 0
                            ? 'rgba(248,113,113,.12)'
                            : 'color-mix(in srgb, var(--accent) 12%, transparent)',
                          color: permCount === 0 ? 'var(--red)' : 'var(--accent)',
                          fontFamily: 'var(--font-mono)', fontWeight: 600,
                        }}>
                          {permCount === 0 ? 'بدون صلاحيات' : `${permCount} صلاحية`}
                        </span>
                      )}
                      {isMe && (
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

                  {/* آخر دخول + آخر حركة + محاولات ممنوعة (من سجل التحركات §1.36) */}
                  {(() => {
                    const a = actSummary.get(emp.id);
                    return (
                      <div style={{ fontSize: 10.5, flexShrink: 0, textAlign: 'start', minWidth: 150 }}>
                        <div style={{ color: 'var(--muted)' }}>
                          آخر دخول: <b style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                            {a?.lastSignIn ? new Date(a.lastSignIn).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </b>
                        </div>
                        <div style={{ color: 'var(--muted2)', marginTop: 2 }}>
                          {a?.actions7d ? `${a.actions7d} حركة آخر 7 أيام` : 'لا حركة مسجَّلة'}
                          {a?.lastCountry ? ` · ${a.lastCountry}` : ''}
                        </div>
                        {a?.denied7d > 0 && (
                          <div style={{ color: 'var(--red)', fontWeight: 700, marginTop: 2 }}>
                            ⛔ {a.denied7d} محاولة بلا صلاحية
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Btn
                      variant="ghost" size="sm"
                      title="سجل التحركات التفصيلي"
                      icon={<History size={12}/>}
                      onClick={() => setModal({ type: 'activity', employee: emp })}
                    >
                      السجل
                    </Btn>
                    {emp.role === 'accountant' && canManagePermissions && (
                      <Btn
                        variant="ghost" size="sm"
                        title="إدارة الصلاحيات"
                        icon={<Shield size={12}/>}
                        onClick={() => setModal({ type: 'perms', employee: emp })}
                      >
                        صلاحيات
                      </Btn>
                    )}
                    {canManageEmployees && (
                      <Btn
                        variant="ghost" size="sm"
                        title="تعديل"
                        icon={<Pencil size={13}/>}
                        onClick={() => setModal({ type: 'edit', employee: emp })}
                      />
                    )}
                    {canManageEmployees && (
                      <Btn
                        variant="danger" size="sm"
                        title={isMe ? 'لا يمكنك حذف حسابك' : 'حذف'}
                        icon={<Trash2 size={13}/>}
                        disabled={isMe}
                        onClick={() => !isMe && setModal({ type: 'delete', employee: emp })}
                      />
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="employee-manager-scroll-end" aria-hidden="true" />

      {modal?.type === 'activity' && (
        <ActivityModal employee={modal.employee} onClose={() => setModal(null)}/>
      )}

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
      {modal?.type === 'perms' && (
        <PermissionsModal
          employee={modal.employee}
          onClose={() => setModal(null)}
          onSave={handleSavePerms}
        />
      )}
    </div>
  );
}
