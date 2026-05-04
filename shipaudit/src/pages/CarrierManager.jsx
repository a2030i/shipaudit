import { useState } from 'react';
import { Card, Btn, Input, Select, Modal, Empty, toast } from '../components/UI.jsx';
import { addCarrier, updateCarrier, deleteCarrier, saveCarriers, COUNTRIES } from '../data/carriers.js';
import { previewPricing } from '../engine/pricing.js';

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

// ── Country pricing block ──────────────────────────────────────────────────────
function CountryBlock({ entry, onChange, onDelete }) {
  return (
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:9,padding:'12px 14px',marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <select value={entry.country} onChange={e=>onChange({...entry,country:e.target.value})}
          style={{flex:1,padding:'6px 10px',borderRadius:7,fontSize:13,cursor:'pointer',marginLeft:8}}>
          <option value="">اختر دولة</option>
          {COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <Btn size="sm" variant="danger" onClick={onDelete}>حذف</Btn>
      </div>
      <TierEditor tiers={entry.tiers} onChange={tiers=>onChange({...entry,tiers})}/>
    </div>
  );
}

// ── Contract Form ──────────────────────────────────────────────────────────────
function defaultTiers() { return [{upTo:'1',type:'flat',price:'',pricePerUnit:'',unitKg:'0.5'},{upTo:'',type:'per',price:'',pricePerUnit:'',unitKg:'0.5'}]; }

function tiersFromPricing(def) {
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

function tiersToArray(tiers) {
  return tiers.filter(t=>t.price!==''||t.pricePerUnit!=='').map(t=>({
    upTo: t.upTo===''?null:+t.upTo,
    ...(t.type==='flat' ? {price:+t.price} : {pricePerUnit:+t.pricePerUnit,unitKg:+t.unitKg}),
  }));
}

function ContractForm({ contract, onSave, onClose }) {
  const [label,     setLabel]     = useState(contract?.label||'');
  const [startDate, setStartDate] = useState(contract?.startDate||'');
  const [endDate,   setEndDate]   = useState(contract?.endDate||'');
  const [rss,       setRss]       = useState(Math.round((contract?.rss??0.16)*100));
  const [rssDate,   setRssDate]   = useState(contract?.rssStartDate||'');
  const [fuel,      setFuel]      = useState(Math.round((contract?.fuelPct??0.15)*100));
  const [fuelBase,  setFuelBase]  = useState(contract?.fuelBase||'delivery+rss');
  const [notes,     setNotes]     = useState(contract?.notes||'');
  const [countries, setCountries] = useState(
    Object.entries(contract?.pricing||{}).map(([country,def])=>({country,tiers:tiersFromPricing(def)}))
  );

  const addCountry = () => setCountries(c=>[...c,{country:'',tiers:defaultTiers()}]);
  const save = () => {
    if (!label.trim()) { toast('أدخل اسم/رقم العقد','error'); return; }
    if (!startDate)    { toast('أدخل تاريخ بداية العقد','error'); return; }
    const pricing = {};
    for (const c of countries) {
      if (c.country) pricing[c.country] = tiersToArray(c.tiers);
    }
    onSave({
      id: contract?.id || `ct_${Date.now()}`,
      label, startDate, endDate: endDate||null,
      rss: rss/100, rssStartDate: rssDate||null,
      fuelPct: fuel/100, fuelBase, notes, pricing,
    });
  };

  return (
    <Modal title={contract ? '✏️ تعديل عقد' : '➕ عقد جديد'} onClose={onClose} width={620}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <Input label="اسم/رقم العقد" value={label} onChange={e=>setLabel(e.target.value)} placeholder="عقد 2025"/>
        <Input label="تاريخ البداية" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/>
        <Input label="تاريخ النهاية (اختياري)" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/>
      </div>

      <div style={{background:'var(--surface)',borderRadius:9,padding:'12px 14px',marginBottom:16}}>
        <div style={{color:'var(--muted)',fontSize:11,fontFamily:'var(--font-mono)',marginBottom:10}}>⚡ الرسوم الإضافية</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:10}}>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>RSS %</label>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              <input type="number" min="0" max="100" value={rss} onChange={e=>setRss(+e.target.value)}
                style={{width:'100%',padding:'6px 8px',borderRadius:6,textAlign:'center',fontSize:12}}/>
              <span style={{color:'var(--muted)',fontSize:12}}>%</span>
            </div>
          </div>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>بداية RSS</label>
            <input type="date" value={rssDate} onChange={e=>setRssDate(e.target.value)}
              style={{width:'100%',padding:'6px 8px',borderRadius:6,fontSize:12}}/>
          </div>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>وقود %</label>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              <input type="number" min="0" max="100" value={fuel} onChange={e=>setFuel(+e.target.value)}
                style={{width:'100%',padding:'6px 8px',borderRadius:6,textAlign:'center',fontSize:12}}/>
              <span style={{color:'var(--muted)',fontSize:12}}>%</span>
            </div>
          </div>
          <div>
            <label style={{display:'block',color:'var(--muted)',fontSize:11,marginBottom:4}}>الوقود على</label>
            <select value={fuelBase} onChange={e=>setFuelBase(e.target.value)}
              style={{width:'100%',padding:'6px 8px',borderRadius:6,fontSize:11,cursor:'pointer'}}>
              <option value="delivery+rss">شحن + RSS</option>
              <option value="delivery">شحن فقط</option>
            </select>
          </div>
        </div>
        <div style={{marginTop:10,padding:'5px 10px',background:'var(--card)',borderRadius:6,fontSize:11,color:'var(--gold)',fontFamily:'var(--font-mono)'}}>
          RSS {rss}% {rssDate?`(من ${rssDate})`:'(دائماً)'} + وقود {fuel}% على ({fuelBase==='delivery+rss'?'شحن+RSS':'شحن فقط'})
        </div>
      </div>

      <div style={{marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <span style={{color:'var(--muted)',fontSize:11,fontFamily:'var(--font-mono)'}}>📋 التسعير بالدولة</span>
          <Btn size="sm" variant="outline" onClick={addCountry}>+ إضافة دولة</Btn>
        </div>
        {countries.length===0
          ? <div style={{textAlign:'center',padding:'20px',color:'var(--muted)',fontSize:12,border:'1px dashed var(--border)',borderRadius:8}}>
              اضغط "+ إضافة دولة" لإضافة تسعيرة
            </div>
          : countries.map((c,i)=>(
              <CountryBlock key={i} entry={c}
                onChange={v=>setCountries(cs=>cs.map((x,j)=>j===i?v:x))}
                onDelete={()=>setCountries(cs=>cs.filter((_,j)=>j!==i))}/>
            ))
        }
      </div>

      <Input label="ملاحظات (اختياري)" value={notes} onChange={e=>setNotes(e.target.value)}
        placeholder="مثال: تم رفع الأسعار بنسبة 10% من يناير 2026" style={{marginBottom:18}}/>

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

  const save = () => {
    if (!name.trim()) { toast('أدخل اسم الشركة','error'); return; }
    onSave({ ...carrier, id: carrier?.id||`c_${Date.now()}`, name, logo, color, contracts: carrier?.contracts||[] });
  };

  return (
    <Modal title={carrier?'✏️ تعديل شركة':'➕ شركة جديدة'} onClose={onClose} width={400}>
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
      <div style={{marginBottom:20}}>
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
      <div style={{display:'flex',gap:9,justifyContent:'flex-end'}}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant="primary" onClick={save}>حفظ ✓</Btn>
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

  const saveAndPersist = (updated) => { const n=updateCarrier(carriers,updated); setCarriers(n); saveCarriers(n); };

  const handleSaveCarrier = (c) => {
    const updated = carriers.find(x=>x.id===c.id) ? updateCarrier(carriers,c) : addCarrier(carriers,c);
    setCarriers(updated); saveCarriers(updated);
    setSelected(c.id); setShowCarrierForm(false); setEditCarrier(null);
    toast(`تم حفظ ${c.name}`,'success');
  };

  const handleDeleteCarrier = (id) => {
    const updated = deleteCarrier(carriers,id);
    setCarriers(updated); saveCarriers(updated);
    setSelected(updated[0]?.id||null); setConfirmDelete(null);
    toast('تم حذف الشركة','info');
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
    <div style={{display:'grid',gridTemplateColumns:'260px 1fr',minHeight:'calc(100vh - 56px)'}}>

      {/* Sidebar */}
      <div style={{background:'var(--surface)',borderLeft:'1px solid var(--border)',padding:16,overflowY:'auto'}}>
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
