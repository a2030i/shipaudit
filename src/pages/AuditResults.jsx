import { useState, useRef } from 'react';
import { Card, Btn, StatCard, Badge, DiffCell, Spinner, Modal, Empty, toast } from '../components/UI.jsx';
import { exportAuditExcel } from '../engine/export.js';
import { aiAnalyzeAudit, aiChat } from '../engine/openrouter.js';
import { loadSettings, getActiveContract } from '../data/carriers.js';

// ── AI Panel ──────────────────────────────────────────────────────────────────
function AIPanel({ audit, carriers }) {
  const [msgs,      setMsgs]      = useState([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [analysis,  setAnalysis]  = useState('');
  const [anaLoading,setAnaLoading]= useState(false);
  const abortRef = useRef(null);
  const carrier = carriers.find(c=>c.id===audit.carrierId);

  const context = `
شركة: ${audit.carrierName}
الفترة: ${audit.period}
إجمالي شحنات: ${audit.summary.total}
فروق: ${audit.summary.mismatch}
إجمالي الفرق: ${audit.summary.totalDiff?.toFixed(2)} ر.س
فرق الشحن: ${audit.summary.deliveryDiff?.toFixed(2)} ر.س
فرق RSS: ${audit.summary.rssDiff?.toFixed(2)} ر.س
فرق الوقود: ${audit.summary.fuelDiff?.toFixed(2)} ر.س
الدول: ${Object.keys(audit.summary.byCountry||{}).join(', ')}
`.trim();

  const runAnalysis = async () => {
    const settings = loadSettings();
    if (!settings.openrouterKey) { toast('أدخل OpenRouter API Key في الإعدادات','warn'); return; }
    setAnaLoading(true);
    try {
      const text = await aiAnalyzeAudit(audit.summary, audit.carrierName, audit.period, abortRef.current?.signal);
      setAnalysis(text);
    } catch(e) { toast(`AI: ${e.message}`,'error'); }
    setAnaLoading(false);
  };

  const sendChat = async () => {
    if (!input.trim()) return;
    const settings = loadSettings();
    if (!settings.openrouterKey) { toast('أدخل OpenRouter API Key في الإعدادات','warn'); return; }
    const userMsg = { role:'user', content: input };
    setMsgs(m=>[...m, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const abort = new AbortController();
      abortRef.current = abort;
      const reply = await aiChat([...msgs, userMsg], context, abort.signal);
      setMsgs(m=>[...m, { role:'assistant', content:reply }]);
    } catch(e) { if(e.name!=='AbortError') toast(`AI: ${e.message}`,'error'); }
    setLoading(false);
  };

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border)',background:'var(--surface)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
          <span style={{fontSize:18}}>✨</span>
          <span style={{fontFamily:'var(--font-mono)',fontSize:13,color:'var(--accent)'}}>مساعد AI</span>
          <span style={{fontSize:10,color:'var(--muted)',background:'var(--card)',padding:'2px 7px',borderRadius:10}}>
            {loadSettings().openrouterModel?.split('/')[1]||'—'}
          </span>
        </div>
        <Btn size="sm" variant="gold" onClick={runAnalysis} disabled={anaLoading} style={{width:'100%',justifyContent:'center'}}>
          {anaLoading ? <><Spinner size={13}/> يحلل النتائج...</> : '📊 تحليل الفروق تلقائياً'}
        </Btn>
      </div>

      {analysis && (
        <div style={{padding:'12px 14px',background:'#f5a62310',borderBottom:'1px solid #f5a62330',fontSize:13,lineHeight:1.8}}>
          <div style={{color:'var(--gold)',fontSize:10,fontFamily:'var(--font-mono)',marginBottom:6}}>تحليل AI:</div>
          {analysis}
        </div>
      )}

      {/* Chat */}
      <div style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:10,minHeight:0}}>
        {msgs.length===0 && !analysis && (
          <div style={{textAlign:'center',padding:'24px 10px',color:'var(--muted)'}}>
            <div style={{fontSize:28,marginBottom:8}}>💬</div>
            <div style={{fontSize:12}}>اسأل AI عن النتائج أو اطلب منه صياغة رسالة لمدير الحساب</div>
          </div>
        )}
        {msgs.map((m,i)=>(
          <div key={i} style={{
            padding:'9px 12px',borderRadius:9,fontSize:13,lineHeight:1.7,
            background:m.role==='user'?'var(--accent)18':'var(--surface)',
            border:`1px solid ${m.role==='user'?'var(--accent)30':'var(--border)'}`,
            alignSelf:m.role==='user'?'flex-end':'flex-start',
            maxWidth:'90%',
          }}>
            <div style={{color:'var(--muted)',fontSize:10,marginBottom:4}}>{m.role==='user'?'أنت':'AI'}</div>
            {m.content}
          </div>
        ))}
        {loading && <div style={{display:'flex',gap:8,alignItems:'center',color:'var(--muted)',fontSize:12}}><Spinner size={14}/> يفكر...</div>}
      </div>

      <div style={{padding:'10px 12px',borderTop:'1px solid var(--border)',background:'var(--surface)',display:'flex',gap:8}}>
        <input
          value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendChat()}
          placeholder="اسأل عن أي شيء في النتائج..."
          style={{flex:1,padding:'8px 11px',borderRadius:8,fontSize:13}}/>
        <Btn size="sm" variant="primary" onClick={sendChat} disabled={loading||!input.trim()}>إرسال</Btn>
      </div>
    </div>
  );
}

// ── Column mapping badge strip ─────────────────────────────────────────────────
const COL_LABELS = {
  awb:             'AWB',
  shipDate:        'التاريخ',
  dest:            'الدولة',
  weight:          'الوزن',
  deliveryCharges: 'رسوم الشحن',
  rss:             'RSS',
  fuelSurcharge:   'الوقود',
  serviceType:     'نوع الخدمة',
  codAmount:       'COD',
};
const REQUIRED_FIELDS = ['dest', 'weight', 'deliveryCharges'];

function ColMapBadges({ colMap }) {
  const [open, setOpen] = useState(false);
  const missing = REQUIRED_FIELDS.filter(f => !colMap[f]);

  return (
    <div style={{marginBottom:14}}>
      <button onClick={() => setOpen(o => !o)} style={{
        display:'flex', alignItems:'center', gap:8,
        background:'transparent', border:'none', cursor:'pointer', padding:0,
      }}>
        <span style={{fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', letterSpacing:.5}}>
          تعيين الأعمدة المستخدمة
        </span>
        {missing.length > 0
          ? <span style={{background:'rgba(248,113,113,.15)',color:'var(--red)',fontSize:9,padding:'1px 7px',borderRadius:10,border:'1px solid rgba(248,113,113,.3)'}}>
              ⚠ {missing.length} حقل إلزامي مفقود
            </span>
          : <span style={{background:'rgba(52,211,153,.1)',color:'var(--green)',fontSize:9,padding:'1px 7px',borderRadius:10,border:'1px solid rgba(52,211,153,.25)'}}>
              ✓ مكتمل
            </span>
        }
        <span style={{color:'var(--muted)',fontSize:10}}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          marginTop:8, padding:'10px 13px',
          background:'var(--surface)', borderRadius:9, border:'1px solid var(--border)',
          display:'flex', flexWrap:'wrap', gap:7,
        }}>
          {Object.entries(COL_LABELS).map(([field, label]) => {
            const col     = colMap[field];
            const isReq   = REQUIRED_FIELDS.includes(field);
            const mapped  = !!col;
            return (
              <div key={field} style={{
                display:'flex', alignItems:'center', gap:5,
                padding:'4px 10px', borderRadius:7,
                background: mapped ? 'rgba(56,189,248,.07)' : isReq ? 'rgba(248,113,113,.07)' : 'transparent',
                border:`1px solid ${mapped?'rgba(56,189,248,.2)':isReq?'rgba(248,113,113,.25)':'var(--border)'}`,
              }}>
                <span style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>{label}</span>
                <span style={{fontSize:9,color:'var(--muted3)'}}>→</span>
                <span style={{
                  fontSize:10, fontFamily:'var(--font-mono)', fontWeight:600,
                  color: mapped ? 'var(--accent)' : isReq ? 'var(--red)' : 'var(--muted)',
                }}>
                  {col || (isReq ? '⚠ غير معيّن' : '—')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Results Table ─────────────────────────────────────────────────────────────
function num(v, fallback = '—') {
  if (v === null || v === undefined || v === '') return fallback;
  return (+v).toFixed(2);
}

function diffColor(v) {
  return v > 0 ? 'var(--red)' : v < 0 ? 'var(--green)' : 'var(--muted)';
}

function diffText(v) {
  if (v === 0) return '—';
  return (v > 0 ? '+' : '') + num(v);
}

function ResultsTable({ results, filter, showDetail }) {
  const displayed = filter === 'all' ? results : results.filter(r => r.status === filter);
  if (!displayed.length) return <Empty icon="🔍" title="لا توجد نتائج" sub="جرب فلتراً مختلفاً"/>;

  const mis = displayed.filter(r => r.status === 'mismatch');

  const ft = mis.reduce((a, r) => {
    const iD = r.deliveryCharges || 0;
    const iR = r.rss             || 0;
    const iF = r.fuelSurcharge   || 0;
    const iT = r.invoiced?.total ?? (iD + iR + iF);
    return {
      iD: a.iD + iD,  eD: a.eD + (r.expected?.delivery || 0),  dD: a.dD + (r.diffs?.delivery || 0),
      iR: a.iR + iR,  eR: a.eR + (r.expected?.rss      || 0),  dR: a.dR + (r.diffs?.rss      || 0),
      iF: a.iF + iF,  eF: a.eF + (r.expected?.fuel     || 0),  dF: a.dF + (r.diffs?.fuel     || 0),
      iT: a.iT + iT,  eT: a.eT + (r.expected?.total    || 0),  dT: a.dT + (r.diffs?.total    || 0),
    };
  }, { iD:0,eD:0,dD:0, iR:0,eR:0,dR:0, iF:0,eF:0,dF:0, iT:0,eT:0,dT:0 });

  const hasServiceType = results.some(r => r.serviceType);
  const infoCols = hasServiceType ? 6 : 5;

  // Per-group header styles
  const GH = (c, bg) => ({ background:bg, color:c, textAlign:'center', borderBottom:`2px solid ${c}55`, padding:'5px 6px', fontSize:11, fontWeight:700 });
  const SH = (c, bg) => ({ background:bg, color:c, textAlign:'center', borderBottom:`2px solid ${c}33`, fontSize:10, padding:'4px 8px', fontWeight:600, whiteSpace:'nowrap', minWidth:68 });
  const FC = (c, bg) => ({ fontFamily:'var(--font-mono)', fontSize:11, textAlign:'center', background:bg, color:c });

  const groups = [
    { label:'شحن',    color:'#3b9ccc', bg:'rgba(59,156,204,.08)',  bgL:'rgba(59,156,204,.04)' },
    { label:'RSS',    color:'#a855f7', bg:'rgba(168,85,247,.08)',  bgL:'rgba(168,85,247,.03)' },
    { label:'وقود',   color:'#3aad78', bg:'rgba(58,173,120,.08)',  bgL:'rgba(58,173,120,.03)' },
    { label:'الإجمالي',color:'#f59e0b',bg:'rgba(245,158,11,.08)',  bgL:'rgba(245,158,11,.04)' },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ fontSize: 12 }}>
        <thead>
          {showDetail ? (
            <>
              <tr>
                <th rowSpan={2} style={{ minWidth:36  }}>#</th>
                <th rowSpan={2} style={{ minWidth:130 }}>AWB</th>
                <th rowSpan={2} style={{ minWidth:90  }}>التاريخ</th>
                <th rowSpan={2} style={{ minWidth:110 }}>الدولة</th>
                {hasServiceType && <th rowSpan={2} style={{ minWidth:80 }}>نوع الخدمة</th>}
                <th rowSpan={2} style={{ minWidth:70  }}>الوزن</th>
                {groups.map(g => (
                  <th key={g.label} colSpan={3} style={GH(g.color, g.bg)}>{g.label}</th>
                ))}
                <th rowSpan={2} style={{ minWidth:90 }}>الحالة</th>
              </tr>
              <tr>
                {groups.map(g => (
                  [<th key={`${g.label}-i`} style={SH(g.color, g.bg)}>مفوتر</th>,
                   <th key={`${g.label}-e`} style={SH(g.color, g.bg)}>متوقع</th>,
                   <th key={`${g.label}-d`} style={{ ...SH(g.color, g.bg), fontWeight:800 }}>فرق</th>]
                ))}
              </tr>
            </>
          ) : (
            <tr>
              <th style={{ minWidth:36  }}>#</th>
              <th style={{ minWidth:130 }}>AWB</th>
              <th style={{ minWidth:90  }}>التاريخ</th>
              <th style={{ minWidth:110 }}>الدولة</th>
              {hasServiceType && <th style={{ minWidth:80 }}>نوع الخدمة</th>}
              <th style={{ minWidth:70  }}>الوزن</th>
              <th style={{ background:'rgba(139,92,246,.1)', color:'var(--purple)', borderBottom:'2px solid rgba(139,92,246,.3)', minWidth:90 }}>مفوتر</th>
              <th style={{ background:'rgba(52,211,153,.08)', color:'var(--green)', borderBottom:'2px solid rgba(52,211,153,.3)', minWidth:90 }}>متوقع</th>
              <th style={{ background:'rgba(248,113,113,.08)', color:'var(--red)', borderBottom:'2px solid rgba(248,113,113,.3)', minWidth:80, fontWeight:700 }}>الفرق</th>
              <th style={{ minWidth:90 }}>الحالة</th>
            </tr>
          )}
        </thead>

        <tbody>
          {displayed.map((r, i) => {
            const isMis    = r.status === 'mismatch';
            const iD       = r.deliveryCharges || 0;
            const iR       = r.rss             || 0;
            const iF       = r.fuelSurcharge   || 0;
            const iT       = r.invoiced?.total ?? (iD + iR + iF);
            const rowBg    = isMis ? 'rgba(248,113,113,.03)' : 'transparent';
            return (
              <tr key={i} style={{ background: rowBg }}>
                <td style={{ color:'var(--muted)', fontFamily:'var(--font-mono)', fontSize:10 }}>{i + 1}</td>
                <td style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--accent)', whiteSpace:'nowrap', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis' }}>
                  {r.awb || '—'}
                </td>
                <td style={{ color:'var(--muted)', fontSize:11, whiteSpace:'nowrap' }}>{r.shipDate || '—'}</td>
                <td style={{ fontSize:12, whiteSpace:'nowrap' }}>{r.dest || '—'}</td>
                {hasServiceType && (
                  <td style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', whiteSpace:'nowrap' }}>
                    {r.serviceType || '—'}
                  </td>
                )}
                <td style={{ fontFamily:'var(--font-mono)', color:'var(--gold)', whiteSpace:'nowrap', fontSize:11 }}>
                  {num(r.weight)} كغ
                </td>

                {showDetail ? (
                  <>
                    {/* Delivery */}
                    <td style={FC('var(--text)',           groups[0].bgL)}>{num(iD)}</td>
                    <td style={FC('var(--green)',          groups[0].bgL)}>{num(r.expected?.delivery)}</td>
                    <td style={{ textAlign:'center', background:groups[0].bgL }}><DiffCell value={r.diffs?.delivery}/></td>
                    {/* RSS */}
                    <td style={FC('var(--text)',           groups[1].bgL)}>{num(iR)}</td>
                    <td style={FC('var(--green)',          groups[1].bgL)}>{num(r.expected?.rss)}</td>
                    <td style={{ textAlign:'center', background:groups[1].bgL }}><DiffCell value={r.diffs?.rss}/></td>
                    {/* Fuel */}
                    <td style={FC('var(--text)',           groups[2].bgL)}>{num(iF)}</td>
                    <td style={FC('var(--green)',          groups[2].bgL)}>{num(r.expected?.fuel)}</td>
                    <td style={{ textAlign:'center', background:groups[2].bgL }}><DiffCell value={r.diffs?.fuel}/></td>
                    {/* Total */}
                    <td style={{ ...FC(isMis?'rgba(248,113,113,.9)':'var(--text)', groups[3].bgL), fontWeight:600 }}>{num(iT)}</td>
                    <td style={{ ...FC('var(--green)', groups[3].bgL), fontWeight:600 }}>{num(r.expected?.total)}</td>
                    <td style={{ textAlign:'center', background:groups[3].bgL }}><DiffCell value={r.diffs?.total}/></td>
                  </>
                ) : (
                  <>
                    <td style={{ fontFamily:'var(--font-mono)', fontWeight:600, color: isMis ? 'rgba(248,113,113,.9)' : 'var(--text)' }}>{num(iT)}</td>
                    <td style={{ fontFamily:'var(--font-mono)', color:'var(--green)', fontWeight:600 }}>{num(r.expected?.total)}</td>
                    <td><DiffCell value={r.diffs?.total}/></td>
                  </>
                )}
                <td><Badge status={r.status}/></td>
              </tr>
            );
          })}
        </tbody>

        {mis.length > 0 && (
          <tfoot>
            <tr style={{ borderTop:'2px solid var(--border2)', background:'var(--surface)' }}>
              <td colSpan={infoCols} style={{ color:'var(--muted)', fontSize:10, fontFamily:'var(--font-mono)', padding:'9px 14px' }}>
                إجمالي الفروق · {mis.length} شحنة
              </td>
              {showDetail ? (
                <>
                  {/* Delivery */}
                  <td style={FC('var(--text)',    groups[0].bgL)}>{num(ft.iD)}</td>
                  <td style={FC('var(--green)',   groups[0].bgL)}>{num(ft.eD)}</td>
                  <td style={{ ...FC(diffColor(ft.dD), groups[0].bgL), fontWeight:700 }}>{diffText(ft.dD)}</td>
                  {/* RSS */}
                  <td style={FC('var(--text)',    groups[1].bgL)}>{num(ft.iR)}</td>
                  <td style={FC('var(--green)',   groups[1].bgL)}>{num(ft.eR)}</td>
                  <td style={{ ...FC(diffColor(ft.dR), groups[1].bgL), fontWeight:700 }}>{diffText(ft.dR)}</td>
                  {/* Fuel */}
                  <td style={FC('var(--text)',    groups[2].bgL)}>{num(ft.iF)}</td>
                  <td style={FC('var(--green)',   groups[2].bgL)}>{num(ft.eF)}</td>
                  <td style={{ ...FC(diffColor(ft.dF), groups[2].bgL), fontWeight:700 }}>{diffText(ft.dF)}</td>
                  {/* Total */}
                  <td style={{ ...FC('var(--text)', groups[3].bgL), fontWeight:700 }}>{num(ft.iT)}</td>
                  <td style={{ ...FC('var(--green)', groups[3].bgL), fontWeight:700 }}>{num(ft.eT)}</td>
                  <td style={{ ...FC(diffColor(ft.dT), groups[3].bgL), fontWeight:800, fontSize:13, whiteSpace:'nowrap' }}>
                    {diffText(ft.dT)} ر.س
                  </td>
                </>
              ) : (
                <>
                  <td colSpan={2}/>
                  <td style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13, color: diffColor(ft.dT), whiteSpace:'nowrap' }}>
                    {diffText(ft.dT)} ر.س
                  </td>
                </>
              )}
              <td/>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AuditResults({ audit, carriers, onNewAudit }) {
  const [filter,     setFilter]     = useState('all');
  const [showAI,     setShowAI]     = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const { results=[], summary={} } = audit;

  const carrier = carriers.find(c=>c.id===audit.carrierId);
  const contract = carrier ? getActiveContract(carrier, `${audit.year}-${String(audit.month).padStart(2,'0')}-01`) : null;

  const handleExport = () => {
    const ok = exportAuditExcel(results, summary, audit.carrierName, audit.period, contract?.label||'—');
    if (ok) toast('تم تصدير الملف ✓','success');
    else    toast('لا توجد فروق للتصدير','info');
  };

  return (
    <div style={{display:'grid',gridTemplateColumns:showAI?'1fr 360px':'1fr',height:'100%',overflow:'hidden'}}>

      {/* Main */}
      <div style={{overflowY:'auto',padding:'20px 24px'}}>
        {/* Header */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20,flexWrap:'wrap',gap:10}}>
          <div>
            <h2 style={{fontFamily:'var(--font-mono)',fontSize:18,marginBottom:4}}>
              نتائج تدقيق <span style={{color:'var(--accent)'}}>{audit.carrierName}</span>
            </h2>
            <div style={{color:'var(--muted)',fontSize:12}}>
              {audit.period} · {contract?.label||'—'} · {results.length} شحنة
            </div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <Btn size="sm" variant="ghost" onClick={onNewAudit}>+ مراجعة جديدة</Btn>
            <Btn size="sm" variant={showDetail?'outline':'ghost'} onClick={()=>setShowDetail(s=>!s)}>
              {showDetail ? '📊 ملخص' : '🔬 تفاصيل'}
            </Btn>
            {summary.mismatch>0 && (
              <Btn size="sm" variant="success" onClick={handleExport} icon="⬇️">
                تصدير ({summary.mismatch} فرق)
              </Btn>
            )}
            <Btn size="sm" variant={showAI?'primary':'gold'} onClick={()=>setShowAI(s=>!s)} icon="✨">
              {showAI?'إخفاء AI':'مساعد AI'}
            </Btn>
          </div>
        </div>

        {/* Stats */}
        <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
          <StatCard label="إجمالي" value={summary.total} color="var(--accent)" onClick={()=>setFilter('all')}/>
          <StatCard label="✓ مطابقة" value={summary.ok} color="var(--green)" onClick={()=>setFilter('ok')}/>
          <StatCard label="✗ فروق" value={summary.mismatch} color="var(--red)" onClick={()=>setFilter('mismatch')}/>
          <StatCard label="؟ غير معروف" value={summary.unknown} color="var(--muted)" onClick={()=>setFilter('unknown')}/>
          <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:11,padding:'13px 18px',
            borderTop:`3px solid ${summary.totalDiff>0?'var(--red)':'var(--green)'}`}}>
            <div style={{color:'var(--muted)',fontSize:10,fontFamily:'var(--font-mono)',marginBottom:3}}>إجمالي الفرق</div>
            <div style={{color:summary.totalDiff>0?'var(--red)':'var(--green)',fontSize:20,fontFamily:'var(--font-mono)',fontWeight:700}}>
              {summary.totalDiff>=0?'+':''}{summary.totalDiff?.toFixed(2)} ر.س
            </div>
          </div>
        </div>

        {/* Column mapping used — lets user verify correctness */}
        {audit.colMap && (
          <ColMapBadges colMap={audit.colMap}/>
        )}

        {/* Filters */}
        <div style={{display:'flex',gap:7,marginBottom:14}}>
          {[{k:'all',l:`الكل (${summary.total})`},{k:'mismatch',l:`✗ فروق (${summary.mismatch})`},{k:'ok',l:`✓ مطابق (${summary.ok})`},{k:'unknown',l:`؟ (${summary.unknown})`}].map(t=>(
            <button key={t.k} onClick={()=>setFilter(t.k)} style={{
              background:filter===t.k?'var(--accent)20':'transparent',
              border:`1px solid ${filter===t.k?'var(--accent)':'var(--border)'}`,
              color:filter===t.k?'var(--accent)':'var(--muted)',
              borderRadius:7,padding:'5px 13px',cursor:'pointer',
              fontFamily:'var(--font-sans)',fontSize:12,fontWeight:600,
            }}>{t.l}</button>
          ))}
        </div>

        {/* Table */}
        <Card style={{padding:0,overflow:'hidden'}}>
          <ResultsTable results={results} filter={filter} showDetail={showDetail}/>
        </Card>
      </div>

      {/* AI sidebar */}
      {showAI && (
        <div style={{borderRight:'1px solid var(--border)',background:'var(--card)',display:'flex',flexDirection:'column',height:'100%'}}>
          <AIPanel audit={audit} carriers={carriers}/>
        </div>
      )}
    </div>
  );
}
