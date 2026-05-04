import { useState } from 'react';
import { Card, Btn, Input, Select, Modal, Empty, toast } from '../components/UI.jsx';
import { loadSettings, saveSettings } from '../data/carriers.js';
import { loadAudits, deleteAudit } from '../data/carriers.js';
import { OR_MODELS } from '../engine/openrouter.js';

// ── Settings ──────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const [s,  setS]  = useState(loadSettings());
  const [vis, setVis] = useState(false);

  const save = () => { saveSettings(s); toast('تم حفظ الإعدادات ✓','success'); };

  return (
    <div style={{padding:'28px 32px',maxWidth:600}}>
      <h2 style={{fontFamily:'var(--font-mono)',color:'var(--accent)',marginBottom:24}}>⚙️ الإعدادات</h2>

      <Card style={{marginBottom:20}}>
        <h3 style={{fontSize:14,fontWeight:700,marginBottom:16,display:'flex',alignItems:'center',gap:8}}>
          <span>✨</span> OpenRouter AI
        </h3>

        <div style={{marginBottom:14}}>
          <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:5}}>
            API Key
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
              style={{color:'var(--accent)',marginRight:6,textDecoration:'none',fontSize:10}}>
              احصل على مفتاح ↗
            </a>
          </label>
          <div style={{display:'flex',gap:8}}>
            <input
              type={vis?'text':'password'}
              value={s.openrouterKey}
              onChange={e=>setS({...s,openrouterKey:e.target.value})}
              placeholder="sk-or-..."
              style={{flex:1,padding:'8px 11px',borderRadius:7,fontSize:13,fontFamily:'var(--font-mono)'}}/>
            <Btn size="sm" variant="ghost" onClick={()=>setVis(v=>!v)}>{vis?'🙈':'👁'}</Btn>
          </div>
        </div>

        <div style={{marginBottom:16}}>
          <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:5}}>النموذج</label>
          <select value={s.openrouterModel} onChange={e=>setS({...s,openrouterModel:e.target.value})}
            style={{width:'100%',padding:'8px 11px',borderRadius:7,fontSize:13,cursor:'pointer'}}>
            {OR_MODELS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        <div style={{background:'var(--surface)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,lineHeight:1.8,color:'var(--muted)'}}>
          <strong style={{color:'var(--text)'}}>ما يفعله AI في ShipAudit:</strong><br/>
          • تعيين أعمدة الملف تلقائياً ✨<br/>
          • تحليل نتائج التدقيق وإعداد تقرير احترافي 📊<br/>
          • الإجابة على أسئلتك حول الفروق والعقود 💬<br/>
          • استخراج التسعيرة من نص العقد مستقبلاً 📄
        </div>

        <Btn variant="primary" onClick={save} style={{width:'100%',justifyContent:'center'}}>
          حفظ الإعدادات
        </Btn>
      </Card>

      <Card>
        <h3 style={{fontSize:14,fontWeight:700,marginBottom:14}}>🗄️ البيانات</h3>
        <div style={{display:'flex',gap:10}}>
          <Btn size="sm" variant="ghost" onClick={()=>{
            const data = {
              carriers: JSON.parse(localStorage.getItem('shipaudit_carriers_v2')||'[]'),
              audits:   JSON.parse(localStorage.getItem('shipaudit_audits_v2')||'[]'),
            };
            const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `shipaudit_backup_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            toast('تم تصدير البيانات','success');
          }}>⬇️ تصدير نسخة احتياطية</Btn>
          <Btn size="sm" variant="danger" onClick={()=>{
            if(confirm('هل أنت متأكد؟ سيتم حذف جميع البيانات.')) {
              localStorage.clear(); window.location.reload();
            }
          }}>🗑 مسح جميع البيانات</Btn>
        </div>
      </Card>
    </div>
  );
}

// ── Audits History ─────────────────────────────────────────────────────────────
export function AuditsHistory({ onOpen }) {
  const [audits, setAudits] = useState(() => loadAudits());
  const [confirm, setConfirm] = useState(null);

  const handleDelete = (id) => {
    setAudits(deleteAudit(id));
    setConfirm(null);
    toast('تم حذف المراجعة','info');
  };

  return (
    <div style={{padding:'28px 32px',maxWidth:900}}>
      <h2 style={{fontFamily:'var(--font-mono)',color:'var(--accent)',marginBottom:24}}>📋 سجل المراجعات</h2>

      {audits.length===0
        ? <Empty icon="📋" title="لا توجد مراجعات بعد" sub="ارفع ملف Excel لبدء أول مراجعة"/>
        : (
          <div className="stagger">
            {audits.map(a=>(
              <Card key={a.id} style={{marginBottom:12,padding:0,overflow:'hidden'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:16,padding:'14px 18px',alignItems:'center'}}>
                  <div style={{display:'flex',gap:14,alignItems:'center'}}>
                    <div style={{fontSize:28}}>📦</div>
                    <div>
                      <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{a.carrierName}</div>
                      <div style={{color:'var(--muted)',fontSize:12}}>{a.period} · {a.summary?.total||0} شحنة · {new Date(a.createdAt).toLocaleString('ar-SA')}</div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <div style={{textAlign:'center',minWidth:80}}>
                      <div style={{color:a.summary?.mismatch>0?'var(--red)':'var(--green)',fontFamily:'var(--font-mono)',fontWeight:700,fontSize:14}}>
                        {a.summary?.mismatch>0?`✗ ${a.summary.mismatch}`:'✓ كامل'}
                      </div>
                      {a.summary?.mismatch>0&&(
                        <div style={{color:'var(--red)',fontFamily:'var(--font-mono)',fontSize:11}}>
                          +{a.summary.totalDiff?.toFixed(2)} ر.س
                        </div>
                      )}
                    </div>
                    <Btn size="sm" variant="primary" onClick={()=>onOpen(a)}>فتح</Btn>
                    <Btn size="sm" variant="danger" onClick={()=>setConfirm(a.id)}>🗑</Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      }

      {confirm && (
        <Modal title="⚠️ حذف المراجعة" onClose={()=>setConfirm(null)} width={360}>
          <p style={{color:'var(--muted)',marginBottom:20}}>سيتم حذف هذه المراجعة نهائياً.</p>
          <div style={{display:'flex',gap:9,justifyContent:'flex-end'}}>
            <Btn variant="ghost" onClick={()=>setConfirm(null)}>إلغاء</Btn>
            <Btn variant="danger" onClick={()=>handleDelete(confirm)}>حذف</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
