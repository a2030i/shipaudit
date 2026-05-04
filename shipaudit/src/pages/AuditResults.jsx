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

// ── Results Table ─────────────────────────────────────────────────────────────
function ResultsTable({ results, filter }) {
  const displayed = filter==='all' ? results : results.filter(r=>r.status===filter);

  if (!displayed.length) return <Empty icon="🔍" title="لا توجد نتائج" sub="جرب فلتراً مختلفاً"/>;

  return (
    <div style={{overflowX:'auto'}}>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>AWB</th>
            <th>التاريخ</th>
            <th>الدولة</th>
            <th>الوزن</th>
            <th style={{background:'#131e2e'}}>شحن مفوتر</th>
            <th style={{background:'#131e2e'}}>شحن متوقع</th>
            <th style={{background:'#131e2e',borderLeft:'1px solid var(--border)'}}>△</th>
            <th style={{background:'#141d2a'}}>RSS مفوتر</th>
            <th style={{background:'#141d2a'}}>RSS متوقع</th>
            <th style={{background:'#141d2a',borderLeft:'1px solid var(--border)'}}>△</th>
            <th style={{background:'#131e1a'}}>وقود مفوتر</th>
            <th style={{background:'#131e1a'}}>وقود متوقع</th>
            <th style={{background:'#131e1a',borderLeft:'1px solid var(--border)'}}>△</th>
            <th>إجمالي مفوتر</th>
            <th>إجمالي متوقع</th>
            <th style={{color:'var(--red)'}}>△ كلي</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {displayed.map((r,i)=>(
            <tr key={i} style={{background:r.status==='mismatch'?'#ff4d6d04':'transparent'}}>
              <td style={{color:'var(--muted)',fontFamily:'var(--font-mono)',fontSize:11}}>{i+1}</td>
              <td style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--accent)',whiteSpace:'nowrap'}}>{r.awb||'—'}</td>
              <td style={{color:'var(--muted)',fontSize:11,whiteSpace:'nowrap'}}>{r.shipDate||'—'}</td>
              <td style={{fontSize:12}}>{r.dest||'—'}</td>
              <td style={{fontFamily:'var(--font-mono)',color:'var(--gold)',whiteSpace:'nowrap'}}>{r.weight?.toFixed(2)} كغ</td>
              {/* Delivery */}
              <td style={{fontFamily:'var(--font-mono)',color:r.invoiced&&r.expected&&Math.abs(r.diffs?.delivery)>0.5?'var(--red)':'var(--text)'}}>{r.invoiced?.delivery??'—'}</td>
              <td style={{fontFamily:'var(--font-mono)',color:'var(--green)'}}>{r.expected?.delivery?.toFixed(2)??'—'}</td>
              <td><DiffCell value={r.diffs?.delivery}/></td>
              {/* RSS */}
              <td style={{fontFamily:'var(--font-mono)',color:r.invoiced&&r.expected&&Math.abs(r.diffs?.rss)>0.5?'var(--red)':'var(--text)'}}>{r.invoiced?.rss??'—'}</td>
              <td style={{fontFamily:'var(--font-mono)',color:'var(--green)'}}>{r.expected?.rss?.toFixed(2)??'—'}</td>
              <td><DiffCell value={r.diffs?.rss}/></td>
              {/* Fuel */}
              <td style={{fontFamily:'var(--font-mono)',color:r.invoiced&&r.expected&&Math.abs(r.diffs?.fuel)>0.5?'var(--red)':'var(--text)'}}>{r.invoiced?.fuel??'—'}</td>
              <td style={{fontFamily:'var(--font-mono)',color:'var(--green)'}}>{r.expected?.fuel?.toFixed(2)??'—'}</td>
              <td><DiffCell value={r.diffs?.fuel}/></td>
              {/* Total */}
              <td style={{fontFamily:'var(--font-mono)',fontWeight:600}}>{r.invoiced?.total?.toFixed(2)??'—'}</td>
              <td style={{fontFamily:'var(--font-mono)',color:'var(--green)',fontWeight:600}}>{r.expected?.total?.toFixed(2)??'—'}</td>
              <td><DiffCell value={r.diffs?.total}/></td>
              <td><Badge status={r.status}/></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AuditResults({ audit, carriers, onNewAudit }) {
  const [filter,   setFilter]   = useState('all');
  const [showAI,   setShowAI]   = useState(false);
  const { results=[], summary={} } = audit;

  const carrier = carriers.find(c=>c.id===audit.carrierId);
  const contract = carrier ? getActiveContract(carrier, `${audit.year}-${String(audit.month).padStart(2,'0')}-01`) : null;

  const handleExport = () => {
    const ok = exportAuditExcel(results, summary, audit.carrierName, audit.period, contract?.label||'—');
    if (ok) toast('تم تصدير الملف ✓','success');
    else    toast('لا توجد فروق للتصدير','info');
  };

  return (
    <div style={{display:'grid',gridTemplateColumns:showAI?'1fr 360px':'1fr',height:'calc(100vh - 56px)',overflow:'hidden'}}>

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
            {summary.mismatch>0 && (
              <Btn size="sm" variant="success" onClick={handleExport} icon="⬇️">
                تصدير Excel ({summary.mismatch} فرق)
              </Btn>
            )}
            <Btn size="sm" variant={showAI?'primary':'gold'} onClick={()=>setShowAI(s=>!s)} icon="✨">
              {showAI?'إخفاء AI':'مساعد AI'}
            </Btn>
          </div>
        </div>

        {/* Stats */}
        <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:20}}>
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
          <ResultsTable results={results} filter={filter}/>
          {filter==='mismatch'&&summary.mismatch>0&&(
            <div style={{padding:'10px 14px',background:'var(--surface)',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',fontSize:12}}>
              <span style={{color:'var(--muted)'}}>{summary.mismatch} شحنة بها فروق</span>
              <span style={{color:'var(--red)',fontFamily:'var(--font-mono)',fontWeight:700}}>
                إجمالي: +{summary.totalDiff?.toFixed(2)} ر.س
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* AI sidebar */}
      {showAI && (
        <div style={{borderRight:'1px solid var(--border)',background:'var(--card)',display:'flex',flexDirection:'column',height:'calc(100vh - 56px)'}}>
          <AIPanel audit={audit} carriers={carriers}/>
        </div>
      )}
    </div>
  );
}
