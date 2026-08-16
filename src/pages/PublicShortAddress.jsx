import { useCallback, useMemo, useState } from 'react';
import { Check, Copy, LocateFixed, MapPin, Search, Share2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import './PublicShortAddress.css';

const shortcodeOf=d=>d?.shortcode||d?.short_address||d?.address?.shortcode||null;
const addressOf=d=>d?.address_ar||d?.display_name||d?.formatted_address||d?.national_address||[d?.building_no,d?.street,d?.district,d?.city,d?.postal_code].filter(Boolean).join('، ');
const cleanAddress=value=>String(value||'').replace(/,\s*/g,'، ').trim();
const messageOf=data=>{const lines=[],shortcode=shortcodeOf(data),address=cleanAddress(addressOf(data));if(shortcode)lines.push(`العنوان المختصر: ${shortcode}`);if(address&&address!==shortcode)lines.push(`العنوان التفصيلي: ${address}`);return lines.join('\n');};

export default function PublicShortAddress(){
  const [mode,setMode]=useState('location');
  const [shortcode,setShortcode]=useState('');
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);

  const call=useCallback(async(action,body={})=>{setBusy(true);setError('');setResult(null);try{const response=await fetch(`${supabase.supabaseUrl}/functions/v1/hudhud-short-address`,{method:'POST',headers:{apikey:supabase.supabaseKey,Authorization:`Bearer ${supabase.supabaseKey}`,'Content-Type':'application/json','x-region':'eu-central-1'},body:JSON.stringify({action,...body,website:''})});const data=await response.json().catch(()=>null);if(!response.ok||!data?.ok)throw Error(data?.error||'تعذر تنفيذ الطلب.');setResult(data.data);return data.data;}catch(e){setError(e?.message||'تعذر الوصول إلى هدهد.');return null;}finally{setBusy(false);}},[]);

  const switchMode=next=>{setMode(next);setResult(null);setError('');setCopied(false);};
  const locate=()=>{if(!navigator.geolocation){setError('متصفحك لا يدعم تحديد الموقع.');return;}setBusy(true);setError('');navigator.geolocation.getCurrentPosition(({coords})=>call('reverse',{lat:coords.latitude,lon:coords.longitude}),()=>{setBusy(false);setError('اسمح للموقع بالوصول إلى موقعك ثم حاول مرة أخرى.');},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});};
  const lookup=async e=>{e.preventDefault();await call('shortcode',{shortcode});};
  const message=useMemo(()=>messageOf(result),[result]);
  const copy=async()=>{if(!message)return;await navigator.clipboard.writeText(message);setCopied(true);setTimeout(()=>setCopied(false),1600);};
  const share=async()=>{if(!message)return;if(navigator.share)await navigator.share({title:'مشاركة عنوان',text:message});else copy();};
  const address=cleanAddress(addressOf(result));
  const resultShortcode=shortcodeOf(result);

  return <main className="address-page" dir="rtl">
    <header className="address-header"><LamhaLogo/></header>
    <section className="address-card">
      <div className="address-intro"><span><MapPin size={24}/></span><h1>العنوان المختصر</h1><p>احصل على عنوانك، أو أدخل عنوانًا مختصرًا لمعرفة تفاصيله.</p></div>
      <div className="address-tabs" role="tablist" aria-label="طريقة البحث">
        <button role="tab" aria-selected={mode==='location'} className={mode==='location'?'active':''} onClick={()=>switchMode('location')}><LocateFixed size={19}/> استخدم موقعي</button>
        <button role="tab" aria-selected={mode==='shortcode'} className={mode==='shortcode'?'active':''} onClick={()=>switchMode('shortcode')}><Search size={19}/> أدخل عنوانًا مختصرًا</button>
      </div>

      {mode==='location'?<section className="address-action"><h2>حدد موقعك الحالي</h2><p>سنستخدم موقعك مرة واحدة لجلب عنوانك من هدهد، ولن نحفظه.</p><button className="address-primary" onClick={locate} disabled={busy}><LocateFixed size={20}/>{busy?'جاري تحديد العنوان…':'استخدم موقعي الحالي'}</button></section>:
      <form className="address-action" onSubmit={lookup}><h2>أدخل العنوان المختصر</h2><p>يتكون من أربعة أحرف وأربعة أرقام.</p><label><span>العنوان المختصر</span><input dir="ltr" inputMode="text" autoCapitalize="characters" maxLength={8} value={shortcode} onChange={e=>setShortcode(e.target.value.replace(/\s/g,'').toUpperCase())} placeholder="MKGA2655"/></label><button className="address-primary" disabled={busy||shortcode.length!==8}><Search size={20}/>{busy?'جاري البحث…':'عرض تفاصيل العنوان'}</button></form>}

      {error&&<div className="address-error" role="alert">{error}</div>}
      {result&&<section className="address-result" aria-live="polite">
        <div className="address-result-title"><span><MapPin size={21}/></span><div><small>نتيجة هدهد</small><h2>{resultShortcode||'تم العثور على العنوان'}</h2></div></div>
        {resultShortcode&&<div className="address-shortcode"><span>العنوان المختصر</span><strong>{resultShortcode}</strong></div>}
        {address&&<div className="address-detail"><span>العنوان التفصيلي</span><p>{address}</p></div>}
        {mode==='location'&&!resultShortcode&&<p className="address-note">هدهد أعاد العنوان التفصيلي لهذا الموقع، لكنه لم يُرجع عنوانًا مختصرًا.</p>}
        <div className="address-actions"><button onClick={copy}>{copied?<Check size={18}/>:<Copy size={18}/>} {copied?'تم النسخ':'نسخ'}</button><button onClick={share}><Share2 size={18}/> مشاركة</button></div>
      </section>}
    </section>
    <footer>مدعوم بخدمات هدهد داخل المملكة العربية السعودية · لا يتطلب تسجيل دخول</footer>
  </main>;
}
