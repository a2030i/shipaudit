import { useState, useEffect } from 'react';
import { Card, StatCard, Empty, Btn } from '../components/UI.jsx';
import { loadAuditsFromDB } from '../lib/coreService.js';

export default function Dashboard({ carriers, onNavigate }) {
  const [audits,  setAudits]  = useState([]);

  useEffect(() => {
    loadAuditsFromDB(10).then(setAudits).catch(() => {});
  }, []);

  const totalMis = audits.reduce((s, a) => s + (a.issueCount ?? 0), 0);
  const totalOk  = audits.reduce((s, a) => s + Math.max(0, (a.rowCount ?? 0) - (a.issueCount ?? 0)), 0);
  const totalDif = audits.reduce((s, a) => s + Number(a.diff ?? 0), 0);

  return (
    <div className="stagger" style={{padding:'28px 32px',maxWidth:1200}}>

      {/* Welcome */}
      <div style={{marginBottom:28}}>
        <h1 style={{fontFamily:'var(--font-mono)',fontSize:22,color:'var(--text)',marginBottom:4}}>
          ShipAudit <span style={{color:'var(--accent)'}}>Pro</span>
        </h1>
        <p style={{color:'var(--muted)',fontSize:13}}>نظام مراقبة وتدقيق فواتير شركات الشحن</p>
      </div>

      {/* Quick stats */}
      <div style={{display:'flex',gap:14,flexWrap:'wrap',marginBottom:28}}>
        <StatCard label="شركات الشحن" value={carriers.length} color="var(--accent)" icon="🏢"
          onClick={()=>onNavigate('carriers')}/>
        <StatCard label="مراجعات مكتملة" value={audits.length} color="var(--purple)" icon="📋"
          onClick={()=>onNavigate('audits')}/>
        <StatCard label="شحنات مطابقة ✓" value={totalOk} color="var(--green)" icon="✓"/>
        <StatCard label="شحنات بها فروق" value={totalMis} color="var(--red)" icon="✗"
          onClick={()=>onNavigate('audits')}/>
        {audits.length > 0 && (
          <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:11,padding:'14px 18px',
            borderTop:`3px solid ${totalDif>0?'var(--red)':'var(--green)'}`}}>
            <div style={{color:'var(--muted)',fontSize:10,fontFamily:'var(--font-mono)',marginBottom:4}}>إجمالي الفروق (ر.س)</div>
            <div style={{color:totalDif>0?'var(--red)':'var(--green)',fontSize:22,fontFamily:'var(--font-mono)',fontWeight:700}}>
              {totalDif>=0?'+':''}{totalDif.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:28}}>

        {/* Carriers list */}
        <Card style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontFamily:'var(--font-mono)',fontSize:13,color:'var(--accent)'}}>🏢 شركات الشحن</span>
            <Btn size="sm" variant="outline" onClick={()=>onNavigate('carriers')}>إدارة</Btn>
          </div>
          {carriers.length === 0
            ? <Empty icon="🏢" title="لا توجد شركات بعد" sub="أضف شركة شحن للبدء"/>
            : (
              <div style={{maxHeight:280,overflowY:'auto'}}>
                {carriers.map(c => (
                  <div key={c.id} style={{padding:'11px 18px',borderBottom:'1px solid var(--border)22',display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}
                    onClick={()=>onNavigate('carriers',{carrierId:c.id})}>
                    <span style={{fontSize:22}}>{c.logo||'📦'}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13}}>{c.name}</div>
                      <div style={{color:'var(--muted)',fontSize:11}}>
                        {c.contracts?.length||0} عقد · {Object.keys(c.contracts?.[0]?.pricing||{}).length} دولة
                      </div>
                    </div>
                    <div style={{width:8,height:8,borderRadius:'50%',background:c.color||'var(--accent)'}}/>
                  </div>
                ))}
              </div>
            )
          }
        </Card>

        {/* Recent audits */}
        <Card style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontFamily:'var(--font-mono)',fontSize:13,color:'var(--accent)'}}>📋 آخر المراجعات</span>
            <Btn size="sm" variant="success" onClick={()=>onNavigate('upload')}>+ مراجعة جديدة</Btn>
          </div>
          {audits.length === 0
            ? <Empty icon="📋" title="لا توجد مراجعات بعد" sub="ارفع ملف Excel للبدء"/>
            : (
              <div style={{maxHeight:280,overflowY:'auto'}}>
                {audits.map(a => (
                  <div key={a.id} style={{padding:'11px 18px',borderBottom:'1px solid var(--border)22',display:'flex',alignItems:'center',gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13}}>{a.carrierName}</div>
                      <div style={{color:'var(--muted)',fontSize:11}}>{a.period} · {a.rowCount??0} شحنة</div>
                    </div>
                    <div style={{textAlign:'left'}}>
                      <div style={{color:(a.issueCount??0)>0?'var(--red)':'var(--green)',fontFamily:'var(--font-mono)',fontSize:12,fontWeight:700}}>
                        {(a.issueCount??0)>0?`✗ ${a.issueCount} فرق`:'✓ مطابق'}
                      </div>
                      <div style={{color:'var(--muted)',fontSize:10}}>{new Date(a.date).toLocaleDateString('ar-SA')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </Card>
      </div>

      {/* CTA */}
      {carriers.length === 0 && (
        <Card accent="var(--accent)" style={{textAlign:'center',padding:32}}>
          <div style={{fontSize:36,marginBottom:12}}>🚀</div>
          <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>ابدأ بإضافة شركة شحن</div>
          <div style={{color:'var(--muted)',fontSize:13,marginBottom:20}}>أضف الشركات وعقودها ثم ارفع الفواتير للتدقيق</div>
          <Btn onClick={()=>onNavigate('carriers')} icon="🏢">إضافة شركة شحن</Btn>
        </Card>
      )}
    </div>
  );
}
