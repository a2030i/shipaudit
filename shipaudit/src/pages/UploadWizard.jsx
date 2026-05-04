import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Card, Btn, Select, Spinner, toast } from '../components/UI.jsx';
import { detectColumns, mapRows, auditAll, buildSummary } from '../engine/audit.js';
import { aiMapColumns } from '../engine/openrouter.js';
import { saveAudit, loadSettings, getActiveContract } from '../data/carriers.js';

const MONTHS = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];

function buildPeriod(month, year) {
  return `${MONTHS[month-1]} ${year}`;
}

// ── Step 1: Choose carrier & period ───────────────────────────────────────────
function Step1({ carriers, carrierId, setCarrierId, month, setMonth, year, setYear, onNext }) {
  const now = new Date();
  const carrier = carriers.find(c=>c.id===carrierId);
  const contract = carrier ? getActiveContract(carrier, `${year}-${String(month).padStart(2,'0')}-01`) : null;

  return (
    <Card style={{maxWidth:500,margin:'0 auto'}}>
      <h3 style={{fontFamily:'var(--font-mono)',color:'var(--accent)',marginBottom:20}}>
        الخطوة 1 — اختر الشركة والفترة
      </h3>

      <div style={{marginBottom:16}}>
        <Select label="شركة الشحن" value={carrierId} onChange={e=>setCarrierId(e.target.value)}>
          <option value="">اختر شركة...</option>
          {carriers.map(c=><option key={c.id} value={c.id}>{c.logo} {c.name}</option>)}
        </Select>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <Select label="الشهر" value={month} onChange={e=>setMonth(+e.target.value)}>
          {MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
        </Select>
        <Select label="السنة" value={year} onChange={e=>setYear(+e.target.value)}>
          {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
        </Select>
      </div>

      {carrier && (
        <div style={{background:'var(--surface)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12}}>
          <div style={{color:'var(--muted)',marginBottom:4}}>العقد الساري للفترة المختارة:</div>
          {contract
            ? <span style={{color:'var(--green)',fontFamily:'var(--font-mono)'}}>{contract.label} — {contract.startDate}</span>
            : <span style={{color:'var(--red)'}}>⚠️ لا يوجد عقد ساري لهذه الفترة</span>
          }
        </div>
      )}

      <Btn variant="primary" onClick={onNext} disabled={!carrierId} style={{width:'100%',justifyContent:'center'}}>
        التالي ←
      </Btn>
    </Card>
  );
}

// ── Step 2: Upload file ────────────────────────────────────────────────────────
function Step2({ carrierName, period, onUpload, onBack, uploading }) {
  const [drag, setDrag] = useState(false);

  const handle = useCallback((file) => {
    if (!file) return;
    onUpload(file);
  }, [onUpload]);

  return (
    <Card style={{maxWidth:500,margin:'0 auto'}}>
      <h3 style={{fontFamily:'var(--font-mono)',color:'var(--accent)',marginBottom:6}}>الخطوة 2 — رفع الملف</h3>
      <p style={{color:'var(--muted)',fontSize:12,marginBottom:20}}>{carrierName} · {period}</p>

      <div
        onDragOver={e=>{e.preventDefault();setDrag(true);}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files[0]);}}
        onClick={()=>!uploading&&document.getElementById('fu-input').click()}
        style={{
          border:`2px dashed ${drag?'var(--accent)':'var(--border)'}`,
          borderRadius:12,padding:'44px 20px',textAlign:'center',
          cursor:uploading?'not-allowed':'pointer',
          background:drag?'#00c6ff08':'var(--surface)',
          transition:'all .2s',marginBottom:16,
        }}>
        {uploading
          ? <><Spinner size={32}/><div style={{color:'var(--muted)',marginTop:12,fontSize:13}}>جارٍ القراءة والتحليل...</div></>
          : <>
              <div style={{fontSize:40,marginBottom:10}}>📂</div>
              <div style={{fontWeight:600,marginBottom:5}}>اسحب وأفلت ملف Excel هنا</div>
              <div style={{color:'var(--muted)',fontSize:12}}>أو اضغط للاختيار — xlsx / xls</div>
            </>
        }
        <input id="fu-input" type="file" accept=".xlsx,.xls" style={{display:'none'}}
          onChange={e=>handle(e.target.files[0])}/>
      </div>

      <Btn variant="ghost" onClick={onBack} style={{width:'100%',justifyContent:'center'}}>← رجوع</Btn>
    </Card>
  );
}

// ── Step 3: Column mapping review ─────────────────────────────────────────────
const FIELD_LABELS = {
  awb:'رقم الشحنة AWB', shipDate:'تاريخ الشحن',
  dest:'الدولة', weight:'الوزن', deliveryCharges:'رسوم الشحن',
  rss:'RSS', fuelSurcharge:'رسوم الوقود',
};

function Step3({ headers, colMap, setColMap, onConfirm, onBack, aiLoading, onAiMap }) {
  return (
    <Card style={{maxWidth:560,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h3 style={{fontFamily:'var(--font-mono)',color:'var(--accent)'}}>الخطوة 3 — تعيين الأعمدة</h3>
        <Btn size="sm" variant="gold" onClick={onAiMap} disabled={aiLoading}>
          {aiLoading ? <><Spinner size={14}/> AI يحلل...</> : '✨ تعيين تلقائي AI'}
        </Btn>
      </div>

      <div style={{marginBottom:20}}>
        {Object.entries(FIELD_LABELS).map(([field,label])=>(
          <div key={field} style={{display:'grid',gridTemplateColumns:'140px 1fr',gap:10,marginBottom:10,alignItems:'center'}}>
            <div style={{fontSize:12,color: colMap[field]?'var(--text)':'var(--muted)'}}>
              {colMap[field]?'✓ ':''}{label}
            </div>
            <select value={colMap[field]||''} onChange={e=>setColMap({...colMap,[field]:e.target.value||null})}
              style={{padding:'6px 10px',borderRadius:6,fontSize:12,cursor:'pointer'}}>
              <option value="">— غير محدد —</option>
              {headers.map(h=><option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div style={{background:'var(--surface)',borderRadius:7,padding:'8px 12px',marginBottom:16,fontSize:11,color:'var(--muted)'}}>
        ⚠️ الأعمدة الإلزامية: الدولة + الوزن + رسوم الشحن
      </div>

      <div style={{display:'flex',gap:9}}>
        <Btn variant="ghost" onClick={onBack} style={{flex:1,justifyContent:'center'}}>← رجوع</Btn>
        <Btn variant="primary" onClick={onConfirm}
          disabled={!colMap.dest||!colMap.weight||!colMap.deliveryCharges}
          style={{flex:2,justifyContent:'center'}}>
          تأكيد وتدقيق ←
        </Btn>
      </div>
    </Card>
  );
}

// ── Main Upload Wizard ─────────────────────────────────────────────────────────
export default function UploadWizard({ carriers, onComplete }) {
  const now = new Date();
  const [step,      setStep]      = useState(1);
  const [carrierId, setCarrierId] = useState(carriers[0]?.id||'');
  const [month,     setMonth]     = useState(now.getMonth()+1);
  const [year,      setYear]      = useState(now.getFullYear());
  const [headers,   setHeaders]   = useState([]);
  const [rawRows,   setRawRows]   = useState([]);
  const [colMap,    setColMap]    = useState({});
  const [uploading, setUploading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const carrier = carriers.find(c=>c.id===carrierId);
  const period  = buildPeriod(month,year);

  const handleFile = useCallback((file) => {
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb  = XLSX.read(e.target.result, { type:'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval:'' });
        if (!raw.length) { toast('الملف فارغ أو لا يحتوي على بيانات','error'); setUploading(false); return; }
        const hdrs = Object.keys(raw[0]);
        setHeaders(hdrs);
        setRawRows(raw);
        setColMap(detectColumns(hdrs));
        setStep(3);
      } catch(err) {
        toast(`خطأ في قراءة الملف: ${err.message}`,'error');
      }
      setUploading(false);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleAiMap = async () => {
    const settings = loadSettings();
    if (!settings.openrouterKey) { toast('أدخل OpenRouter API Key في الإعدادات','warn'); return; }
    setAiLoading(true);
    try {
      const result = await aiMapColumns(headers);
      setColMap(prev => ({...prev, ...Object.fromEntries(Object.entries(result).filter(([,v])=>v))}));
      toast('تم التعيين التلقائي بنجاح ✓','success');
    } catch(err) {
      toast(`AI: ${err.message}`,'error');
    }
    setAiLoading(false);
  };

  const handleConfirm = () => {
    if (!carrier) return;
    const forDate = `${year}-${String(month).padStart(2,'0')}-01`;
    const mapped  = mapRows(rawRows, colMap);
    const results = auditAll(mapped, carrier, forDate);
    const summary = buildSummary(results);

    const audit = {
      id:         `a_${Date.now()}`,
      carrierId:  carrier.id,
      carrierName:carrier.name,
      period,
      month, year,
      colMap,
      summary,
      results,
      createdAt: new Date().toISOString(),
    };
    saveAudit(audit);
    toast(`تم تدقيق ${results.length} شحنة`,'success');
    onComplete(audit);
  };

  return (
    <div style={{padding:'32px 24px',maxWidth:700,margin:'0 auto'}}>

      {/* Steps indicator */}
      <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:32,justifyContent:'center'}}>
        {[['1','اختر الشركة'],['2','ارفع الملف'],['3','الأعمدة']].map(([n,lbl],i)=>(
          <div key={n} style={{display:'flex',alignItems:'center'}}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
              <div style={{
                width:32,height:32,borderRadius:'50%',
                background:step>i?'var(--green)':step===i+1?'var(--accent)':'var(--surface)',
                border:`2px solid ${step>=i+1?'var(--accent)':'var(--border)'}`,
                color:step>=i+1?'#fff':'var(--muted)',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:'var(--font-mono)',fontWeight:700,fontSize:13,
                transition:'all .3s',
              }}>{step>i+1?'✓':n}</div>
              <span style={{fontSize:10,color:step===i+1?'var(--accent)':'var(--muted)',whiteSpace:'nowrap'}}>{lbl}</span>
            </div>
            {i<2&&<div style={{width:60,height:2,background:step>i+1?'var(--accent)':'var(--border)',margin:'0 4px',marginBottom:18,transition:'all .3s'}}/>}
          </div>
        ))}
      </div>

      {step===1 && (
        <Step1 carriers={carriers} carrierId={carrierId} setCarrierId={setCarrierId}
          month={month} setMonth={setMonth} year={year} setYear={setYear}
          onNext={()=>setStep(2)}/>
      )}
      {step===2 && (
        <Step2 carrierName={carrier?.name||''} period={period}
          onUpload={handleFile} onBack={()=>setStep(1)} uploading={uploading}/>
      )}
      {step===3 && (
        <Step3 headers={headers} colMap={colMap} setColMap={setColMap}
          onConfirm={handleConfirm} onBack={()=>setStep(2)}
          aiLoading={aiLoading} onAiMap={handleAiMap}/>
      )}
    </div>
  );
}
