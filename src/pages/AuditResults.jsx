import { useState, useRef, useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle, RotateCcw, AlertCircle, ClipboardCheck } from 'lucide-react';
import { Card, Btn, StatCard, Badge, DiffCell, Spinner, Modal, Empty, toast, PageHeader } from '../components/UI.jsx';
import { exportAuditExcel, exportWeightsForExternalSystem, exportExcessWeights, exportInboundReturns } from '../engine/export.js';
import { aiAnalyzeAudit, aiChat } from '../engine/openrouter.js';
import { loadSettings, getActiveContract } from '../data/carriers.js';
import { approveAudit, rejectAudit, reopenAudit, saveAuditToDB, evaluateApprovalGate, APPROVAL_DRIFT_TOLERANCE_PRE_TAX, APPROVAL_DRIFT_TOLERANCE_TAX, loadAuditShipments } from '../lib/coreService.js';
import { markEventProcessed } from '../lib/webhookService.js';
import { createClaim } from '../lib/claimsService.js';
import { useAuth } from '../lib/auth.jsx';
import { useNavigate } from 'react-router-dom';

// اعتماد بنقرة (فواتير-1): حارس على مستوى الـmodule — الاعتماد الآلي
// يشتعل مرة واحدة لكل مسودة مهما تكرر الرندر/StrictMode (§2.2).
const AUTO_APPROVED_AUDITS = new Set();

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
        <div style={{padding:'12px 14px',background:'color-mix(in srgb, var(--gold) 8%, transparent)',borderBottom:'1px solid color-mix(in srgb, var(--gold) 20%, transparent)',fontSize:13,lineHeight:1.8}}>
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
          ? <span style={{background:'color-mix(in srgb, var(--red) 15%, transparent)',color:'var(--red)',fontSize:9,padding:'1px 7px',borderRadius:10,border:'1px solid color-mix(in srgb, var(--red) 30%, transparent)'}}>
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
                background: mapped ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : isReq ? 'color-mix(in srgb, var(--red) 7%, transparent)' : 'transparent',
                border:`1px solid ${mapped?'color-mix(in srgb, var(--accent) 20%, transparent)':isReq?'color-mix(in srgb, var(--red) 25%, transparent)':'var(--border)'}`,
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

// ─── Contract helpers ──────────────────────────────────────────────────────────
// Carriers don't all bill the same components. Aramex breaks out delivery
// + RSS + fuel; J&T and iMile bundle everything into a single flat
// charge. Showing empty RSS/fuel columns for those carriers is noise.
// We probe `results` for what actually has data and only render those
// column groups.
function detectColumnVisibility(results) {
  let rss = false, fuel = false, cod = false, pos = false;
  for (const r of results) {
    const iR = r.invoiced?.rss    ?? r.rss            ?? 0;
    const eR = r.expected?.rss    ?? 0;
    const iF = r.invoiced?.fuel   ?? r.fuelSurcharge  ?? 0;
    const eF = r.expected?.fuel   ?? 0;
    const iP = r.invoiced?.posFee ?? r.posFee         ?? 0;
    const eP = r.expected?.posFee ?? 0;
    if (Math.abs(iR) > 0.001 || Math.abs(eR) > 0.001) rss = true;
    if (Math.abs(iF) > 0.001 || Math.abs(eF) > 0.001) fuel = true;
    if (r.isCod || (r.codAmount && r.codAmount > 0) || (r.codFee && r.codFee > 0)) cod = true;
    if (Math.abs(iP) > 0.001 || Math.abs(eP) > 0.001 || (r.posAmount && r.posAmount > 0)) pos = true;
    if (rss && fuel && cod && pos) break;
  }
  return { rss, fuel, cod, pos };
}

// First-bracket allowance (kg) for a destination — the maximum weight the
// carrier bills at the "base" rate. Anything over this is "excess weight"
// the user can re-bill the merchant for through their external system.
function firstBracketUpTo(contract, dest) {
  const p = contract?.pricing?.[dest];
  if (!p) return null;
  if (Array.isArray(p)) {
    const first = p[0];
    return first?.upTo ?? null;
  }
  if (p?.mode === 'lookup' && Array.isArray(p.brackets)) {
    const sorted = [...p.brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    return sorted[0]?.upTo ?? null;
  }
  return null;
}

// Excess weight + the SAR portion of the carrier's expected delivery
// charge attributable to it. For a 7kg shipment on a 10-kg-base contract:
// excessKg = 0, excessCharge = 0. For 12kg on the same contract:
// excessKg = 2, excessCharge = expectedDelivery − basePrice.
function computeExcess(row, contract) {
  const threshold = firstBracketUpTo(contract, row.dest);
  if (threshold == null || !(row.weight > 0)) return { kg: 0, charge: 0 };
  if (row.weight <= threshold) return { kg: 0, charge: 0 };
  const p = contract?.pricing?.[row.dest];
  let baseCharge = 0;
  if (Array.isArray(p) && p[0]?.price != null) baseCharge = p[0].price;
  else if (p?.mode === 'lookup' && Array.isArray(p.brackets)) {
    const sorted = [...p.brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    baseCharge = sorted[0]?.price ?? 0;
  }
  const kg = +(row.weight - threshold).toFixed(2);
  const charge = +(Math.max(0, (row.expected?.delivery ?? 0) - baseCharge)).toFixed(2);
  return { kg, charge };
}

function ResultsTable({ results, filter, showDetail, contract }) {
  const displayed = filter === 'all' ? results : results.filter(r => r.status === filter);
  if (!displayed.length) return <Empty icon="🔍" title="لا توجد نتائج" sub="جرب فلتراً مختلفاً"/>;

  const mis = displayed.filter(r => r.status === 'mismatch');

  const ft = mis.reduce((a, r) => {
    // Prefer post-audit invoiced values (split-out RSS, etc.) over the raw
    // row values, so "مفوتر" matches the engine's per-component diffs.
    const iD = r.invoiced?.delivery ?? r.deliveryCharges ?? 0;
    const iR = r.invoiced?.rss      ?? r.rss             ?? 0;
    const iF = r.invoiced?.fuel     ?? r.fuelSurcharge   ?? 0;
    const iC = r.invoiced?.codFee   ?? r.codFee          ?? 0;
    const iP = r.invoiced?.posFee   ?? r.posFee          ?? 0;
    const iT = r.invoiced?.total ?? (iD + iR + iF + iC + iP);
    return {
      iD: a.iD + iD,  eD: a.eD + (r.expected?.delivery || 0),  dD: a.dD + (r.diffs?.delivery || 0),
      iR: a.iR + iR,  eR: a.eR + (r.expected?.rss      || 0),  dR: a.dR + (r.diffs?.rss      || 0),
      iF: a.iF + iF,  eF: a.eF + (r.expected?.fuel     || 0),  dF: a.dF + (r.diffs?.fuel     || 0),
      iC: a.iC + iC,
      iP: a.iP + iP,
      iT: a.iT + iT,  eT: a.eT + (r.expected?.total    || 0),  dT: a.dT + (r.diffs?.total    || 0),
    };
  }, { iD:0,eD:0,dD:0, iR:0,eR:0,dR:0, iF:0,eF:0,dF:0, iC:0, iP:0, iT:0,eT:0,dT:0 });

  const hasServiceType = results.some(r => r.serviceType);
  const colVis = detectColumnVisibility(results);
  // Excess columns show whenever the contract publishes per-destination
  // brackets — that's the only way "excess" is defined. For lookup
  // contracts with multiple brackets the threshold is the FIRST one.
  const hasExcess = !!contract && results.some(r => firstBracketUpTo(contract, r.dest) != null);

  // info-col count = #, AWB, date, dest, (serviceType?), weight, (excessKg?, excessCharge?)
  let infoCols = 5 + (hasServiceType ? 1 : 0) + (hasExcess ? 2 : 0);

  // Per-group header styles
  const GH = (c, bg) => ({ background:bg, color:c, textAlign:'center', borderBottom:`2px solid color-mix(in srgb, ${c} 33%, transparent)`, padding:'5px 6px', fontSize:11, fontWeight:700 });
  const SH = (c, bg) => ({ background:bg, color:c, textAlign:'center', borderBottom:`2px solid color-mix(in srgb, ${c} 20%, transparent)`, fontSize:10, padding:'4px 8px', fontWeight:600, whiteSpace:'nowrap', minWidth:68 });
  const FC = (c, bg) => ({ fontFamily:'var(--font-mono)', fontSize:11, textAlign:'center', background:bg, color:c });

  // Build the visible groups dynamically. Always show delivery + total;
  // RSS/fuel/COD appear only when at least one row populates them.
  const allGroups = {
    delivery: { key: 'delivery', label: 'شحن',     color:'#3b9ccc', bg:'rgba(59,156,204,.08)', bgL:'rgba(59,156,204,.04)' },
    rss:      { key: 'rss',      label: 'رسوم أمنية (RSS)',     color:'var(--brand-navy)', bg:'color-mix(in srgb, var(--brand-navy) 8%, transparent)', bgL:'color-mix(in srgb, var(--brand-navy) 3%, transparent)' },
    fuel:     { key: 'fuel',     label: 'وقود',    color:'#3aad78', bg:'rgba(58,173,120,.08)', bgL:'rgba(58,173,120,.03)' },
    cod:      { key: 'cod',      label: 'COD',     color:'var(--accent)', bg:'color-mix(in srgb, var(--accent) 10%, transparent)', bgL:'color-mix(in srgb, var(--accent) 4%, transparent)' },
    pos:      { key: 'pos',      label: 'رسوم بطاقة (POS)',     color:'#ec4899', bg:'rgba(236,72,153,.10)', bgL:'rgba(236,72,153,.04)' },
    total:    { key: 'total',    label: 'الإجمالي',color:'var(--gold)', bg:'color-mix(in srgb, var(--gold) 8%, transparent)', bgL:'color-mix(in srgb, var(--gold) 4%, transparent)' },
  };
  const groups = [
    allGroups.delivery,
    ...(colVis.rss  ? [allGroups.rss]  : []),
    ...(colVis.fuel ? [allGroups.fuel] : []),
    ...(colVis.cod  ? [allGroups.cod]  : []),
    ...(colVis.pos  ? [allGroups.pos]  : []),
    allGroups.total,
  ];

  // Helper to pick the invoiced/expected/diff per group key for a row.
  const cellsFor = (g, r, iD, iR, iF) => {
    const iC = r.invoiced?.codFee ?? r.codFee ?? 0;
    const eC = r.isCod ? (r.expected?.delivery || 0)
                       : (r.expected?.codFee   || 0);
    const dC = r.isCod ? (r.diffs?.delivery   || 0)
                       : (r.diffs?.codFee     || 0);
    const iP = r.invoiced?.posFee ?? r.posFee ?? 0;
    const eP = r.expected?.posFee || 0;
    const dP = r.diffs?.posFee    || 0;
    if (g.key === 'delivery') return { inv: r.isCod ? 0 : iD, exp: r.isCod ? 0 : (r.expected?.delivery || 0), diff: r.isCod ? 0 : (r.diffs?.delivery ?? null) };
    if (g.key === 'rss')      return { inv: iR, exp: r.expected?.rss  || 0, diff: r.diffs?.rss  ?? null };
    if (g.key === 'fuel')     return { inv: iF, exp: r.expected?.fuel || 0, diff: r.diffs?.fuel ?? null };
    if (g.key === 'cod')      return { inv: iC, exp: eC, diff: dC };
    if (g.key === 'pos')      return { inv: iP, exp: eP, diff: dP };
    /* total */
    const iT = r.invoiced?.total ?? (iD + iR + iF + iC + iP);
    return { inv: iT, exp: r.expected?.total || 0, diff: r.diffs?.total ?? null };
  };

  const totalFor = (g) => {
    if (g.key === 'delivery') return { inv: ft.iD, exp: ft.eD, diff: ft.dD };
    if (g.key === 'rss')      return { inv: ft.iR, exp: ft.eR, diff: ft.dR };
    if (g.key === 'fuel')     return { inv: ft.iF, exp: ft.eF, diff: ft.dF };
    if (g.key === 'cod')      return { inv: ft.iC, exp: 0,     diff: 0 };
    if (g.key === 'pos')      return { inv: ft.iP, exp: 0,     diff: 0 };
    return { inv: ft.iT, exp: ft.eT, diff: ft.dT };
  };

  // Excess-column header styles (info-side, not a per-group diff trio)
  const excessColor = 'var(--gold)';
  const excessBg    = 'color-mix(in srgb, var(--gold) 6%, transparent)';

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
                {hasExcess && <>
                  <th rowSpan={2} style={{ minWidth:78, background:excessBg, color:excessColor, borderBottom:`2px solid color-mix(in srgb, ${excessColor} 33%, transparent)` }}>وزن زائد</th>
                  <th rowSpan={2} style={{ minWidth:88, background:excessBg, color:excessColor, borderBottom:`2px solid color-mix(in srgb, ${excessColor} 33%, transparent)` }}>رسم زيادة</th>
                </>}
                {groups.map(g => (
                  <th key={g.key} colSpan={3} style={GH(g.color, g.bg)}>{g.label}</th>
                ))}
                <th rowSpan={2} style={{ minWidth:90 }}>الحالة</th>
              </tr>
              <tr>
                {groups.map(g => (
                  [<th key={`${g.key}-i`} style={SH(g.color, g.bg)}>المطلوب منهم</th>,
                   <th key={`${g.key}-e`} style={SH(g.color, g.bg)}>متوقع</th>,
                   <th key={`${g.key}-d`} style={{ ...SH(g.color, g.bg), fontWeight:800 }}>فرق</th>]
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
              {hasExcess && <>
                <th style={{ minWidth:78, background:excessBg, color:excessColor, borderBottom:`2px solid color-mix(in srgb, ${excessColor} 33%, transparent)` }}>وزن زائد</th>
                <th style={{ minWidth:88, background:excessBg, color:excessColor, borderBottom:`2px solid color-mix(in srgb, ${excessColor} 33%, transparent)` }}>رسم زيادة</th>
              </>}
              <th style={{ background:'color-mix(in srgb, var(--accent) 10%, transparent)', color:'var(--purple)', borderBottom:'2px solid color-mix(in srgb, var(--accent) 30%, transparent)', minWidth:90 }}>المطلوب منهم</th>
              <th style={{ background:'color-mix(in srgb, var(--accent) 8%, transparent)', color:'var(--green)', borderBottom:'2px solid color-mix(in srgb, var(--accent) 30%, transparent)', minWidth:90 }}>متوقع</th>
              <th style={{ background:'color-mix(in srgb, var(--red) 8%, transparent)', color:'var(--red)', borderBottom:'2px solid color-mix(in srgb, var(--red) 30%, transparent)', minWidth:80, fontWeight:700 }}>الفرق</th>
              <th style={{ minWidth:90 }}>الحالة</th>
            </tr>
          )}
        </thead>

        <tbody>
          {displayed.map((r, i) => {
            const isMis    = r.status === 'mismatch';
            const iD       = r.invoiced?.delivery ?? r.deliveryCharges ?? 0;
            const iR       = r.invoiced?.rss      ?? r.rss             ?? 0;
            const iF       = r.invoiced?.fuel     ?? r.fuelSurcharge   ?? 0;
            const excess   = hasExcess ? computeExcess(r, contract) : { kg: 0, charge: 0 };
            const rowBg    = isMis ? 'color-mix(in srgb, var(--red) 3%, transparent)' : 'transparent';
            return (
              <tr key={i} style={{ background: rowBg }}>
                <td style={{ color:'var(--muted)', fontFamily:'var(--font-mono)', fontSize:10 }}>{i + 1}</td>
                <td style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--accent)', whiteSpace:'nowrap', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis' }}>
                  {r.awb || '—'}
                </td>
                <td style={{ color:'var(--muted)', fontSize:11, whiteSpace:'nowrap' }}>{r.shipDate || '—'}</td>
                <td style={{ fontSize:12, whiteSpace:'nowrap' }}>
                  {r.domestic && r.destCity
                    ? <>{r.destCity} <span style={{ color:'var(--muted)', fontSize:10 }}>· محلي</span></>
                    : (r.dest || '—')}
                </td>
                {hasServiceType && (
                  <td style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', whiteSpace:'nowrap' }}>
                    {r.serviceType || '—'}
                  </td>
                )}
                <td style={{ fontFamily:'var(--font-mono)', color:'var(--gold)', whiteSpace:'nowrap', fontSize:11 }}>
                  {num(r.weight)} كغ
                </td>
                {hasExcess && <>
                  <td style={{ ...FC(excess.kg > 0 ? excessColor : 'var(--muted)', excessBg), fontWeight: excess.kg > 0 ? 700 : 400 }}>
                    {excess.kg > 0 ? `+${num(excess.kg)}` : '—'}
                  </td>
                  <td style={{ ...FC(excess.charge > 0 ? excessColor : 'var(--muted)', excessBg), fontWeight: excess.charge > 0 ? 700 : 400 }}>
                    {excess.charge > 0 ? num(excess.charge) : '—'}
                  </td>
                </>}

                {showDetail ? (
                  groups.flatMap((g) => {
                    const c = cellsFor(g, r, iD, iR, iF);
                    const isTotal = g.key === 'total';
                    return [
                      <td key={`${g.key}-i`} style={{ ...FC(isTotal && isMis ? 'color-mix(in srgb, var(--red) 90%, transparent)' : 'var(--text)', g.bgL), ...(isTotal ? { fontWeight:600 } : {}) }}>{num(c.inv)}</td>,
                      <td key={`${g.key}-e`} style={{ ...FC('var(--green)', g.bgL), ...(isTotal ? { fontWeight:600 } : {}) }}>{num(c.exp)}</td>,
                      <td key={`${g.key}-d`} style={{ textAlign:'center', background:g.bgL }}><DiffCell value={c.diff}/></td>,
                    ];
                  })
                ) : (
                  (() => {
                    const totalCell = cellsFor(allGroups.total, r, iD, iR, iF);
                    return <>
                      <td style={{ fontFamily:'var(--font-mono)', fontWeight:600, color: isMis ? 'color-mix(in srgb, var(--red) 90%, transparent)' : 'var(--text)' }}>{num(totalCell.inv)}</td>
                      <td style={{ fontFamily:'var(--font-mono)', color:'var(--green)', fontWeight:600 }}>{num(totalCell.exp)}</td>
                      <td><DiffCell value={totalCell.diff}/></td>
                    </>;
                  })()
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
                groups.flatMap((g) => {
                  const t = totalFor(g);
                  const isTotal = g.key === 'total';
                  return [
                    <td key={`ft-${g.key}-i`} style={{ ...FC('var(--text)', g.bgL), fontWeight:isTotal?700:600 }}>{num(t.inv)}</td>,
                    <td key={`ft-${g.key}-e`} style={{ ...FC('var(--green)', g.bgL), fontWeight:isTotal?700:600 }}>{num(t.exp)}</td>,
                    <td key={`ft-${g.key}-d`} style={{ ...FC(diffColor(t.diff), g.bgL), fontWeight:isTotal?800:700, ...(isTotal ? { fontSize:13, whiteSpace:'nowrap' } : {}) }}>
                      {diffText(t.diff)}{isTotal ? ' ر.س' : ''}
                    </td>,
                  ];
                })
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
  const { profile, can } = useAuth();
  const navigate = useNavigate();
  const [filter,     setFilter]     = useState('all');
  const [showAI,     setShowAI]     = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  // Draft audits live in sessionStorage only. They flip to 'approved'
  // (and get persisted) the moment the user clicks اعتماد. Stored
  // audits arrive with reviewStatus already set.
  const initialStatus = audit.isDraft
    ? 'draft'
    : (audit.reviewStatus || 'pending');
  const [reviewStatus, setReviewStatus] = useState(initialStatus);
  const [approving,    setApproving]    = useState(false);
  const [rejecting,    setRejecting]    = useState(false);
  const [rejectModal,  setRejectModal]  = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // Lazy-loaded 'ok' rows. loadAuditByIdFromDB hydrates only the issue
  // rows to keep payloads small for 100K+ audits — but the "الكل" tab
  // needs the rest too. Fetched on demand the first time the user
  // switches to 'all' (or 'ok'). Big audits paginate by raising the
  // limit; 5K is enough for nearly every real-world invoice.
  const [okRows, setOkRows] = useState(null);
  const [okLoading, setOkLoading] = useState(false);
  const { results=[], summary={} } = audit;

  // Keep local state in sync if the page re-mounts with a DIFFERENT audit.
  // Within the same audit, local state changes (approve / reject / reopen)
  // are the source of truth — we must NOT re-derive from audit.isDraft /
  // audit.reviewStatus here, because handleApprove mutates audit.isDraft
  // to false, which would re-run this effect and reset reviewStatus from
  // 'approved' back to 'pending' (since audit.reviewStatus was never
  // re-assigned on the in-memory object).
  useEffect(() => {
    setReviewStatus(audit.isDraft ? 'draft' : (audit.reviewStatus || 'pending'));
    // Reset the lazy-loaded OK rows whenever the audit identity flips.
    setOkRows(null);
    setOkLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit.id]);

  // Lazy-load the OK rows when the user switches to a tab that needs
  // them. For audits with zero issues the hydrated results array is
  // empty (loadAuditByIdFromDB only hydrates issue rows by default),
  // so without this fetch the table on "الكل" would render empty even
  // though summary.total = 109. Drafts (in-memory audits not yet
  // persisted) already have the full results array — no fetch needed.
  useEffect(() => {
    if (audit.isDraft) return;
    if (filter !== 'all' && filter !== 'ok') return;
    if (okRows !== null) return;
    const issueCount = results.filter(r => r.status !== 'ok').length;
    const okExpected = (summary.total || 0) - issueCount;
    if (okExpected <= 0) { setOkRows([]); return; }
    setOkLoading(true);
    loadAuditShipments(audit.id, { status: 'ok', from: 0, limit: 5000 })
      .then(rows => setOkRows(rows || []))
      .catch(err => {
        console.warn('lazy-load ok rows failed:', err.message);
        setOkRows([]);
      })
      .finally(() => setOkLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit.id, filter, audit.isDraft]);

  // results that the ResultsTable should iterate over for the active tab
  const tabResults = useMemo(() => {
    if (audit.isDraft)               return results;
    if (filter === 'ok')             return okRows || [];
    if (filter === 'all' && okRows)  return [...results, ...okRows];
    return results;
  }, [results, okRows, filter, audit.isDraft]);

  // Penny-perfect gate — recomputes on every render so the banner stays
  // in sync if numbers shift (e.g., after a re-analyze).
  const approvalGate = useMemo(() => evaluateApprovalGate(audit), [audit]);

  const handleApprove = async () => {
    // Client-side gate check first — gives a fast, specific error before
    // we round-trip to the server. The server-side approveAudit() will
    // re-verify (defense in depth).
    if (!approvalGate.canApprove) {
      const top = approvalGate.errors[0]?.message || 'تعذّر الاعتماد';
      toast(top, 'error');
      return false;
    }
    let ok = false;          // يُرجَع للمسار الآلي (فواتير-1) ليقرر العودة للوارد
    let ledgerErr = null;    // م4: فشل قيد الدفتر يمنع الترحيل الآلي
    setApproving(true);
    try {
      if (reviewStatus === 'draft' || audit.isDraft) {
        // First-time save: persist as 'pending' (NOT approved). Approving
        // is a separate step that goes through the server-side gate and
        // posts to the ledger. This keeps the audit trail clean.
        await saveAuditToDB(
          { ...audit, reviewStatus: 'pending' },
          profile?.id,
        );
        audit.isDraft = false;
        // Now flip to approved through the gated path so the ledger
        // entry actually gets created.
        const _ap1 = await approveAudit(audit.id, profile?.id);
        // Sync the in-memory audit + sessionStorage so navigating away
        // and back, or any parent re-render, sees the approved state.
        audit.reviewStatus = 'approved';
        audit.approvedAt   = new Date().toISOString();
        try { sessionStorage.setItem('lastAudit', JSON.stringify(audit)); } catch { /* ignore */ }
        setReviewStatus('approved');
        toast('تم حفظ واعتماد المراجعة + قيد في الكشف ✓', 'success');
        if (_ap1?.ledgerPostError) { ledgerErr = _ap1.ledgerPostError; } if (_ap1?.ledgerPostError) toast(`⚠️ اعتُمدت لكن قيد الفاتورة في الدفتر فشل: ${_ap1.ledgerPostError} — راجع /integrity`, 'error');
        if (_ap1?.codExtractError) toast(`⚠️ اعتُمدت لكن استخراج التحصيل فشل: ${_ap1.codExtractError} — راجع /integrity`, 'error');
      } else {
        const _ap2 = await approveAudit(audit.id, profile?.id);
        audit.reviewStatus = 'approved';
        audit.approvedAt   = new Date().toISOString();
        try { sessionStorage.setItem('lastAudit', JSON.stringify(audit)); } catch { /* ignore */ }
        setReviewStatus('approved');
        toast('تم اعتماد المراجعة + قيد في الكشف ✓', 'success');
        if (_ap2?.ledgerPostError) { ledgerErr = _ap2.ledgerPostError; } if (_ap2?.ledgerPostError) toast(`⚠️ اعتُمدت لكن قيد الفاتورة في الدفتر فشل: ${_ap2.ledgerPostError} — راجع /integrity`, 'error');
      }
      // If the audit started life as a Webhook event, close the loop:
      // mark that event as 'processed' + linked. The UI then shows
      // "تمت مراجعتها" instead of the "حفظ كمراجعة" button.
      if (audit.sourceWebhookEventId) {
        try {
          await markEventProcessed(audit.sourceWebhookEventId, audit.id, profile?.id);
          audit.sourceWebhookEventId = null; // don't double-mark on re-approve
        } catch (err) {
          console.warn('webhook event mark-processed failed:', err.message);
        }
      }
      ok = true;
    } catch (e) {
      if (e.code === 'APPROVAL_BLOCKED') {
        const reasons = (e.errors || []).map(x => '• ' + x.message).join('\n') || e.message;
        toast(reasons, 'error');
      } else if (e.code === 'DUPLICATE_AUDIT') {
        toast(e.message, 'error');
      } else {
        toast(`فشل الحفظ: ${e.message}`, 'error');
      }
    }
    setApproving(false);
    return { ok, ledgerErr };
  };

  // ── اعتماد بنقرة (فواتير-1): مسودة موسومة autoApprove ────────────────
  // نفس handleApprove اليدوي حرفياً (بوابة الهللة + النشر + وسم الحدث) —
  // الفرق الوحيد: يشتعل وحده. البوابة فاشلة → يتوقف بسبب واضح ويبقى
  // للمراجعة اليدوية. الحارس module-level (§2.2 StrictMode).
  useEffect(() => {
    if (!audit?.autoApprove || !audit.isDraft || reviewStatus !== 'draft') return;
    if (AUTO_APPROVED_AUDITS.has(audit.id)) return;
    AUTO_APPROVED_AUDITS.add(audit.id);
    // م2 (فحص عدائي): استهلاك العلم دائماً في sessionStorage أيضاً — الحارس
    // الذاكري يُمسح بالـreload فكانت المسودة الموسومة تعيد الاشتعال وحدها.
    audit.autoApprove = false;
    try { sessionStorage.setItem('lastAudit', JSON.stringify(audit)); } catch { /* ignore */ }
    if (!approvalGate.canApprove) {
      const why = approvalGate.errors[0]?.message || 'البوابة رفضت';
      toast(`⛔ لم تُعتمد آلياً: ${why} — تحتاج نظرتك`, 'warn');
      return;
    }
    (async () => {
      const res = await handleApprove();
      if (res?.ok && !res.ledgerErr) {
        // م9: التحذيرات (ضريبة ≤1 ر.س...) كانت تُبتلع آلياً — أظهرها
        const warns = approvalGate.warnings?.length
          ? ` · ⚠ ${approvalGate.warnings[0].message}` : '';
        toast(`⚡ اعتُمدت آلياً — رجوع لصندوق الوارد${warns}`, 'success');
        navigate('/webhook');
      } else if (res?.ok && res.ledgerErr) {
        // م4: اعتماد نجح لكن قيد الدفتر فشل — لا ترحيل؛ ابقَ أمام المشكلة
        toast('⚠️ اعتُمدت لكن قيد الدفتر فشل — لم نغادر الصفحة، راجع /integrity', 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit, reviewStatus, approvalGate]);
  const handleReject = async () => {
    setRejecting(true);
    try {
      if (reviewStatus === 'draft' || audit.isDraft) {
        // Draft rejection = discard without persisting anywhere.
        sessionStorage.removeItem('lastAudit');
        toast('تم تجاهل المراجعة', 'info');
        setRejectModal(false);
        setRejectReason('');
        setRejecting(false);
        navigate('/upload');
        return;
      }
      await rejectAudit(audit.id, rejectReason.trim() || null, profile?.id);
      audit.reviewStatus  = 'rejected';
      audit.rejectedAt    = new Date().toISOString();
      audit.rejectedReason = rejectReason.trim() || null;
      try { sessionStorage.setItem('lastAudit', JSON.stringify(audit)); } catch { /* ignore */ }
      setReviewStatus('rejected');
      setRejectModal(false);
      setRejectReason('');
      toast('تم رفض المراجعة', 'info');
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
    setRejecting(false);
  };
  const handleReopen = async () => {
    setApproving(true);
    try {
      await reopenAudit(audit.id, profile?.id || null);
      audit.reviewStatus = 'pending';
      audit.approvedAt   = null;
      audit.rejectedAt   = null;
      try { sessionStorage.setItem('lastAudit', JSON.stringify(audit)); } catch { /* ignore */ }
      setReviewStatus('pending');
      toast('أُعيدت المراجعة لقائمة الانتظار', 'info');
    } catch (e) { toast(`فشل: ${e.message}`, 'error'); }
    setApproving(false);
  };

  const carrier = carriers.find(c=>c.id===audit.carrierId);
  const contract = carrier ? getActiveContract(carrier, `${audit.year}-${String(audit.month).padStart(2,'0')}-01`) : null;
  const auditControl = audit.control ?? summary.control ?? audit.colMap?.__control ?? null;
  const displayedContractLabel = audit.contractLabel || auditControl?.contractLabels?.join(' / ') || contract?.label || '—';

  const handleExport = () => {
    const ok = exportAuditExcel(results, summary, audit.carrierName, audit.period, contract?.label||'—');
    if (ok) toast('تم تصدير الملف ✓','success');
    else    toast('لا توجد فروق للتصدير','info');
  };

  // Inbound returns → the merchant re-billing file (original outbound AWB
  // included so the internal system can route the cost to the merchant).
  const handleExportInbound = () => {
    const ok = exportInboundReturns(results, audit.carrierName, audit.period);
    if (ok) toast('تم تصدير تقرير الوارد لفوترة التجار ✓','success');
    else    toast('لا توجد شحنات واردة في هذي المراجعة','info');
  };

  const handleExportWeights = () => {
    const ok = exportWeightsForExternalSystem(results, audit.carrierName, audit.period);
    if (ok) toast('تم تصدير ملف الأوزان (AWB + الوزن) ✓','success');
    else    toast('لا توجد شحنات لتصديرها','info');
  };

  // Excess-weight export — only shipments whose chargeable weight exceeds
  // the contract's first-bracket allowance for that destination. The
  // user's external billing system uses this to invoice merchants for
  // the weight that pushed Aramex's charge above the standard rate.
  const handleExportExcessWeights = () => {
    if (!contract) {
      toast('لا يوجد عقد ساري لهذه الفترة', 'error');
      return;
    }
    const result = exportExcessWeights(results, contract, audit.carrierName, audit.period);
    if (result.ok) {
      toast(`تم تصدير ${result.count} شحنة بوزن إضافي ✓`, 'success');
    } else if (result.reason === 'empty') {
      toast('لا توجد شحنات تجاوزت الوزن المسموح', 'info');
    } else if (result.reason === 'no_contract') {
      toast('لا يوجد عقد ساري لهذه الفترة', 'error');
    }
  };

  // إنشاء مطالبة استرداد من الفروق «لصالحك» — يُغلق دورة «الاكتشاف→الاسترداد»
  // (كان السجل يبقى فارغاً رغم فروقات معروفة). يعبّئ الناقل/الفترة/المبلغ آلياً.
  const [claiming, setClaiming] = useState(false);
  const overbill = +(Number(summary.totalDiff) || 0).toFixed(2);   // موجب = فوترة زائدة
  const handleCreateClaim = async () => {
    if (overbill <= 1) { toast('لا فروق لصالحك تستحق مطالبة', 'info'); return; }
    if (!window.confirm(`إنشاء مطالبة استرداد على ${audit.carrierName} بمبلغ ${overbill.toFixed(2)} ر.س (${audit.period})؟`)) return;
    setClaiming(true);
    try {
      await createClaim({
        carrierId: audit.carrierId, source: 'audit',
        reference: audit.period || audit.id,
        title: `فروق تدقيق ${audit.carrierName} — ${audit.period || ''}`.trim(),
        amount: overbill,
        notes: `من مراجعة ${audit.id}: ${summary.mismatch} فرق، إجمالي لصالحك ${overbill.toFixed(2)} ر.س`,
        userId: profile?.id || null,
      });
      toast('أُنشئت المطالبة ✓ — تابعها في مركز الناقلين ← المطالبات', 'success');
    } catch (e) { toast(`تعذّر إنشاء المطالبة: ${e.message}`, 'error'); }
    setClaiming(false);
  };

  return (
    <div style={{display:'grid',gridTemplateColumns:showAI?'1fr 360px':'1fr',height:'100%',overflow:'hidden'}}>

      {/* Main */}
      <div className="ar-panel-pad" style={{overflowY:'auto',padding:'20px 24px'}}>

        {/* ── Review status banner ─────────────────────────────────── */}
        {(reviewStatus === 'draft' || reviewStatus === 'pending') && (
          <div style={{
            marginBottom: 16, padding: '14px 18px', borderRadius: 12,
            background: approvalGate.canApprove
              ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), color-mix(in srgb, var(--accent) 2%, transparent))'
              : 'linear-gradient(135deg, rgba(239,68,68,.10), rgba(239,68,68,.02))',
            border: `1px solid ${approvalGate.canApprove ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'rgba(239,68,68,.40)'}`,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: approvalGate.canApprove ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'rgba(239,68,68,.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {approvalGate.canApprove
                  ? <CheckCircle2 size={18} color="var(--accent)"/>
                  : <AlertCircle  size={18} color="var(--red)"/>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13.5 }}>
                  {approvalGate.canApprove
                    ? (reviewStatus === 'draft' ? 'جاهزة للاعتماد — لم تُحفظ بعد' : 'جاهزة للاعتماد')
                    : `الاعتماد مقفل — ${approvalGate.errors.length} ${approvalGate.errors.length === 1 ? 'سبب' : 'أسباب'}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {approvalGate.canApprove
                    ? <>الأرقام مطابقة بالهلله — اضغط <strong>اعتماد</strong> ليُسجَّل قيد في كشف حساب الشركة.</>
                    : <>راجع الأسباب أدناه، عدّل المراجعة أو ناقش الشركة، ثم أعد المحاولة.</>}
                </div>
              </div>
              {can('audits.approve') && (
                <Btn
                  size="md"
                  variant={approvalGate.canApprove ? 'accent' : 'ghost'}
                  onClick={handleApprove}
                  disabled={approving || !approvalGate.canApprove}
                  icon={<CheckCircle2 size={14}/>}
                  title={!approvalGate.canApprove ? approvalGate.errors.map(e => e.message).join(' / ') : ''}
                >
                  {approving ? <Spinner size={13}/> : 'اعتماد المراجعة'}
                </Btn>
              )}
              {can('audits.reject') && (
                <Btn size="md" variant="ghost" onClick={() => setRejectModal(true)} disabled={rejecting} icon={<XCircle size={14}/>}>
                  {reviewStatus === 'draft' ? 'تجاهل' : 'رفض'}
                </Btn>
              )}
              {!can('audits.approve') && !can('audits.reject') && (
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', padding: '8px 12px' }}>
                  ⓘ لا تملك صلاحية الاعتماد/الرفض
                </div>
              )}
            </div>

            {/* Gate violation list — shown only when approval is blocked */}
            {!approvalGate.canApprove && approvalGate.errors.length > 0 && (
              <div style={{
                padding: '10px 14px',
                background: 'rgba(239,68,68,.06)',
                border: '1px solid rgba(239,68,68,.20)',
                borderRadius: 9,
                display: 'grid', gap: 6,
              }}>
                {approvalGate.errors.map((e, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12 }}>
                    <span style={{ color: 'var(--red)', fontWeight: 700, marginTop: 1 }}>✗</span>
                    <span style={{ color: 'var(--text)' }}>{e.message}</span>
                  </div>
                ))}
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  حد التسامح: ±{APPROVAL_DRIFT_TOLERANCE_PRE_TAX.toFixed(2)} ر.س قبل الضريبة · ±{APPROVAL_DRIFT_TOLERANCE_TAX.toFixed(2)} ر.س للضريبة
                </div>
              </div>
            )}

            {/* Soft warnings (don't block, just FYI) */}
            {approvalGate.warnings?.length > 0 && (
              <div style={{
                padding: '8px 12px',
                background: 'color-mix(in srgb, var(--gold) 6%, transparent)',
                border: '1px solid color-mix(in srgb, var(--gold) 22%, transparent)',
                borderRadius: 8,
                fontSize: 11.5, color: 'var(--muted)',
              }}>
                {approvalGate.warnings.map((w, i) => <div key={i}>⚠ {w.message}</div>)}
              </div>
            )}
          </div>
        )}
        {reviewStatus === 'approved' && (
          <div style={{
            marginBottom: 16, padding: '10px 16px', borderRadius: 11,
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <CheckCircle2 size={18} color="var(--accent)"/>
            <div style={{ flex: 1, fontSize: 12.5 }}>
              <strong style={{ color: 'var(--accent)' }}>مراجعة معتمدة</strong>
              <span style={{ color: 'var(--muted)', marginInlineStart: 8 }}>
                مؤهَّلة لفوترة الأوزان وربط الدفعات
              </span>
            </div>
            {can('audits.reopen') && (
              <Btn size="sm" variant="ghost" onClick={handleReopen} disabled={approving} icon={<RotateCcw size={12}/>}>
                إعادة فتح
              </Btn>
            )}
          </div>
        )}
        {reviewStatus === 'rejected' && (
          <div style={{
            marginBottom: 16, padding: '10px 16px', borderRadius: 11,
            background: 'color-mix(in srgb, var(--red) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--red) 32%, transparent)',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <XCircle size={18} color="var(--red)"/>
            <div style={{ flex: 1, fontSize: 12.5 }}>
              <strong style={{ color: 'var(--red)' }}>مراجعة مرفوضة</strong>
              {audit.rejectedReason && (
                <span style={{ color: 'var(--muted)', marginInlineStart: 8 }}>
                  · {audit.rejectedReason}
                </span>
              )}
            </div>
            {can('audits.reopen') && (
              <Btn size="sm" variant="ghost" onClick={handleReopen} disabled={approving} icon={<RotateCcw size={12}/>}>
                إعادة فتح
              </Btn>
            )}
          </div>
        )}

        {/* Header */}
        <PageHeader
          icon={<ClipboardCheck size={22}/>}
          title={<>نتائج تدقيق <span style={{color:'var(--accent3)'}}>{audit.carrierName}</span></>}
          subtitle={`${audit.period} · ${displayedContractLabel} · ${summary.total || results.length} شحنة${audit.fileName ? ` · ${audit.fileName}` : ''}`}
          actions={<>
            <Btn size="sm" variant="ghost" onClick={onNewAudit}>+ مراجعة جديدة</Btn>
            <Btn size="sm" variant={showDetail?'outline':'ghost'} onClick={()=>setShowDetail(s=>!s)}>
              {showDetail ? '📊 ملخص' : '🔬 تفاصيل'}
            </Btn>
            {summary.mismatch>0 && (
              <Btn size="sm" variant="accent" onClick={handleExport} icon="⬇️">
                تصدير الفروق ({summary.mismatch})
              </Btn>
            )}
            {overbill > 1 && (can('audits.approve') || can('carriers.view')) && (
              <Btn size="sm" variant="gold" onClick={handleCreateClaim} disabled={claiming} icon="⚖️">
                {claiming ? 'يُنشئ…' : `أنشئ مطالبة (${overbill.toFixed(0)} ر.س)`}
              </Btn>
            )}
            {summary.inbound>0 && (
              <Btn size="sm" variant="gold" onClick={handleExportInbound} icon="🛬">
                وارد لفوترة التجار ({summary.inbound})
              </Btn>
            )}
            <Btn size="sm" variant="outline" onClick={handleExportWeights} icon="⚖️">
              تصدير الأوزان
            </Btn>
            <Btn size="sm" variant="gold" onClick={handleExportExcessWeights} icon="📦">
              أوزان إضافية فقط
            </Btn>
            <Btn size="sm" variant={showAI?'primary':'gold'} onClick={()=>setShowAI(s=>!s)} icon="✨">
              {showAI?'إخفاء AI':'مساعد AI'}
            </Btn>
          </>}
        />

        {auditControl && (
          <div style={{
            marginBottom: 16, padding: '12px 16px', borderRadius: 11,
            border: `1px solid ${auditControl.valid === false ? 'rgba(239,68,68,.35)' : 'rgba(16,185,129,.30)'}`,
            background: auditControl.valid === false ? 'rgba(239,68,68,.05)' : 'rgba(16,185,129,.05)',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>مصدر التفاصيل</div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{auditControl.fileName || audit.fileName || '—'}{auditControl.detailSheet ? ` · ${auditControl.detailSheet}` : ''}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>العقد المستخدم</div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{displayedContractLabel}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>الرقابة على إجمالي الشركة</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: auditControl.valid === false ? 'var(--red)' : 'var(--green)' }}>
                {auditControl.declared
                  ? (auditControl.valid === false ? 'غير مطابق — الاعتماد متوقف' : `مطابق مع ${auditControl.declared.sheetName || 'الملخص'}`)
                  : 'لا توجد ورقة ملخص مستقلة'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>صفوف المصدر والمدققة</div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                {Number(auditControl.sourceRowCount || 0).toLocaleString('en-US')} مصدر ·{' '}
                {Number(auditControl.auditedRowCount || 0).toLocaleString('en-US')} مدققة
                {Number(auditControl.excludedRowCount || 0) > 0
                  ? ` · ${Number(auditControl.excludedRowCount).toLocaleString('en-US')} مستبعدة` : ''}
              </div>
            </div>
          </div>
        )}

        {!auditControl && (
          <div style={{
            marginBottom: 16, padding: '12px 16px', borderRadius: 11,
            border: '1px solid color-mix(in srgb, var(--gold) 45%, transparent)',
            background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
            color: 'var(--text)', fontSize: 12.5, lineHeight: 1.7,
          }}>
            <strong style={{ color: 'var(--gold)' }}>مراجعة تاريخية غير موثقة عقديًا.</strong>{' '}
            لا يوجد معها اسم ملف وعقد وملخص رقابي وبصمة مصدر حديثة؛ أعد رفع الملف قبل الاعتماد أو الربط المالي.
          </div>
        )}

        {/* Stats */}
        <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
          <StatCard label="إجمالي" value={summary.total} color="var(--accent)" onClick={()=>setFilter('all')}/>
          <StatCard label="✓ مطابقة" value={summary.ok} color="var(--green)" onClick={()=>setFilter('ok')}/>
          <StatCard label="✗ فروق" value={summary.mismatch} color="var(--red)" onClick={()=>setFilter('mismatch')}/>
          {summary.favorable > 0 && (
            <StatCard label="↓ لصالحك" value={summary.favorable} color="var(--accent)" onClick={()=>setFilter('favorable')}/>
          )}
          {summary.inbound > 0 && (
            <StatCard label="🛬 وارد (مرتجع)" value={summary.inbound} color="var(--gold, #D97706)" onClick={()=>setFilter('inbound')}/>
          )}
          <StatCard label="؟ غير معروف" value={summary.unknown} color="var(--muted)" onClick={()=>setFilter('unknown')}/>
          <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:11,padding:'13px 18px',
            borderTop:`3px solid ${summary.totalDiff>0?'var(--red)':'var(--green)'}`}}>
            <div style={{color:'var(--muted)',fontSize:10,fontFamily:'var(--font-mono)',marginBottom:3}}>إجمالي الفرق</div>
            <div style={{color:summary.totalDiff>0?'var(--red)':'var(--green)',fontSize:20,fontFamily:'var(--font-mono)',fontWeight:700}}>
              {summary.totalDiff>=0?'+':''}{summary.totalDiff?.toFixed(2)} ر.س
            </div>
          </div>
        </div>

        {/* ── Invoice reconciliation panel ─────────────────────────────
            Shows the exact pre-VAT / VAT / gross numbers so the user
            can match against the carrier's invoice line directly. */}
        <div style={{
          marginBottom: 16,
          padding: '16px 20px',
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), rgba(27,30,84,.04))',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
            مطابقة مع كشف شركة الشحن
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 14,
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>المطلوب منهم (حسب فاتورتهم)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                {Number(summary.totalBilled || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>قبل الضريبة</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>الصحيح حسب العقد</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>
                {Number(summary.totalExpected || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>قبل الضريبة</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>الضريبة (15%)</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--gold)' }}>
                {Number(summary.totalTax || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ر.س</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>على إجمالي الفاتورة</div>
            </div>
            <div style={{
              padding: '12px 14px',
              background: 'linear-gradient(135deg, var(--brand-navy), var(--brand-navy-2))',
              borderRadius: 10,
              color: '#fff',
            }}>
              <div style={{ fontSize: 11, opacity: .8, marginBottom: 4 }}>الإجمالي مع الضريبة</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 800, color: '#fff' }}>
                {Number(summary.totalGross || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 12, opacity: .7 }}>ر.س</span>
              </div>
              <div style={{ fontSize: 10, opacity: .75, marginTop: 2 }}>طابقه مع كشف الشركة</div>
            </div>
          </div>
          {summary.taxRoundingAdjustment && summary.taxRoundingAdjustment !== 0 ? (
            <div style={{
              marginTop: 12, padding: '8px 12px',
              background: 'color-mix(in srgb, var(--gold) 6%, transparent)',
              border: '1px solid color-mix(in srgb, var(--gold) 20%, transparent)',
              borderRadius: 8, fontSize: 11.5, color: 'var(--gold)',
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              ⚠ تسوية تقريب ضريبي ضمن الإجمالي: {Number(summary.taxRoundingAdjustment).toFixed(2)} ر.س
            </div>
          ) : null}
        </div>

        {/* Column mapping used — lets user verify correctness */}
        {audit.colMap && (
          <ColMapBadges colMap={audit.colMap}/>
        )}

        {/* Filters */}
        <div style={{display:'flex',gap:7,marginBottom:14,flexWrap:'wrap',rowGap:7}}>
          {[
            { k:'all',       l:`الكل (${summary.total})` },
            { k:'mismatch',  l:`✗ فروق (${summary.mismatch})` },
            { k:'ok',        l:`✓ مطابق (${summary.ok})` },
            ...(summary.favorable > 0 ? [{ k:'favorable', l:`↓ لصالحك (${summary.favorable})` }] : []),
            ...(summary.inbound > 0 ? [{ k:'inbound', l:`🛬 وارد (${summary.inbound})` }] : []),
            { k:'unknown',   l:`؟ (${summary.unknown})` },
          ].map(t=>(
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
          {okLoading && (filter === 'all' || filter === 'ok') ? (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', padding:48, gap:10 }}>
              <Spinner size={20}/>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>جارٍ تحميل الشحنات المطابقة…</span>
            </div>
          ) : (
            <ResultsTable results={tabResults} filter={filter} showDetail={showDetail} contract={contract}/>
          )}
        </Card>
      </div>

      {/* AI sidebar */}
      {showAI && (
        <div style={{borderRight:'1px solid var(--border)',background:'var(--card)',display:'flex',flexDirection:'column',height:'100%'}}>
          <AIPanel audit={audit} carriers={carriers}/>
        </div>
      )}

      {rejectModal && (
        <Modal title="رفض المراجعة" onClose={() => setRejectModal(false)}>
          <p style={{ color: 'var(--muted)', marginBottom: 14, fontSize: 13, lineHeight: 1.7 }}>
            المراجعة راح تُحفظ في السجل لكن ما تدخل في تدفق فوترة الأوزان والمدفوعات. تقدر تعيد فتحها لاحقاً.
          </p>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
            السبب (اختياري)
          </label>
          <input
            type="text"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="مثلاً: الملف خطأ، شركة ثانية، تكرار..."
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setRejectModal(false)}>إلغاء</Btn>
            <Btn variant="danger" onClick={handleReject} disabled={rejecting}>
              {rejecting ? <Spinner size={12}/> : 'تأكيد الرفض'}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
