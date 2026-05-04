import { useState } from 'react';
import { loadCarriers, saveCarriers } from './data/carriers.js';
import { ToastContainer } from './components/UI.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CarrierManager from './pages/CarrierManager.jsx';
import UploadWizard from './pages/UploadWizard.jsx';
import AuditResults from './pages/AuditResults.jsx';
import { SettingsPage, AuditsHistory } from './pages/Settings.jsx';

const NAV = [
  { id:'dashboard', label:'الرئيسية',    icon:'🏠' },
  { id:'carriers',  label:'شركات الشحن', icon:'🏢' },
  { id:'upload',    label:'مراجعة جديدة',icon:'⬆️' },
  { id:'audits',    label:'السجل',       icon:'📋' },
  { id:'settings',  label:'الإعدادات',   icon:'⚙️' },
];

export default function App() {
  const [carriers, setCarriers] = useState(() => loadCarriers());
  const [page,     setPage]     = useState('dashboard');
  const [pageCtx,  setPageCtx]  = useState({});
  const [audit,    setAudit]    = useState(null);

  const navigate = (p, ctx={}) => { setPage(p); setPageCtx(ctx); };

  const handleAuditComplete = (a) => {
    setAudit(a);
    setPage('results');
  };

  const handleOpenAudit = (a) => {
    setAudit(a);
    setPage('results');
  };

  return (
    <>
      <div style={{display:'flex',flexDirection:'column',minHeight:'100vh'}}>
        {/* Top nav */}
        <nav style={{
          background:'var(--surface)',
          borderBottom:'1px solid var(--border)',
          height:56,
          display:'flex',
          alignItems:'center',
          padding:'0 20px',
          gap:4,
          flexShrink:0,
          position:'sticky',
          top:0,
          zIndex:100,
        }}>
          {/* Logo */}
          <div style={{display:'flex',alignItems:'center',gap:10,marginLeft:20}}>
            <div style={{
              background:'linear-gradient(135deg,var(--accent2),var(--accent))',
              width:32,height:32,borderRadius:8,
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,
            }}>🔍</div>
            <div>
              <div style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:13,color:'var(--accent)',lineHeight:1}}>ShipAudit</div>
              <div style={{fontSize:9,color:'var(--muted)',lineHeight:1}}>Pro</div>
            </div>
          </div>

          <div style={{width:1,height:28,background:'var(--border)',margin:'0 12px'}}/>

          {/* Nav items */}
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>navigate(n.id)} style={{
              display:'flex',alignItems:'center',gap:6,
              background:page===n.id?'var(--accent)18':'transparent',
              border:`1px solid ${page===n.id?'var(--accent)30':'transparent'}`,
              color:page===n.id?'var(--accent)':'var(--muted)',
              borderRadius:8,padding:'6px 12px',cursor:'pointer',
              fontFamily:'var(--font-sans)',fontSize:13,fontWeight:page===n.id?600:400,
              transition:'all .15s',
            }}>
              <span>{n.icon}</span>
              <span style={{display:'none',['@media (min-width: 640px)']:{display:'inline'}}}>{n.label}</span>
            </button>
          ))}

          <div style={{flex:1}}/>

          {/* Carrier count badge */}
          <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--font-mono)',background:'var(--card)',padding:'3px 10px',borderRadius:8,border:'1px solid var(--border)'}}>
            {carriers.length} شركة
          </div>
        </nav>

        {/* Page content */}
        <main style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          {page==='dashboard' && (
            <div style={{overflowY:'auto',flex:1}}>
              <Dashboard carriers={carriers} onNavigate={navigate}/>
            </div>
          )}
          {page==='carriers' && (
            <CarrierManager carriers={carriers} setCarriers={setCarriers}/>
          )}
          {page==='upload' && (
            <div style={{overflowY:'auto',flex:1}}>
              <UploadWizard carriers={carriers} onComplete={handleAuditComplete}/>
            </div>
          )}
          {page==='results' && audit && (
            <AuditResults audit={audit} carriers={carriers} onNewAudit={()=>navigate('upload')}/>
          )}
          {page==='results' && !audit && (
            <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>
              لا توجد نتائج — <button onClick={()=>navigate('upload')} style={{color:'var(--accent)',background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font-sans)'}}>ابدأ مراجعة جديدة</button>
            </div>
          )}
          {page==='audits' && (
            <div style={{overflowY:'auto',flex:1}}>
              <AuditsHistory onOpen={handleOpenAudit}/>
            </div>
          )}
          {page==='settings' && (
            <div style={{overflowY:'auto',flex:1}}>
              <SettingsPage/>
            </div>
          )}
        </main>
      </div>
      <ToastContainer/>
    </>
  );
}
