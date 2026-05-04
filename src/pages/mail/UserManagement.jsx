import { useState, useEffect } from 'react';
import { Spinner, Btn, toast } from '../../components/UI.jsx';
import { supabase } from '../../lib/supabase.js';
import { getAllProfiles, updateProfile } from '../../lib/mailService.js';

const ROLE_OPTIONS = [
  { value: 'admin',       label: 'مدير' },
  { value: 'accountant1', label: 'محاسب أول' },
  { value: 'accountant2', label: 'محاسب ثانٍ' },
];

const ROLE_COLOR = {
  admin:       '#a78bfa',
  accountant1: 'var(--gold)',
  accountant2: '#fb923c',
};

const AVATAR_COLORS = [
  '#38bdf8','#a78bfa','#fb923c','#34d399','#f87171','#fbbf24','#60a5fa','#f472b6',
];

export default function UserManagement({ onClose }) {
  const [profiles,  setProfiles]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);

  const load = async () => {
    setLoading(true);
    try { setProfiles(await getAllProfiles()); }
    catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: 'var(--card)', borderRadius: 16,
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '85vh', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>👥 إدارة المستخدمين</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" variant="primary" onClick={() => setShowForm(true)}>+ مستخدم جديد</Btn>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Spinner size={20}/>
            </div>
          ) : profiles.map(p => (
            <ProfileRow key={p.id} profile={p} onUpdated={load}/>
          ))}
        </div>
      </div>

      {showForm && (
        <NewUserForm
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

function ProfileRow({ profile, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [name,    setName]    = useState(profile.name);
  const [role,    setRole]    = useState(profile.role);
  const [color,   setColor]   = useState(profile.avatar_color || AVATAR_COLORS[0]);
  const [saving,  setSaving]  = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile(profile.id, { name, role, avatar_color: color });
      toast('تم التحديث ✓', 'success');
      setEditing(false);
      onUpdated();
    } catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
    setSaving(false);
  };

  const inp = {
    padding: '6px 10px', borderRadius: 7, fontSize: 12,
    background: 'var(--bg)', border: '1px solid var(--border)',
    color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{
      padding: '12px 20px', borderBottom: '1px solid var(--border)',
    }}>
      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: profile.avatar_color || '#38bdf8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#000',
          }}>
            {profile.name?.[0] ?? '?'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{profile.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{profile.email}</div>
          </div>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 9,
            background: `${ROLE_COLOR[profile.role] || 'var(--muted)'}20`,
            color: ROLE_COLOR[profile.role] || 'var(--muted)',
            border: `1px solid ${ROLE_COLOR[profile.role] || 'var(--muted)'}40`,
          }}>
            {ROLE_OPTIONS.find(r => r.value === profile.role)?.label ?? profile.role}
          </span>
          <Btn size="sm" variant="ghost" onClick={() => setEditing(true)}>تعديل</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>الاسم</label>
              <input value={name} onChange={e => setName(e.target.value)} style={inp}/>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>الدور</label>
              <select value={role} onChange={e => setRole(e.target.value)} style={inp}>
                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>لون الأفاتار</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {AVATAR_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{
                  width: 22, height: 22, borderRadius: '50%', background: c,
                  border: color === c ? '2px solid var(--text)' : '2px solid transparent',
                  cursor: 'pointer', padding: 0,
                }}/>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn size="sm" variant="ghost" onClick={() => setEditing(false)}>إلغاء</Btn>
            <Btn size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving ? <Spinner size={11}/> : 'حفظ'}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function NewUserForm({ onClose, onCreated }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [role,     setRole]     = useState('accountant1');
  const [loading,  setLoading]  = useState(false);

  const inp = {
    width: '100%', padding: '8px 11px', borderRadius: 8, fontSize: 12,
    background: 'var(--surface)', border: '1px solid var(--border)',
    color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  };

  const create = async () => {
    if (!email || !password || !name) { toast('جميع الحقول مطلوبة', 'warn'); return; }
    if (password.length < 6) { toast('كلمة المرور 6 أحرف على الأقل', 'warn'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { email, password, name, role },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast(`تم إنشاء حساب ${name} ✓`, 'success');
      onCreated();
    } catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 400,
        background: 'var(--card)', borderRadius: 14,
        border: '1px solid var(--border)', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>➕ مستخدم جديد</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {[
          { label: 'الاسم الكامل', value: name, set: setName, type: 'text', placeholder: 'محمد أحمد' },
          { label: 'البريد الإلكتروني', value: email, set: setEmail, type: 'email', placeholder: 'user@example.com' },
          { label: 'كلمة المرور', value: password, set: setPassword, type: 'password', placeholder: '••••••••' },
        ].map(f => (
          <div key={f.label} style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>{f.label}</label>
            <input type={f.type} value={f.value} onChange={e => f.set(e.target.value)}
              placeholder={f.placeholder} style={inp}/>
          </div>
        ))}

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>الدور</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {ROLE_OPTIONS.map(o => (
              <button key={o.value} onClick={() => setRole(o.value)} style={{
                flex: 1, padding: '7px 4px', borderRadius: 7, fontSize: 11, cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                background: role === o.value ? `${ROLE_COLOR[o.value]}20` : 'var(--surface)',
                border: `1px solid ${role === o.value ? ROLE_COLOR[o.value] : 'var(--border)'}`,
                color: role === o.value ? ROLE_COLOR[o.value] : 'var(--muted)',
              }}>{o.label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>إلغاء</Btn>
          <Btn variant="primary" onClick={create} disabled={loading} style={{ flex: 2, justifyContent: 'center' }}>
            {loading ? <><Spinner size={12}/> جاري الإنشاء...</> : '✓ إنشاء الحساب'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
