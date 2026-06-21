import { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast } from '../components/UI.jsx';
import { addCarrier, updateCarrier, deleteCarrier, COUNTRIES, loadSettings } from '../data/carriers.js';
import { saveCarrier, deleteCarrierFromDB, uploadCarrierContractPdf, getCarrierContractUrl } from '../lib/coreService.js';
import { previewPricing } from '../engine/pricing.js';
import { aiParseContract, aiRefineContract } from '../engine/openrouter.js';

const TIER_UNIT_OPTIONS = [
  { value:'0.5', label:'0.5 كغ' },
  { value:'1',   label:'1 كغ' },
  { value:'2',   label:'2 كغ' },
  { value:'5',   label:'5 كغ' },
];

// ── Tier editor ────────────────────────────────────────────────────────────────
function TierEditor({ tiers, onChange }) {
  const update = (i, k, v) => { const t=[...tiers]; t[i]={...t[i],[k]:v}; onChange(t); };
  const add    = () => onChange([...tiers, { upTo:'', type:'per', price:'', pricePerUnit:'', unitKg:'0.5' }]);
  const del    = i  => onChange(tiers.filter((_,j)=>j!==i));
  const isLast = i  => i === tiers.length - 1;

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 60px 28px',gap:6,marginBottom:5,paddingBottom:5,borderBottom:'1px solid var(--border)'}}>
        {['حتى كغ','نوع السعر','القيمة','وحدة',''].map((h,i)=>
          <div key={i} style={{color:'var(--muted)',fontSize:10,fontFamily:'var(--font-mono)'}}>{h}</div>
        )}
      </div>
      {tiers.map((t,i)=>(
        <div key={i} style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 60px 28px',gap:6,marginBottom:6,alignItems:'center'}}>
          <input type="number" disabled={isLast(i)}
            placeholder={isLast(i)?'∞':''}
            value={t.upTo}
            onChange={e=>update(i,'upTo',e.target.value)}
            style={{padding:'6px 8px',borderRadius:6,textAlign:'center',fontSize:12,fontFamily:'var(--font-mono)',opacity:isLast(i)?.5:1}}/>
          <select value={t.type} onChange={e=>update(i,'type',e.target.value)}
            style={{padding:'6px 8px',borderRadius:6,fontSize:12,cursor:'pointer'}}>
            <option value="flat">ثابت للشريحة</option>
            <option value="per">لكل وحدة</option>
          </select>
          {t.type==='flat'
            ? <input type="number" placeholder="ر.س" value={t.price}
                onChange={e=>update(i,'price',e.target.value)}
                style={{padding:'6px 8px',borderRadius:6,textAlign:'center',fontSize:12,fontFamily:'var(--font-mono)'}}/>
            : <input type="number" placeholder="ر.س/وحدة" value={t.pricePerUnit}
                onChange={e=>update(i,'pricePerUnit',e.target.value)}
                style={{padding:'6px 8px',borderRadius:6,textAlign:'center',fontSize:12,fontFamily:'var(--font-mono)'}}/>
          }
          {t.type==='per'
            ? <select value={t.unitKg} onChange={e=>update(i,'unitKg',e.target.value)}
                style={{padding:'6px 4px',borderRadius:6,fontSize:11,cursor:'pointer'}}>
                {TIER_UNIT_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            : <div style={{color:'var(--muted)',fontSize:10,textAlign:'center'}}>—</div>
          }
          <button onClick={()=>del(i)}
            style={{background:'#ff4d6d18',border:'1px solid #ff4d6d33',color:'var(--red)',borderRadius:5,cursor:'pointer',fontSize:12,padding:'3px 6px'}}>✕</button>
        </div>
      ))}
      <button onClick={add}
        style={{background:'transparent',border:'1px dashed var(--accent)',color:'var(--accent)',borderRadius:6,padding:'4px 12px',cursor:'pointer',fontSize:11,marginTop:2}}>
        + شريحة
      </button>
      {/* Mini preview */}
      {tiers.length > 0 && (
        <div style={{marginTop:8,padding:'6px 10px',background:'var(--surface)',borderRadius:6,fontSize:11,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>
          {tiers.map((t,i)=>{
            const label = isLast(i)?'∞':`${t.upTo||'?'}كغ`;
            const val   = t.type==='flat'?`${t.price||'?'}ر.س`:`${t.pricePerUnit||'?'}/${t.unitKg}كغ`;
            return <span key={i} style={{marginLeft:10}}>≤{label}: {val}</span>;
          })}
        </div>
      )}
    </div>
  );
}

// ── Contract Form ──────────────────────────────────────────────────────────────
function defaultTiers() { return [{upTo:'1',type:'flat',price:'',pricePerUnit:'',unitKg:'0.5'},{upTo:'',type:'per',price:'',pricePerUnit:'',unitKg:'0.5'}]; }

function tiersFromPricingArray(def) {
  if (!def) return defaultTiers();
  if (!Array.isArray(def) && def.first !== undefined) {
    return [
      {upTo:String(def.firstKg||0.5),type:'flat',price:String(def.first),pricePerUnit:'',unitKg:'0.5'},
      {upTo:'',type:'per',price:'',pricePerUnit:String(def.step),unitKg:'0.5'},
    ];
  }
  if (Array.isArray(def)) return def.map(t=>({
    upTo: t.upTo!==null&&t.upTo!==undefined ? String(t.upTo) : '',
    type: t.price!==undefined ? 'flat' : 'per',
    price: t.price!==undefined ? String(t.price) : '',
    pricePerUnit: t.pricePerUnit!==undefined ? String(t.pricePerUnit) : '',
    unitKg: String(t.unitKg||0.5),
  }));
  return defaultTiers();
}

// Keep old name as alias for backward compat within this file
const tiersFromPricing = tiersFromPricingArray;

function parseCountryEntry(key, def) {
  // Key may be "UAE" or "Kuwait → Saudi Arabia"
  const arrowIdx = key.indexOf(' → ');
  const origin  = arrowIdx >= 0 ? key.slice(0, arrowIdx) : '';
  const country = arrowIdx >= 0 ? key.slice(arrowIdx + 3) : key;
  if (!def) return { origin, country, multiType: false, tiers: defaultTiers(), types: [] };
  if (Array.isArray(def) || def?.first !== undefined) {
    return { origin, country, multiType: false, tiers: tiersFromPricingArray(def), types: [] };
  }
  return {
    origin, country, multiType: true, tiers: defaultTiers(),
    types: Object.entries(def).map(([name, td]) => ({ name, tiers: tiersFromPricingArray(td) })),
  };
}

function tiersToArray(tiers) {
  return tiers.filter(t=>t.price!==''||t.pricePerUnit!=='').map(t=>({
    upTo: t.upTo===''?null:+t.upTo,
    ...(t.type==='flat' ? {price:+t.price} : {pricePerUnit:+t.pricePerUnit,unitKg:+t.unitKg}),
  }));
}

function countryEntryKey(entry) {
  return entry.origin ? `${entry.origin} → ${entry.country}` : entry.country;
}

function countryEntryValue(entry) {
  if (!entry.multiType) return tiersToArray(entry.tiers);
  const obj = {};
  for (const t of entry.types) { if (t.name) obj[t.name] = tiersToArray(t.tiers); }
  return obj;
}

// ── Country pricing block ──────────────────────────────────────────────────────
const SERVICE_TYPE_SUGGESTIONS = ['Road', 'Air', 'Express', 'Economy', 'Standard'];

function CountryBlock({ entry, onChange, onDelete }) {
  const { origin, country, multiType, tiers, types } = entry;

  const toMulti = () => onChange({
    ...entry, multiType: true, tiers: defaultTiers(),
    types: [
      { name: 'Road', tiers: tiers?.length ? tiers : defaultTiers() },
      { name: 'Air',  tiers: defaultTiers() },
    ],
  });
  const toSingle = () => onChange({
    ...entry, multiType: false,
    tiers: types?.[0]?.tiers || defaultTiers(),
    types: [],
  });

  return (
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:9,padding:'12px 14px',marginBottom:10}}>
      {/* Route row: من → إلى */}
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:6,flex:1}}>
          <select value={origin} onChange={e=>onChange({...entry,origin:e.target.value})}
            title="الدولة المرسِلة (اتركها فارغة = من السعودية)"
            style={{flex:1,padding:'6px 8px',borderRadius:7,fontSize:12,cursor:'pointer',background:'var(--card)',border:`1px solid ${origin?'var(--accent)':'var(--border)'}`,color:origin?'var(--accent)':'var(--muted)'}}>
            <option value="">من السعودية ▾</option>
            {COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <span style={{color:'var(--muted)',fontSize:12,flexShrink:0}}>→</span>
          <select value={country} onChange={e=>onChange({...entry,country:e.target.value})}
            style={{flex:1,padding:'6px 8px',borderRadius:7,fontSize:12,cursor:'pointer',background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}}>
            <option value="">إلى (اختر)</option>
            {COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={multiType ? toSingle : toMulti}
          title={multiType ? 'تحويل لنوع واحد' : 'إضافة أنواع خدمة (Road/Air)'}
          style={{
            background: multiType ? 'rgba(45,212,191,.12)' : 'transparent',
            border:`1px solid ${multiType?'rgba(45,212,191,.3)':'var(--border)'}`,
            color: multiType ? 'var(--accent)' : 'var(--muted)',
            borderRadius:7, padding:'4px 10px', cursor:'pointer', fontSize:10,
            marginLeft:6, whiteSpace:'nowrap',
          }}>
          {multiType ? '✓ متعدد الأنواع' : '+ Road/Air'}
        </button>
        <Btn size="sm" variant="danger" onClick={onDelete} style={{marginRight:0}}>حذف</Btn>
      </div>

      {!multiType && (
        <TierEditor tiers={tiers} onChange={t=>onChange({...entry,tiers:t})}/>
      )}

      {multiType && (
        <div>
          {types.map((st, i) => (
            <div key={i} style={{marginBottom:12,padding:'10px 12px',background:'var(--card)',borderRadius:8,border:'1px solid var(--border)'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                <span style={{color:'var(--accent)',fontSize:10,fontFamily:'var(--font-mono)'}}>نوع الخدمة:</span>
                <input value={st.name}
                  onChange={e=>{ const nt=[...types]; nt[i]={...nt[i],name:e.target.value}; onChange({...entry,types:nt}); }}
                  list={`st-sugg-${i}`}
                  placeholder="Road / Air / Express..."
                  style={{flex:1,padding:'4px 8px',borderRadius:6,fontSize:12,fontFamily:'var(--font-mono)',background:'var(--surface)',border:'1px solid var(--border)',color:'var(--text)'}}/>
                <datalist id={`st-sugg-${i}`}>
                  {SERVICE_TYPE_SUGGESTIONS.map(s=><option key={s} value={s}/>)}
                </datalist>
                <button onClick={()=>onChange({...entry,types:types.filter((_,j)=>j!==i)})}
                  style={{background:'#ff4d6d18',border:'1px solid #ff4d6d33',color:'var(--red)',borderRadius:5,cursor:'pointer',fontSize:11,padding:'2px 7px'}}>
                  ✕
                </button>
              </div>
              <TierEditor tiers={st.tiers} onChange={tiers=>{ const nt=[...types]; nt[i]={...nt[i],tiers}; onChange({...entry,types:nt}); }}/>
            </div>
          ))}
          <button onClick={()=>onChange({...entry,types:[...types,{name:'',tiers:defaultTiers()}]})}
            style={{background:'transparent',border:'1px dashed var(--accent)',color:'var(--accent)',borderRadius:6,padding:'4px 14px',cursor:'pointer',fontSize:11,width:'100%'}}>
            + نوع خدمة جديد
          </button>
        </div>
      )}
    </div>
  );
}

function ContractForm({ contract, onSave, onClose }) {
  const [label,     setLabel]     = useState(contract?.label||'');
  const [startDate, setStartDate] = useState(contract?.startDate||'');
  const [endDate,   setEndDate]   = useState(contract?.endDate||'');
  const [rss,       setRss]       = useState(Math.round((contract?.rss??0)*100));
  const [rssDate,   setRssDate]   = useState(contract?.rssStartDate||'');
  const [fuel,      setFuel]      = useState(Math.round((contract?.fuelPct??0)*100));
  const [fuelDate,  setFuelDate]  = useState(contract?.fuelStartDate||'');
  const [fuelBase,  setFuelBase]  = useState(contract?.fuelBase||'delivery');
  const [notes,     setNotes]     = useState(contract?.notes||'');
  const [countries, setCountries] = useState(
    Object.entries(contract?.pricing||{}).map(([country,def]) => parseCountryEntry(country, def))
  );
  const [showManual, setShowManual] = useState(false);

  // ── AI chat state ──────────────────────────────────────────────────────────
  const [aiPhase,   setAiPhase]   = useState('input'); // 'input' | 'chat'
  const [aiHint,    setAiHint]    = useState('');
  const [aiText,    setAiText]    = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiParsed,  setAiParsed]  = useState(null);
  const [chatMsgs,  setChatMsgs]  = useState([]);
  const [chatInput, setChatInput] = useState('');
  const fileRef      = useRef(null);
  const fileRef2     = useRef(null);
  const chatEndRef   = useRef(null);
  const chatInputRef = useRef(null);

  useEffect(() => {
    if (aiPhase === 'chat') setTimeout(() => chatInputRef.current?.focus(), 80);
  }, [aiPhase]);

  const scrollChat = () => setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);

  const currentParsedFromForm = () => {
    const pricing = {};
    for (const c of countries) { if (c.country) pricing[countryEntryKey(c)] = countryEntryValue(c); }
    return { pricing, rss: rss/100, fuelPct: fuel/100, rssStartDate: rssDate||null, fuelStartDate: fuelDate||null, observations: [] };
  };

  const enterChat = (parsed, greeting) => {
    setAiParsed(parsed);
    setChatMsgs([{ role: 'assistant', content: greeting }]);
    setAiPhase('chat');
    scrollChat();
  };

  const processAiResult = (parsed) => {
    if (!parsed) { toast('لم يتمكن AI من قراءة العقد — تأكد من وضوح الصورة أو النص', 'error'); return; }
    const n   = Object.keys(parsed.pricing||{}).length;
    const obs = parsed.observations?.length ? '\n\n⚠️ ملاحظات:\n' + parsed.observations.map(o=>`• ${o}`).join('\n') : '';
    const greeting =
      `✅ تم استخراج ${n} دول: ${Object.keys(parsed.pricing||{}).join('، ')}\n` +
      `RSS: ${Math.round((parsed.rss||0)*100)}%  •  وقود: ${Math.round((parsed.fuelPct||0)*100)}%` +
      obs +
      '\n\nأخبرني إذا تريد تعديل أي شيء، أو اضغط "تطبيق على العقد".';
    enterChat(parsed, greeting);
  };

  const readFileAsBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const runAiImage = async (file) => {
    const s = loadSettings();
    if (!s.openrouterKey) { toast('أدخل OpenRouter API Key في الإعدادات أولاً','warn'); return; }
    setAiLoading(true);
    try {
      const dataUrl = await readFileAsBase64(file);
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)[1];
      const parsed = await aiParseContract({ imageBase64: base64, mimeType, hint: aiHint });
      processAiResult(parsed);
    } catch (e) { toast(`AI: ${e.message}`, 'error'); }
    setAiLoading(false);
  };

  const runAiText = async () => {
    const s = loadSettings();
    if (!s.openrouterKey) { toast('أدخل OpenRouter API Key في الإعدادات أولاً','warn'); return; }
    if (!aiText.trim()) { toast('الصق نص العقد أولاً','warn'); return; }
    setAiLoading(true);
    try {
      const parsed = await aiParseContract({ text: aiText, hint: aiHint });
      processAiResult(parsed);
    } catch (e) { toast(`AI: ${e.message}`, 'error'); }
    setAiLoading(false);
  };

  const openEditChat = () => {
    const p = currentParsedFromForm();
    const n = Object.keys(p.pricing).length;
    const greeting = n > 0
      ? `لديك ${n} دول: ${Object.keys(p.pricing).join('، ')}\nRSS: ${Math.round(p.rss*100)}%  •  وقود: ${Math.round(p.fuelPct*100)}%\n\nأخبرني ماذا تريد تعديل.`
      : `العقد فارغ حتى الآن. أخبرني بالأسعار أو ارفع صورة.`;
    enterChat(p, greeting);
  };

  const sendChat = async () => {
    const s = loadSettings();
    if (!s.openrouterKey) { toast('أدخل OpenRouter API Key في الإعدادات أولاً','warn'); return; }
    if (!chatInput.trim() || aiLoading) return;
    const userMsg = { role: 'user', content: chatInput };
    const newHistory = [...chatMsgs, userMsg];
    setChatMsgs(newHistory);
    setChatInput('');
    setAiLoading(true);
    scrollChat();
    try {
      const context = aiParsed || currentParsedFromForm();
      const result  = await aiRefineContract(context, chatMsgs, chatInput);
      if (result.updated) setAiParsed(result.updated);
      setChatMsgs(m => [...m, { role: 'assistant', content: result.message }]);
      scrollChat();
    } catch (e) { toast(`AI: ${e.message}`, 'error'); }
    setAiLoading(false);
  };

  const applyParsed = () => {
    const p = aiParsed;
    if (!p) return;
    if (p.rss          !== undefined) setRss(Math.round(p.rss * 100));
    if (p.fuelPct      !== undefined) setFuel(Math.round(p.fuelPct * 100));
    if (p.rssStartDate)               setRssDate(p.rssStartDate);
    if (p.fuelStartDate)              setFuelDate(p.fuelStartDate);
    const hasPricing = p.pricing && Object.keys(p.pricing).length > 0;
    if (hasPricing) {
      setCountries(Object.entries(p.pricing).map(([country, def]) => parseCountryEntry(country, def)));
      setShowManual(true); // reveal pricing so user can see what was applied
    }
    toast(
      hasPricing
        ? `✓ تم تطبيق ${Object.keys(p.pricing).length} دول على العقد`
        : `✓ تم تطبيق RSS ${Math.round((p.rss||0)*100)}% ووقود ${Math.round((p.fuelPct||0)*100)}%`,
      'success'
    );
    setAiPhase('input');
    setAiParsed(null);
    setChatMsgs([]);
    setAiText('');
  };

  const addCountry = () => setCountries(c=>[...c,{origin:'',country:'',multiType:false,tiers:defaultTiers(),types:[]}]);
  const save = () => {
    if (!label.trim()) { toast('أدخل اسم/رقم العقد','error'); return; }
    if (!startDate)    { toast('أدخل تاريخ بداية العقد','error'); return; }
    const pricing = {};
    for (const c of countries) { if (c.country) pricing[countryEntryKey(c)] = countryEntryValue(c); }
    onSave({
      id: contract?.id || `ct_${Date.now()}`,
      label, startDate, endDate: endDate||null,
      rss: rss/100, rssStartDate: rssDate||null,
      fuelPct: fuel/100, fuelStartDate: fuelDate||null, fuelBase, notes, pricing,
    });
  };

  const inputStyle = { width:'100%', padding:'7px 10px', borderRadius:7, fontSize:12,
    background:'var(--card)', border:'1px solid var(--border)', color:'var(--text)',
    fontFamily:'var(--font-sans)', outline:'none', boxSizing:'border-box' };

  return (
    <Modal title={contract ? '✏️ تعديل عقد' : '➕ عقد جديد'} onClose={onClose} width={660}>

      {/* ── Metadata ──────────────────────────────────────────────────────────── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <Input label="اسم/رقم العقد" value={label} onChange={e=>setLabel(e.target.value)} placeholder="عقد 2025"/>
        <Input label="تاريخ البداية" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/>
        <Input label="تاريخ النهاية (اختياري)" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/>
        <Input label="ملاحظات" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="مثال: سعر الوقود الفعلي 29.5%"/>
      </div>

      {/* ── AI Chat Panel ─────────────────────────────────────────────────────── */}
      <div style={{border:'1px solid rgba(245,166,35,.35)',borderRadius:12,overflow:'clip',marginBottom:16}}>

        {/* Panel header */}
        <div style={{background:'rgba(245,166,35,.08)',padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:16}}>✨</span>
            <span style={{color:'var(--gold)',fontSize:13,fontWeight:700}}>مساعد AI للعقد</span>
            <span style={{color:'var(--muted)',fontSize:10}}>استيراد صورة أو نص + تعديل بالمحادثة</span>
          </div>
          {aiPhase === 'input' && countries.length > 0 && (
            <Btn size="sm" variant="ghost" onClick={openEditChat} style={{fontSize:11}}>
              💬 تعديل الأسعار بالمحادثة
            </Btn>
          )}
          {aiPhase === 'chat' && (
            <Btn size="sm" variant="ghost" onClick={()=>{setAiPhase('input');setAiParsed(null);setChatMsgs([]);}} style={{fontSize:11}}>
              ← رجوع
            </Btn>
          )}
        </div>

        {/* ── Phase: input ──────────────────────────────────────────────────── */}
        {aiPhase === 'input' && (
          <div style={{padding:14}}>
            <div style={{marginBottom:12}}>
              <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:5}}>💬 ملاحظة للـ AI قبل التحليل (اختياري)</label>
              <input value={aiHint} onChange={e=>setAiHint(e.target.value)}
                placeholder="مثال: الوقود 29.5%، هذا عقد دولي، تجاهل الصف الأول"
                autoComplete="new-password"
                style={inputStyle}/>
            </div>

            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}}
              onChange={e=>{ const f=e.target.files?.[0]; if(f) runAiImage(f); e.target.value=''; }}/>
            <Btn variant="outline" size="sm" disabled={aiLoading} onClick={()=>fileRef.current?.click()}
              style={{width:'100%',justifyContent:'center',gap:8,marginBottom:10}}>
              {aiLoading ? <><Spinner size={13}/> AI يقرأ الصورة...</> : '🖼 ارفع صورة أو screenshot للعقد'}
            </Btn>

            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
              <div style={{flex:1,height:1,background:'var(--border)'}}/>
              <span style={{color:'var(--muted)',fontSize:10}}>أو الصق نص العقد</span>
              <div style={{flex:1,height:1,background:'var(--border)'}}/>
            </div>

            <textarea value={aiText} onChange={e=>setAiText(e.target.value)}
              placeholder="الصق هنا جدول الأسعار أو نص العقد كاملاً..."
              rows={4} autoComplete="off"
              style={{...inputStyle, fontFamily:'var(--font-mono)', lineHeight:1.7, resize:'vertical'}}/>
            <Btn variant="primary" size="sm" disabled={aiLoading||!aiText.trim()} onClick={runAiText}
              style={{marginTop:8,width:'100%',justifyContent:'center',gap:7}}>
              {aiLoading ? <><Spinner size={13}/> يحلل النص...</> : '✨ تحليل النص'}
            </Btn>
          </div>
        )}

        {/* ── Phase: chat ───────────────────────────────────────────────────── */}
        {aiPhase === 'chat' && (
          <div>
            {/* Summary bar */}
            {aiParsed && (
              <div style={{padding:'6px 14px',background:'var(--surface)',borderBottom:'1px solid var(--border)',display:'flex',gap:16,flexWrap:'wrap'}}>
                <span style={{fontSize:11,color:'var(--muted)'}}>دول: <strong style={{color:'var(--accent)'}}>{Object.keys(aiParsed.pricing||{}).length}</strong></span>
                <span style={{fontSize:11,color:'var(--muted)'}}>RSS: <strong style={{color:'var(--accent)',fontFamily:'var(--font-mono)'}}>{Math.round((aiParsed.rss||0)*100)}%</strong></span>
                <span style={{fontSize:11,color:'var(--muted)'}}>وقود: <strong style={{color:'var(--accent)',fontFamily:'var(--font-mono)'}}>{Math.round((aiParsed.fuelPct||0)*100)}%</strong></span>
                {aiParsed.rssStartDate && <span style={{fontSize:11,color:'var(--muted)'}}>RSS من: <strong style={{color:'var(--accent)'}}>{aiParsed.rssStartDate}</strong></span>}
              </div>
            )}

            {/* Messages */}
            <div style={{maxHeight:230,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:8}}>
              {chatMsgs.map((m,i)=>(
                <div key={i} style={{
                  alignSelf:   m.role==='user'?'flex-end':'flex-start',
                  maxWidth:    '88%',
                  background:  m.role==='user'?'rgba(45,212,191,.12)':'var(--surface)',
                  border:      `1px solid ${m.role==='user'?'rgba(45,212,191,.25)':'var(--border)'}`,
                  borderRadius: m.role==='user'?'12px 12px 4px 12px':'12px 12px 12px 4px',
                  padding:'9px 12px', fontSize:12, lineHeight:1.65, whiteSpace:'pre-wrap',
                }}>
                  {m.role==='assistant'&&<span style={{color:'var(--gold)',fontSize:10,display:'block',marginBottom:3}}>✨ AI</span>}
                  {m.content}
                </div>
              ))}
              {aiLoading && (
                <div style={{alignSelf:'flex-start',display:'flex',alignItems:'center',gap:6,color:'var(--muted)',fontSize:11,padding:'6px 10px'}}>
                  <Spinner size={11}/> AI يفكر...
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {/* Chat input */}
            <div style={{padding:'10px 14px',borderTop:'1px solid var(--border)',display:'flex',gap:7,alignItems:'center'}}>
              <input ref={fileRef2} type="file" accept="image/*" style={{display:'none'}}
                onChange={e=>{ const f=e.target.files?.[0]; if(f){ runAiImage(f); setAiPhase('chat'); } e.target.value=''; }}/>
              <button title="ارفع صورة جديدة" onClick={()=>fileRef2.current?.click()}
                style={{background:'transparent',border:'1px solid var(--border)',borderRadius:7,padding:'5px 8px',cursor:'pointer',fontSize:14,color:'var(--muted)'}}>
                🖼
              </button>
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); } }}
                placeholder="مثال: الوقود 29.5%  •  عدل Qatar: 40 ريال لأول كيلو  •  احذف UAE"
                disabled={aiLoading}
                autoComplete="new-password"
                style={{...inputStyle,flex:1}}
              />
              <Btn size="sm" variant="primary" onClick={sendChat} disabled={aiLoading||!chatInput.trim()}>
                إرسال
              </Btn>
            </div>

            {/* Apply */}
            <div style={{padding:'10px 14px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'flex-end'}}>
              <Btn variant="success" onClick={applyParsed} style={{gap:7,justifyContent:'center'}}>
                ✅ تطبيق على العقد
              </Btn>
            </div>
          </div>
        )}
      </div>

      {/* ── Additional charges (manual) ───────────────────────────────────────── */}
      <div style={{background:'var(--surface)',borderRadius:9,padding:'12px 14px',marginBottom:16}}>
        <div style={{color:'var(--muted)',fontSize:11,fontFamily:'var(--font-mono)',marginBottom:10}}>⚡ الرسوم الإضافية (يمكن تعديلها عبر AI أعلاه أو يدوياً)</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:10}}>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>RSS %</label>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              <input type="number" min="0" max="100" value={rss} onChange={e=>setRss(+e.target.value)}
                style={{width:'100%',padding:'6px 8px',borderRadius:6,textAlign:'center',fontSize:12,background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}}/>
              <span style={{color:'var(--muted)',fontSize:12}}>%</span>
            </div>
          </div>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>بداية RSS</label>
            <input type="date" value={rssDate} onChange={e=>setRssDate(e.target.value)}
              style={{width:'100%',padding:'6px 8px',borderRadius:6,fontSize:12,background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}}/>
          </div>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>وقود %</label>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              <input type="number" min="0" max="100" value={fuel} onChange={e=>setFuel(+e.target.value)}
                style={{width:'100%',padding:'6px 8px',borderRadius:6,textAlign:'center',fontSize:12,background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}}/>
              <span style={{color:'var(--muted)',fontSize:12}}>%</span>
            </div>
          </div>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>بداية الوقود</label>
            <input type="date" value={fuelDate} onChange={e=>setFuelDate(e.target.value)}
              style={{width:'100%',padding:'6px 8px',borderRadius:6,fontSize:12,background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}}/>
          </div>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>الوقود على</label>
            <select value={fuelBase} onChange={e=>setFuelBase(e.target.value)}
              style={{width:'100%',padding:'6px 8px',borderRadius:6,fontSize:11,cursor:'pointer',background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}}>
              <option value="delivery">شحن فقط</option>
              <option value="delivery+rss">شحن + RSS</option>
            </select>
          </div>
        </div>
        <div style={{marginTop:8,padding:'5px 10px',background:'var(--card)',borderRadius:6,fontSize:11,color:'var(--gold)',fontFamily:'var(--font-mono)'}}>
          RSS {rss}% {rssDate?`(من ${rssDate})`:'(دائماً)'} · وقود {fuel}% {fuelDate?`(من ${fuelDate})`:'(دائماً)'} على ({fuelBase==='delivery+rss'?'شحن+RSS':'شحن فقط'})
        </div>
      </div>

      {/* ── Country pricing (manual) ──────────────────────────────────────────── */}
      <div style={{marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <button onClick={()=>setShowManual(v=>!v)}
            style={{background:'transparent',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:11,fontFamily:'var(--font-mono)',display:'flex',alignItems:'center',gap:6}}>
            📋 التسعير اليدوي ({countries.length} دول) {showManual?'▲':'▼'}
          </button>
          {showManual && <Btn size="sm" variant="outline" onClick={addCountry}>+ إضافة دولة</Btn>}
        </div>
        {showManual && (
          countries.length===0
            ? <div style={{textAlign:'center',padding:16,color:'var(--muted)',fontSize:12,border:'1px dashed var(--border)',borderRadius:8}}>
                اضغط "+ إضافة دولة" أو استخدم AI أعلاه
              </div>
            : countries.map((c,i)=>(
                <CountryBlock key={i} entry={c}
                  onChange={v=>setCountries(cs=>cs.map((x,j)=>j===i?v:x))}
                  onDelete={()=>setCountries(cs=>cs.filter((_,j)=>j!==i))}/>
              ))
        )}
        {!showManual && countries.length > 0 && (
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {countries.map((c,i)=>(
              <span key={i} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:6,padding:'3px 10px',fontSize:11,color:'var(--muted)'}}>
                {c.country||'—'}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{display:'flex',gap:9,justifyContent:'flex-end'}}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant="primary" onClick={save}>حفظ العقد ✓</Btn>
      </div>
    </Modal>
  );
}

// ── Carrier form ───────────────────────────────────────────────────────────────
const LOGOS = ['📦','🚚','✈️','🛳️','🏢','📮','🔵','🟡','🟢','🔴'];
const COLORS = ['#f5a623','#00c6ff','#00e676','#ff4d6d','#a855f7','#f97316','#06b6d4','#84cc16'];

function CarrierForm({ carrier, onSave, onClose }) {
  const [name,  setName]  = useState(carrier?.name||'');
  const [logo,  setLogo]  = useState(carrier?.logo||'📦');
  const [color, setColor] = useState(carrier?.color||COLORS[0]);
  // Operational metadata — all optional
  const [contactEmail,   setContactEmail]   = useState(carrier?.contactEmail   || '');
  const [contactPhone,   setContactPhone]   = useState(carrier?.contactPhone   || '');
  const [accountManager, setAccountManager] = useState(carrier?.accountManager || '');
  const [iban,           setIban]           = useState(carrier?.iban           || '');
  const [bankName,       setBankName]       = useState(carrier?.bankName       || '');
  const [contractFile,   setContractFile]   = useState(null);
  const [uploading,      setUploading]      = useState(false);
  const [contractPath,   setContractPath]   = useState(carrier?.contractPdfPath || null);

  const handleContractUpload = async (file) => {
    if (!file) return;
    if (!carrier?.id) {
      // Carrier doesn't exist yet — defer until save
      setContractFile(file);
      return;
    }
    setUploading(true);
    try {
      const path = await uploadCarrierContractPdf({ carrierId: carrier.id, file });
      if (path) {
        setContractPath(path);
        setContractFile(null);
        toast('تم رفع العقد ✓', 'success');
      } else {
        toast('فشل رفع العقد', 'error');
      }
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setUploading(false);
  };

  const handleViewContract = async () => {
    if (!contractPath) return;
    const url = await getCarrierContractUrl(contractPath, 600);
    if (url) window.open(url, '_blank', 'noopener');
    else toast('تعذّر فتح الملف', 'error');
  };

  const save = async () => {
    if (!name.trim()) { toast('أدخل اسم الشركة','error'); return; }
    const id = carrier?.id || `c_${Date.now()}`;
    let finalContractPath = contractPath;
    // If a file was queued (new carrier without id at the time), upload now.
    if (contractFile && !contractPath) {
      setUploading(true);
      try {
        finalContractPath = await uploadCarrierContractPdf({ carrierId: id, file: contractFile });
      } catch { /* fall through, save without contract */ }
      setUploading(false);
    }
    onSave({
      ...carrier, id, name, logo, color,
      contracts: carrier?.contracts || [],
      contactEmail, contactPhone, accountManager,
      iban, bankName,
      contractPdfPath: finalContractPath,
    });
  };

  return (
    <Modal title={carrier?'✏️ تعديل شركة':'➕ شركة جديدة'} onClose={onClose} width={520}>
      <Input label="اسم الشركة" value={name} onChange={e=>setName(e.target.value)} placeholder="مثال: سمسا SMSA" style={{marginBottom:16}}/>

      <div style={{marginBottom:16}}>
        <div style={{color:'var(--muted)',fontSize:11,marginBottom:8}}>الأيقونة</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {LOGOS.map(l=>(
            <button key={l} onClick={()=>setLogo(l)} style={{
              fontSize:22,background:logo===l?'var(--accent)18':'transparent',
              border:`1px solid ${logo===l?'var(--accent)':'var(--border)'}`,
              borderRadius:8,padding:'4px 8px',cursor:'pointer',
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{marginBottom:18}}>
        <div style={{color:'var(--muted)',fontSize:11,marginBottom:8}}>لون الشركة</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {COLORS.map(c=>(
            <button key={c} onClick={()=>setColor(c)} style={{
              width:28,height:28,borderRadius:'50%',background:c,cursor:'pointer',
              border:`3px solid ${color===c?'white':'transparent'}`,
              boxShadow:color===c?`0 0 0 2px ${c}`:'none',
            }}/>
          ))}
        </div>
      </div>

      {/* Operational metadata — collapsible-style section */}
      <div style={{
        marginBottom: 16, padding: '12px 14px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 9,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 10 }}>
          📞 بيانات تواصل (اختياري)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Input label="البريد الإلكتروني" value={contactEmail} onChange={e=>setContactEmail(e.target.value)}
            placeholder="billing@aramex.com" type="email"/>
          <Input label="رقم الجوال" value={contactPhone} onChange={e=>setContactPhone(e.target.value)}
            placeholder="+966 5XX XXX XXXX"/>
          <Input label="مدير الحساب" value={accountManager} onChange={e=>setAccountManager(e.target.value)}
            placeholder="اسم المسؤول من الناقل" style={{ gridColumn: '1 / -1' }}/>
        </div>
      </div>

      <div style={{
        marginBottom: 16, padding: '12px 14px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 9,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 10 }}>
          🏦 بيانات بنكية (اختياري)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Input label="اسم البنك" value={bankName} onChange={e=>setBankName(e.target.value)}
            placeholder="مصرف الراجحي"/>
          <Input label="IBAN" value={iban} onChange={e=>setIban(e.target.value)}
            placeholder="SA12 3456 7890 1234 5678 9012"/>
        </div>
      </div>

      <div style={{
        marginBottom: 16, padding: '12px 14px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 9,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 10 }}>
          📄 العقد الموقّع (اختياري)
        </div>
        {contractPath ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
              ✓ مرفوع — {contractPath.split('/').pop()}
            </span>
            <Btn size="sm" variant="ghost" onClick={handleViewContract}>عرض</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setContractPath(null)}>إزالة</Btn>
          </div>
        ) : contractFile ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            📎 جاهز للرفع: {contractFile.name} (سيُرفع عند حفظ الشركة)
            <Btn size="sm" variant="ghost" onClick={() => setContractFile(null)} style={{ marginRight: 8 }}>إلغاء</Btn>
          </div>
        ) : (
          <input type="file" accept=".pdf" disabled={uploading}
            onChange={e => handleContractUpload(e.target.files?.[0])}
            style={{ width: '100%', fontSize: 12 }}/>
        )}
      </div>

      <div style={{display:'flex',gap:9,justifyContent:'flex-end'}}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant="primary" onClick={save} disabled={uploading}>
          {uploading ? 'جارٍ الرفع...' : 'حفظ ✓'}
        </Btn>
      </div>
    </Modal>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CarrierManager({ carriers, setCarriers }) {
  const [selected,       setSelected]       = useState(carriers[0]?.id||null);
  const [showCarrierForm,setShowCarrierForm] = useState(false);
  const [editCarrier,    setEditCarrier]     = useState(null);
  const [showContract,   setShowContract]    = useState(false);
  const [editContract,   setEditContract]    = useState(null);
  const [confirmDelete,  setConfirmDelete]   = useState(null);

  const carrier = carriers.find(c=>c.id===selected);

  const saveAndPersist = async (updated) => {
    const n = updateCarrier(carriers, updated);
    setCarriers(n);
    try { await saveCarrier(updated); }
    catch (e) { toast(`خطأ في الحفظ: ${e.message}`, 'error'); }
  };

  const handleSaveCarrier = async (c) => {
    const updated = carriers.find(x=>x.id===c.id) ? updateCarrier(carriers,c) : addCarrier(carriers,c);
    setCarriers(updated);
    try { await saveCarrier(c); }
    catch (e) { toast(`خطأ في الحفظ: ${e.message}`, 'error'); return; }
    setSelected(c.id); setShowCarrierForm(false); setEditCarrier(null);
    toast(`تم حفظ ${c.name}`, 'success');
  };

  const handleDeleteCarrier = async (id) => {
    const updated = deleteCarrier(carriers, id);
    setCarriers(updated);
    try { await deleteCarrierFromDB(id); }
    catch (e) { toast(`خطأ في الحذف: ${e.message}`, 'error'); return; }
    setSelected(updated[0]?.id||null); setConfirmDelete(null);
    toast('تم حذف الشركة', 'info');
  };

  const handleSaveContract = (ct) => {
    if (!carrier) return;
    const contracts = carrier.contracts||[];
    const exists    = contracts.findIndex(c=>c.id===ct.id);
    const updated   = exists>=0 ? contracts.map(c=>c.id===ct.id?ct:c) : [...contracts,ct];
    saveAndPersist({...carrier,contracts:updated});
    setShowContract(false); setEditContract(null);
    toast('تم حفظ العقد','success');
  };

  const handleDeleteContract = (id) => {
    if (!carrier) return;
    saveAndPersist({...carrier,contracts:(carrier.contracts||[]).filter(c=>c.id!==id)});
    toast('تم حذف العقد','info');
  };

  return (
    <div className="cm-root" style={{display:'grid',gridTemplateColumns:'260px 1fr',height:'100%',overflow:'hidden'}}>

      {/* Sidebar */}
      <div style={{background:'var(--surface)',borderLeft:'1px solid var(--border)',padding:16,overflowY:'auto',height:'100%'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <span style={{fontFamily:'var(--font-mono)',fontSize:12,color:'var(--accent)'}}>شركات الشحن</span>
          <Btn size="sm" variant="primary" onClick={()=>{setEditCarrier(null);setShowCarrierForm(true);}}>+ جديد</Btn>
        </div>
        {carriers.length===0
          ? <Empty icon="🏢" title="لا توجد شركات"/>
          : carriers.map(c=>(
              <div key={c.id} onClick={()=>setSelected(c.id)} style={{
                padding:'10px 12px',borderRadius:9,cursor:'pointer',marginBottom:5,
                background:selected===c.id?`${c.color||'var(--accent)'}18`:'transparent',
                border:`1px solid ${selected===c.id?c.color||'var(--accent)':'transparent'}`,
                display:'flex',alignItems:'center',gap:10,
              }}>
                <span style={{fontSize:20}}>{c.logo||'📦'}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</div>
                  <div style={{color:'var(--muted)',fontSize:11}}>{c.contracts?.length||0} عقد</div>
                </div>
                <div style={{width:8,height:8,borderRadius:'50%',background:c.color||'var(--accent)',flexShrink:0}}/>
              </div>
            ))
        }
      </div>

      {/* Detail */}
      <div style={{padding:24,overflowY:'auto'}}>
        {!carrier
          ? <Empty icon="👈" title="اختر شركة من القائمة" sub="أو أضف شركة جديدة"/>
          : (
            <div className="fade-in">
              {/* Header */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
                <div style={{display:'flex',alignItems:'center',gap:14}}>
                  <div style={{fontSize:40,background:carrier.color+'18',borderRadius:12,padding:'8px 12px'}}>{carrier.logo||'📦'}</div>
                  <div>
                    <h2 style={{fontSize:20,fontWeight:700,marginBottom:4}}>{carrier.name}</h2>
                    <div style={{color:'var(--muted)',fontSize:12}}>{carrier.contracts?.length||0} عقد · {carrier.id}</div>
                  </div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <Btn size="sm" variant="ghost" onClick={()=>{setEditCarrier(carrier);setShowCarrierForm(true);}}>✏️ تعديل</Btn>
                  <Btn size="sm" variant="danger" onClick={()=>setConfirmDelete(carrier.id)}>🗑 حذف</Btn>
                </div>
              </div>

              {/* Contracts */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                <span style={{fontFamily:'var(--font-mono)',fontSize:13,color:'var(--accent)'}}>📄 العقود</span>
                <Btn size="sm" variant="success" onClick={()=>{setEditContract(null);setShowContract(true);}}>+ عقد جديد</Btn>
              </div>

              {(!carrier.contracts||carrier.contracts.length===0)
                ? <Empty icon="📄" title="لا توجد عقود" sub="أضف عقداً لتعريف التسعيرة"/>
                : (
                  <div className="stagger">
                    {carrier.contracts.map(ct=>(
                      <Card key={ct.id} style={{marginBottom:14,padding:0,overflow:'hidden'}}>
                        <div style={{padding:'12px 16px',background:'var(--surface)',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid var(--border)'}}>
                          <div>
                            <span style={{fontWeight:700,fontSize:14,marginLeft:10}}>{ct.label}</span>
                            <span style={{color:'var(--muted)',fontSize:11}}>
                              {ct.startDate} {ct.endDate?`← ${ct.endDate}`:'← سارٍ'}
                            </span>
                          </div>
                          <div style={{display:'flex',gap:6}}>
                            <Btn size="sm" variant="ghost" onClick={()=>{setEditContract(ct);setShowContract(true);}}>✏️</Btn>
                            <Btn size="sm" variant="danger" onClick={()=>handleDeleteContract(ct.id)}>🗑</Btn>
                          </div>
                        </div>
                        <div style={{padding:'12px 16px'}}>
                          <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:10}}>
                            <span style={{fontSize:12}}><span style={{color:'var(--muted)'}}>RSS: </span><span style={{color:'var(--accent)',fontFamily:'var(--font-mono)'}}>{(ct.rss*100).toFixed(0)}%</span>{ct.rssStartDate&&<span style={{color:'var(--muted)'}}> من {ct.rssStartDate}</span>}</span>
                            <span style={{fontSize:12}}><span style={{color:'var(--muted)'}}>وقود: </span><span style={{color:'var(--accent)',fontFamily:'var(--font-mono)'}}>{(ct.fuelPct*100).toFixed(0)}%</span></span>
                            <span style={{fontSize:12,color:'var(--muted)'}}>{ct.fuelBase==='delivery+rss'?'على شحن+RSS':'على شحن فقط'}</span>
                          </div>
                          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                            {Object.keys(ct.pricing||{}).map(country=>(
                              <div key={country} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:6,padding:'4px 10px',fontSize:11}}>
                                <span style={{color:'var(--muted)'}}>{country}</span>
                              </div>
                            ))}
                          </div>
                          {ct.notes&&<div style={{marginTop:8,color:'var(--warn)',fontSize:11}}>⚠️ {ct.notes}</div>}
                        </div>
                      </Card>
                    ))}
                  </div>
                )
              }
            </div>
          )
        }
      </div>

      {/* Modals */}
      {showCarrierForm && (
        <CarrierForm carrier={editCarrier} onSave={handleSaveCarrier} onClose={()=>{setShowCarrierForm(false);setEditCarrier(null);}}/>
      )}
      {showContract && carrier && (
        <ContractForm contract={editContract} onSave={handleSaveContract} onClose={()=>{setShowContract(false);setEditContract(null);}}/>
      )}
      {confirmDelete && (
        <Modal title="⚠️ تأكيد الحذف" onClose={()=>setConfirmDelete(null)} width={360}>
          <p style={{color:'var(--muted)',marginBottom:20}}>هل أنت متأكد من حذف هذه الشركة وجميع عقودها؟ لا يمكن التراجع.</p>
          <div style={{display:'flex',gap:9,justifyContent:'flex-end'}}>
            <Btn variant="ghost" onClick={()=>setConfirmDelete(null)}>إلغاء</Btn>
            <Btn variant="danger" onClick={()=>handleDeleteCarrier(confirmDelete)}>حذف نهائياً</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
