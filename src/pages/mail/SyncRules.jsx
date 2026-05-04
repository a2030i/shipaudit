import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Btn, toast, Spinner } from '../../components/UI.jsx';

const COND_FIELDS = [
  { value: 'from_email',     label: 'البريد المرسِل',   hasValue: true,  group: 'المرسِل'  },
  { value: 'from_domain',    label: 'نطاق المرسِل',     hasValue: true,  group: 'المرسِل'  },
  { value: 'subject',        label: 'الموضوع',           hasValue: true,  group: 'النص'    },
  { value: 'body',           label: 'محتوى الإيميل',    hasValue: true,  group: 'النص'    },
  { value: 'has_attachment', label: '✓ فيه أي مرفق',   hasValue: false, group: 'المرفقات' },
  { value: 'has_excel',      label: '✓ فيه Excel',     hasValue: false, group: 'المرفقات' },
  { value: 'has_pdf',        label: '✓ فيه PDF',       hasValue: false, group: 'المرفقات' },
  { value: 'no_attachment',  label: '✗ بدون أي مرفق',  hasValue: false, group: 'المرفقات' },
  { value: 'no_excel',       label: '✗ بدون Excel',    hasValue: false, group: 'المرفقات' },
  { value: 'no_pdf',         label: '✗ بدون PDF',      hasValue: false, group: 'المرفقات' },
];

const COND_OPS = [
  { value: 'contains',    label: 'يحتوي'   },
  { value: 'equals',      label: 'يساوي'   },
  { value: 'starts_with', label: 'يبدأ بـ' },
  { value: 'ends_with',   label: 'ينتهي بـ'},
];

const ACTIONS = [
  { value: 'block',            label: '🚫 حظر (لا ينشئ مهمة)',      hasValue: false },
  { value: 'set_priority',     label: '⚡ تعيين الأولوية',           hasValue: true  },
  { value: 'assign_role',      label: '👥 تعيين لدور (أول موظف)',   hasValue: true  },
  { value: 'assign_employee',  label: '👤 تعيين لموظف محدد',        hasValue: true  },
];

const PRIORITIES = [
  { value: 'low',    label: 'منخفضة' },
  { value: 'normal', label: 'عادية'  },
  { value: 'high',   label: 'عالية'  },
  { value: 'urgent', label: 'عاجلة'  },
];

const ACTION_COLORS = {
  block:            '#f87171',
  set_priority:     '#fbbf24',
  assign_role:      '#38bdf8',
  assign_employee:  '#a78bfa',
};

const EMPTY_RULE = {
  name: '', enabled: true, sort_order: 0,
  cond_field: 'subject', cond_op: 'contains', cond_value: '',
  action: 'block', action_value: '',
};

const QUICK_RULES = [
  {
    name: 'حظر الإيميلات بدون مرفقات',
    cond_field: 'no_attachment', cond_op: 'is_true', cond_value: '',
    action: 'block', action_value: '',
    icon: '📎', color: '#f87171', desc: 'أي إيميل لا يحتوي على ملف Excel أو PDF يُحذف',
  },
  {
    name: 'حظر إيميلات بدون Excel',
    cond_field: 'no_excel', cond_op: 'is_true', cond_value: '',
    action: 'block', action_value: '',
    icon: '📊', color: '#f87171', desc: 'يُقبل فقط ما يحتوي على ملف Excel',
  },
  {
    name: 'حظر إيميلات بدون PDF',
    cond_field: 'no_pdf', cond_op: 'is_true', cond_value: '',
    action: 'block', action_value: '',
    icon: '📄', color: '#f87171', desc: 'يُقبل فقط ما يحتوي على ملف PDF',
  },
  {
    name: 'عاجل: الإيميلات التي تحتوي "urgent"',
    cond_field: 'subject', cond_op: 'contains', cond_value: 'urgent',
    action: 'set_priority', action_value: 'urgent',
    icon: '🚨', color: '#fbbf24', desc: 'أي موضوع يحتوي "urgent" يُعيَّن أولوية عاجلة',
  },
];

const inp = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 12px',
  color: 'var(--fg)', fontSize: 13,
};

export default function SyncRules() {
  const [rules,    setRules]    = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [aiOn,     setAiOn]     = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [{ data: rulesData }, { data: profilesData }, { data: aiRow }] = await Promise.all([
      supabase.from('sync_rules').select('*').order('sort_order').order('created_at'),
      supabase.from('profiles').select('id, name, role').order('role'),
      supabase.from('app_settings').select('value').eq('key', 'AI_AUTO_CLASSIFY').maybeSingle(),
    ]);
    setRules(rulesData ?? []);
    setProfiles(profilesData ?? []);
    setAiOn(aiRow?.value === 'true');
    setLoading(false);
  }

  async function addQuickRule(template) {
    const exists = rules.some(r => r.name === template.name);
    if (exists) { toast('هذه القاعدة موجودة مسبقاً', 'warn'); return; }
    const payload = {
      name: template.name, enabled: true,
      sort_order: rules.length,
      cond_field: template.cond_field,
      cond_op: template.cond_op,
      cond_value: template.cond_value,
      action: template.action,
      action_value: template.action_value,
    };
    const { data, error } = await supabase.from('sync_rules').insert(payload).select().single();
    if (error) { toast(error.message, 'error'); return; }
    setRules(prev => [...prev, data]);
    toast(`✓ تمت إضافة: ${template.name}`);
  }

  async function toggleAi() {
    setAiSaving(true);
    const next = !aiOn;
    await supabase.from('app_settings').upsert(
      { key: 'AI_AUTO_CLASSIFY', value: String(next) },
      { onConflict: 'key' }
    );
    setAiOn(next);
    setAiSaving(false);
    toast(next ? '🤖 التصنيف الذكي مفعّل' : 'تم إيقاف التصنيف الذكي');
  }

  async function toggleRule(rule) {
    const { error } = await supabase
      .from('sync_rules').update({ enabled: !rule.enabled }).eq('id', rule.id);
    if (!error) setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
  }

  async function deleteRule(id) {
    if (!confirm('حذف هذه القاعدة؟')) return;
    await supabase.from('sync_rules').delete().eq('id', id);
    setRules(prev => prev.filter(r => r.id !== id));
    toast('تم الحذف');
  }

  async function saveRule() {
    const cf = COND_FIELDS.find(f => f.value === editRule.cond_field);
    const ac = ACTIONS.find(a => a.value === editRule.action);
    if (!editRule.name.trim()) return toast('أدخل اسماً للقاعدة', 'error');
    if (cf?.hasValue && !editRule.cond_value.trim()) return toast('أدخل قيمة الشرط', 'error');
    if (ac?.hasValue && !editRule.action_value) return toast('اختر قيمة الإجراء', 'error');

    setSaving(true);
    const payload = {
      name: editRule.name.trim(),
      enabled: editRule.enabled,
      sort_order: editRule.sort_order,
      cond_field: editRule.cond_field,
      cond_op: cf?.hasValue ? editRule.cond_op : 'is_true',
      cond_value: cf?.hasValue ? editRule.cond_value.trim() : '',
      action: editRule.action,
      action_value: ac?.hasValue ? editRule.action_value : '',
    };

    if (editRule.id) {
      const { error } = await supabase.from('sync_rules').update(payload).eq('id', editRule.id);
      if (error) { toast(error.message, 'error'); }
      else { setRules(prev => prev.map(r => r.id === editRule.id ? { ...r, ...payload } : r)); toast('تم الحفظ ✓'); setEditRule(null); }
    } else {
      const { data, error } = await supabase.from('sync_rules').insert(payload).select().single();
      if (error) { toast(error.message, 'error'); }
      else { setRules(prev => [...prev, data]); toast('تمت الإضافة ✓'); setEditRule(null); }
    }
    setSaving(false);
  }

  const condFieldDef = COND_FIELDS.find(f => f.value === editRule?.cond_field);
  const actionDef    = ACTIONS.find(a => a.value === editRule?.action);
  const uniqueRoles  = [...new Set(profiles.map(p => p.role))];

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <Spinner size={22}/>
    </div>
  );

  return (
    <div style={{ padding: '24px 28px', maxWidth: 700, margin: '0 auto' }} dir="rtl">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>⚡ قواعد المزامنة</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            تحكم تلقائي بالإيميلات قبل إنشاء المهام — حظر، تعيين أولوية، تكليف
          </p>
        </div>
        <Btn onClick={() => setEditRule({ ...EMPTY_RULE, sort_order: rules.length })}>
          + قاعدة جديدة
        </Btn>
      </div>

      {/* AI Toggle */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>🤖 التصنيف الذكي بالـAI</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            يحلل كل إيميل جديد تلقائياً ويعيّن الأولوية والملخص
          </div>
        </div>
        <Toggle on={aiOn} onChange={toggleAi} disabled={aiSaving}/>
      </div>

      {/* How it works */}
      <div style={{
        background: 'rgba(56,189,248,.05)', border: '1px solid rgba(56,189,248,.15)',
        borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: 'var(--muted)',
        lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--accent)' }}>كيف تعمل؟</strong>
        {' '}عند كل مزامنة، يُفحص كل إيميل جديد بالترتيب:
        {' '}<span style={{ color: '#f87171' }}>حظر</span> → لا تُنشأ مهمة.
        {' '}<span style={{ color: '#fbbf24' }}>أولوية</span> / <span style={{ color: '#38bdf8' }}>تكليف</span> → تُطبَّق على المهمة المُنشأة.
        {' '}إذا كان AI مفعّلاً يُضاف ملخص وتصنيف تلقائي.
      </div>

      {/* Quick rules */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>
          ⚡ قواعد جاهزة — اضغط لإضافة فوراً
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {QUICK_RULES.map(tpl => {
            const alreadyExists = rules.some(r => r.name === tpl.name);
            return (
              <div key={tpl.name} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'var(--bg)', border: `1px solid ${alreadyExists ? 'rgba(74,222,128,.25)' : 'var(--border)'}`,
                borderRadius: 9, padding: '10px 14px',
                opacity: alreadyExists ? 0.6 : 1,
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{tpl.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                    {tpl.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tpl.desc}</div>
                </div>
                {alreadyExists ? (
                  <span style={{ fontSize: 11, color: '#4ade80', flexShrink: 0 }}>✓ مضافة</span>
                ) : (
                  <button onClick={() => addQuickRule(tpl)} style={{
                    flexShrink: 0, fontSize: 11, padding: '5px 14px', borderRadius: 7, cursor: 'pointer',
                    background: `${tpl.color}15`, border: `1px solid ${tpl.color}40`,
                    color: tpl.color, fontWeight: 600,
                  }}>+ إضافة</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>قواعدك المخصصة</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }}/>
      </div>

      {/* Rules */}
      {rules.length === 0 ? (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13,
        }}>
          لا توجد قواعد — أضف قاعدة للتحكم في الإيميلات الواردة
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map(rule => {
            const cf = COND_FIELDS.find(f => f.value === rule.cond_field);
            const ac = ACTIONS.find(a => a.value === rule.action);
            const col = ACTION_COLORS[rule.action] ?? '#94a3b8';
            const actionValueLabel = rule.action === 'assign_employee'
              ? (profiles.find(p => p.id === rule.action_value)?.name ?? rule.action_value)
              : rule.action_value;
            return (
              <div key={rule.id} style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 12,
                opacity: rule.enabled ? 1 : 0.45, transition: 'opacity .2s',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 5 }}>{rule.name}</div>
                  <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ background: 'var(--bg)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 5 }}>
                      إذا: {cf?.label}
                      {rule.cond_value ? ` "${rule.cond_value}"` : ''}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>→</span>
                    <span style={{ background: `${col}18`, color: col, border: `1px solid ${col}30`, padding: '2px 8px', borderRadius: 5 }}>
                      {ac?.label}
                      {actionValueLabel ? `: ${actionValueLabel}` : ''}
                    </span>
                  </div>
                </div>
                <Toggle on={rule.enabled} onChange={() => toggleRule(rule)} size="sm"/>
                <button onClick={() => setEditRule({ ...rule })} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', padding: '4px 6px', fontSize: 15, lineHeight: 1,
                }} title="تعديل">✏️</button>
                <button onClick={() => deleteRule(rule.id)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#f87171', padding: '4px 6px', fontSize: 15, lineHeight: 1,
                }} title="حذف">🗑️</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {editRule && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
          }}
          onClick={e => e.target === e.currentTarget && setEditRule(null)}
        >
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 16, padding: 24, width: '100%', maxWidth: 480,
            display: 'flex', flexDirection: 'column', gap: 16,
          }} dir="rtl">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              {editRule.id ? 'تعديل القاعدة' : 'قاعدة جديدة'}
            </h3>

            {/* Name */}
            <label style={{ fontSize: 13 }}>
              <div style={{ marginBottom: 6, color: 'var(--muted)', fontWeight: 500 }}>اسم القاعدة</div>
              <input
                value={editRule.name}
                onChange={e => setEditRule(p => ({ ...p, name: e.target.value }))}
                placeholder="مثال: حظر رسائل DHL التلقائية"
                style={inp}
              />
            </label>

            {/* Condition */}
            <div style={{ fontSize: 13 }}>
              <div style={{ marginBottom: 8, color: 'var(--muted)', fontWeight: 500 }}>الشرط (إذا…)</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: condFieldDef?.hasValue ? 8 : 0 }}>
                <select
                  value={editRule.cond_field}
                  onChange={e => setEditRule(p => ({ ...p, cond_field: e.target.value, cond_op: 'contains', cond_value: '' }))}
                  style={{ ...inp, flex: 1 }}
                >
                  {COND_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                {condFieldDef?.hasValue && (
                  <select
                    value={editRule.cond_op}
                    onChange={e => setEditRule(p => ({ ...p, cond_op: e.target.value }))}
                    style={{ ...inp, flex: '0 0 115px' }}
                  >
                    {COND_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </div>
              {condFieldDef?.hasValue && (
                <input
                  value={editRule.cond_value}
                  onChange={e => setEditRule(p => ({ ...p, cond_value: e.target.value }))}
                  placeholder={
                    editRule.cond_field === 'from_domain' ? 'aramex.com' :
                    editRule.cond_field === 'from_email'  ? 'noreply@dhl.com' :
                    'نص البحث...'
                  }
                  style={inp}
                />
              )}
            </div>

            {/* Action */}
            <div style={{ fontSize: 13 }}>
              <div style={{ marginBottom: 8, color: 'var(--muted)', fontWeight: 500 }}>الإجراء (فعل…)</div>
              <select
                value={editRule.action}
                onChange={e => setEditRule(p => ({ ...p, action: e.target.value, action_value: '' }))}
                style={{ ...inp, marginBottom: actionDef?.hasValue ? 8 : 0 }}
              >
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              {actionDef?.hasValue && editRule.action === 'set_priority' && (
                <select
                  value={editRule.action_value}
                  onChange={e => setEditRule(p => ({ ...p, action_value: e.target.value }))}
                  style={inp}
                >
                  <option value="">اختر الأولوية</option>
                  {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              )}
              {actionDef?.hasValue && editRule.action === 'assign_role' && (
                <select
                  value={editRule.action_value}
                  onChange={e => setEditRule(p => ({ ...p, action_value: e.target.value }))}
                  style={inp}
                >
                  <option value="">اختر الدور</option>
                  {uniqueRoles.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
              )}
              {actionDef?.hasValue && editRule.action === 'assign_employee' && (
                <select
                  value={editRule.action_value}
                  onChange={e => setEditRule(p => ({ ...p, action_value: e.target.value }))}
                  style={inp}
                >
                  <option value="">اختر الموظف</option>
                  {profiles.filter(p => p.role !== 'admin').map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.role === 'accountant1' ? 'محاسب أول' : 'محاسب ثانٍ'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button
                onClick={() => setEditRule(null)}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
              >إلغاء</button>
              <Btn onClick={saveRule} disabled={saving}>{saving ? '...' : 'حفظ'}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange, disabled = false, size = 'md' }) {
  const w = size === 'sm' ? 34 : 44;
  const h = size === 'sm' ? 19 : 24;
  const d = size === 'sm' ? 15 : 20;
  const offset = size === 'sm' ? 2 : 2;
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      style={{
        width: w, height: h, borderRadius: h / 2, border: 'none',
        cursor: disabled ? 'default' : 'pointer', flexShrink: 0,
        background: on ? '#4ade80' : 'var(--border)',
        position: 'relative', transition: 'background .2s',
      }}
    >
      <span style={{
        position: 'absolute', top: offset,
        left: on ? w - d - offset : offset,
        width: d, height: d, borderRadius: '50%',
        background: '#fff', transition: 'left .2s',
      }}/>
    </button>
  );
}
