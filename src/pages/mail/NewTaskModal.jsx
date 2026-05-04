import { useState } from 'react';
import { Spinner, Btn, toast } from '../../components/UI.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { supabase } from '../../lib/supabase.js';
import { createTask, assignTaskByType, uploadFile } from '../../lib/mailService.js';
import { aiAnalyzeEmail } from '../../engine/openrouter.js';

const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'منخفض' },
  { value: 'normal', label: 'عادي' },
  { value: 'high',   label: 'عالي' },
  { value: 'urgent', label: '🚨 عاجل' },
];

export default function NewTaskModal({ onClose, onCreated }) {
  const { profile } = useAuth();

  // Email fields
  const [subject,  setSubject]  = useState('');
  const [from,     setFrom]     = useState('');
  const [fromName, setFromName] = useState('');
  const [body,     setBody]     = useState('');
  const [priority, setPriority] = useState('normal');
  const [files,    setFiles]    = useState([]);

  // AI analysis
  const [analyzing,  setAnalyzing]  = useState(false);
  const [aiResult,   setAiResult]   = useState(null);

  const [saving, setSaving] = useState(false);

  const inp = {
    width: '100%', padding: '8px 11px', borderRadius: 8, fontSize: 12,
    background: 'var(--surface)', border: '1px solid var(--border)',
    color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  };

  const runAI = async () => {
    if (!subject && !body) { toast('أدخل الموضوع أو المحتوى أولاً', 'warn'); return; }
    setAnalyzing(true);
    try {
      const attachNames = files.map(f => f.name);
      const result = await aiAnalyzeEmail(subject, body, attachNames);
      setAiResult(result);
      if (result.priority && result.priority !== 'normal') setPriority(result.priority);
    } catch (e) { toast(`خطأ في التحليل: ${e.message}`, 'error'); }
    setAnalyzing(false);
  };

  const handleFiles = (e) => {
    const picked = Array.from(e.target.files);
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...picked.filter(f => !existing.has(f.name))];
    });
  };

  const removeFile = (name) => setFiles(prev => prev.filter(f => f.name !== name));

  const save = async () => {
    if (!subject.trim()) { toast('الموضوع مطلوب', 'warn'); return; }
    setSaving(true);
    try {
      // Create task first (without attachments)
      const taskData = {
        email_subject:   subject.trim(),
        email_from:      from.trim(),
        email_from_name: fromName.trim(),
        email_body:      body.trim(),
        priority,
        status:          'analyzing',
        ai_is_financial: aiResult?.is_financial ?? false,
        ai_summary:      aiResult?.summary ?? '',
        ai_category:     aiResult?.category ?? '',
        has_excel:       aiResult?.has_excel ?? files.some(f => /\.(xlsx?|csv)$/i.test(f.name)),
        has_pdf:         aiResult?.has_pdf   ?? files.some(f => /\.pdf$/i.test(f.name)),
      };

      const task = await createTask(taskData, [], profile.id);

      // Upload files
      const attachMeta = [];
      for (const file of files) {
        try {
          const meta = await uploadFile(file, task.id);
          attachMeta.push(meta);
        } catch (e) { toast(`فشل رفع ${file.name}: ${e.message}`, 'error'); }
      }

      // Insert attachment rows
      if (attachMeta.length) {
        await supabase.from('attachments').insert(
          attachMeta.map(a => ({ ...a, task_id: task.id }))
        );
      }

      // Auto-assign based on attachment types
      const hasExcel = taskData.has_excel;
      const hasPdf   = taskData.has_pdf;

      if (aiResult?.is_financial !== false) {
        await assignTaskByType(task.id, hasExcel, hasPdf);
      } else {
        await supabase.from('tasks').update({ status: 'not_financial' }).eq('id', task.id);
      }

      toast('تم إنشاء المهمة بنجاح ✓', 'success');
      onCreated?.();
      onClose();
    } catch (e) { toast(`خطأ: ${e.message}`, 'error'); }
    setSaving(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 580,
        background: 'var(--card)', borderRadius: 16,
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', overflow: 'hidden',
      }}>
        {/* Modal header */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📨 مهمة بريدية جديدة</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--muted)',
            cursor: 'pointer', fontSize: 18,
          }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* Basic fields */}
          <Field label="الموضوع *">
            <input value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="عنوان البريد الإلكتروني" style={inp}/>
          </Field>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <Field label="المرسِل (اسم)" style={{ flex: 1 }}>
              <input value={fromName} onChange={e => setFromName(e.target.value)}
                placeholder="اسم المرسل" style={inp}/>
            </Field>
            <Field label="البريد" style={{ flex: 1 }}>
              <input value={from} onChange={e => setFrom(e.target.value)}
                placeholder="sender@example.com" style={{ ...inp, direction: 'ltr' }}/>
            </Field>
          </div>

          <Field label="محتوى البريد">
            <textarea value={body} onChange={e => setBody(e.target.value)}
              rows={5} placeholder="الصق محتوى البريد هنا..."
              style={{ ...inp, resize: 'vertical', fontFamily: 'var(--font-sans)' }}/>
          </Field>

          <Field label="الأولوية">
            <div style={{ display: 'flex', gap: 6 }}>
              {PRIORITY_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setPriority(o.value)} style={{
                  flex: 1, padding: '6px 4px', borderRadius: 7, fontSize: 11,
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  background: priority === o.value ? 'var(--accent)20' : 'var(--surface)',
                  border: `1px solid ${priority === o.value ? 'var(--accent)' : 'var(--border)'}`,
                  color: priority === o.value ? 'var(--accent)' : 'var(--muted)',
                }}>{o.label}</button>
              ))}
            </div>
          </Field>

          {/* File attachments */}
          <Field label="المرفقات">
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--surface)', border: '1px dashed var(--border)',
              fontSize: 12, color: 'var(--muted)',
            }}>
              <input type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
                onChange={handleFiles} style={{ display: 'none' }}/>
              📎 إضافة مرفقات
            </label>
            {files.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {files.map(f => {
                  const isExcel = /\.(xlsx?|csv)$/i.test(f.name);
                  const isPdf   = /\.pdf$/i.test(f.name);
                  return (
                    <div key={f.name} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 7,
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      fontSize: 11,
                    }}>
                      <span>{isExcel ? '📊' : isPdf ? '📄' : '📎'}</span>
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <span style={{ color: 'var(--muted)' }}>
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      <button onClick={() => removeFile(f.name)} style={{
                        background: 'none', border: 'none', color: 'var(--muted)',
                        cursor: 'pointer', fontSize: 13, padding: 0,
                      }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </Field>

          {/* AI Analysis */}
          <div style={{
            marginTop: 4, padding: '12px 14px', borderRadius: 10,
            background: 'rgba(245,166,35,.07)', border: '1px solid rgba(245,166,35,.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: aiResult ? 10 : 0 }}>
              <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 600 }}>✨ تحليل الذكاء الاصطناعي</span>
              <Btn size="sm" variant="ghost" onClick={runAI} disabled={analyzing}
                style={{ fontSize: 11, color: 'var(--gold)' }}>
                {analyzing ? <Spinner size={11}/> : 'تحليل'}
              </Btn>
            </div>

            {aiResult && (
              <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                <AiRow icon={aiResult.is_financial ? '✅' : '❌'} label="مالي"
                  value={aiResult.is_financial ? `نعم (${Math.round((aiResult.confidence ?? 1) * 100)}%)` : 'لا'}
                  color={aiResult.is_financial ? 'var(--green)' : 'var(--muted)'}/>
                {aiResult.summary && <AiRow icon="📝" label="الملخص" value={aiResult.summary}/>}
                {aiResult.category && <AiRow icon="🏷" label="التصنيف" value={aiResult.category}/>}
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  {aiResult.has_excel && <span style={{ color: 'var(--green)', fontSize: 11 }}>📊 Excel</span>}
                  {aiResult.has_pdf   && <span style={{ color: 'var(--red)',   fontSize: 11 }}>📄 PDF</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, flexShrink: 0,
          background: 'var(--card)',
        }}>
          <Btn variant="ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>إلغاء</Btn>
          <Btn variant="primary" onClick={save} disabled={saving} style={{ flex: 2, justifyContent: 'center' }}>
            {saving ? <><Spinner size={13}/> جاري الحفظ...</> : '💾 حفظ المهمة'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function AiRow({ icon, label, value, color }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
      <span>{icon}</span>
      <span style={{ color: 'var(--muted)' }}>{label}:</span>
      <span style={{ color: color || 'var(--text)', flex: 1 }}>{value}</span>
    </div>
  );
}
