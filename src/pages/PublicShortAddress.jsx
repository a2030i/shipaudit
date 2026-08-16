import { useCallback, useMemo, useState } from 'react';
import { Check, Copy, LocateFixed, MapPin, Search, Share2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import './PublicShortAddress.css';

const shortcodeOf=d=>d?.shortcode||d?.short_address||d?.address?.shortcode||null;
const addressOf=d=>d?.address_ar||d?.display_name||d?.formatted_address||d?.national_address||[d?.building_no,d?.street,d?.district,d?.city,d?.postal_code].filter(Boolean).join('، ');
const cleanAddress=value=>String(value||'').replace(/,\s*/g,'، ').trim();
const locationTypeLabel={residential:'طريق سكني',road:'طريق',house:'مبنى',building:'مبنى',commercial:'موقع تجاري',administrative:'موقع إداري'};
const addressDetailsOf=data=>{
  if(!data)return [];
  const nested=data.address&&typeof data.address==='object'?data.address:{};
  const segments=cleanAddress(addressOf(data)).split('،').map(item=>item.trim()).filter(Boolean);
  if(!shortcodeOf(data)&&Object.keys(nested).length){
    const region=segments.find(item=>/^منطقة\s/.test(item));
    const province=nested.province&&nested.province!==nested.city?nested.province:null;
    return [
      {key:'road',label:'الشارع أو الطريق',value:nested.road||data.name,wide:true},
      {key:'neighbourhood',label:'الحي',value:nested.neighbourhood},
      {key:'suburb',label:'الضاحية أو الموقع المحلي',value:nested.suburb},
      {key:'city',label:'المدينة',value:nested.city},
      {key:'municipality',label:'البلدية',value:nested.municipality},
      {key:'province',label:'المحافظة',value:province},
      {key:'region',label:'المنطقة',value:region},
      {key:'postalCode',label:'الرمز البريدي',value:nested.postcode,ltr:true},
      {key:'country',label:'الدولة',value:nested.country},
      {key:'type',label:'نوع الموقع',value:locationTypeLabel[data.type]||data.type},
      {key:'fullAddress',label:'العنوان الكامل',value:cleanAddress(data.display_name),wide:true}
    ].filter(detail=>detail.value);
  }
  const postalIndex=segments.findIndex((item,index)=>index>0&&/^\d{5}$/.test(item));
  const middle=postalIndex>0?segments.slice(1,postalIndex):[];
  const geo=data.geocoding||{};
  const geoAddress=geo.address&&typeof geo.address==='object'?geo.address:{};
  const geoSegments=cleanAddress(geo.display_name).split('،').map(item=>item.trim()).filter(Boolean);
  const province=geoAddress.province||geoAddress.municipality;
  const region=geoSegments.find(item=>/^منطقة\s/.test(item))||geoAddress.region||geoAddress.state;
  const locality=geoSegments.find((item,index)=>index>0&&item!==province&&item!==region&&!/^السعودية|المملكة العربية السعودية$/.test(item));
  const fallback=postalIndex>0?{
    building:segments[0],
    street:middle[0],
    district:middle.length>1?middle.slice(1).join('، '):undefined,
    postalCode:segments[postalIndex],
    city:segments.slice(postalIndex+1).join('، ')
  }:{};
  const value=(...items)=>items.find(item=>item!==undefined&&item!==null&&String(item).trim()!=='');
  return [
    {key:'shortcode',label:'العنوان المختصر',value:shortcodeOf(data),ltr:true},
    {key:'building',label:'رقم المبنى',value:value(data.building_no,data.building_number,nested.building_no,nested.building_number,fallback.building)},
    {key:'street',label:'الشارع',value:value(data.street,data.road,nested.street,nested.road,fallback.street),wide:true},
    {key:'district',label:'الحي',value:value(data.district,data.neighbourhood,data.suburb,nested.district,nested.neighbourhood,nested.suburb,fallback.district)},
    {key:'city',label:'المدينة أو البلدة',value:value(data.city,nested.city,fallback.city)},
    {key:'locality',label:'المركز أو الموقع المحلي',value:locality},
    {key:'province',label:'المحافظة',value:province},
    {key:'postalCode',label:'الرمز البريدي',value:value(data.postal_code,data.postcode,nested.postal_code,nested.postcode,fallback.postalCode),ltr:true},
    {key:'region',label:'المنطقة',value:value(data.region,data.state,nested.region,nested.state,region)}
  ].filter(detail=>detail.value);
};
const messageOf=data=>addressDetailsOf(data).map(({label,value})=>`${label}: ${value}`).join('\n');

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
  const addressDetails=useMemo(()=>addressDetailsOf(result),[result]);

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
        <div className="address-result-title"><span><MapPin size={21}/></span><div><small>نتيجة هدهد</small><h2>{mode==='location'?'تفاصيل الموقع':'تفاصيل العنوان'}</h2></div></div>
        {addressDetails.length>0&&<div className="address-fields">{addressDetails.map(detail=><div className={`address-field${detail.wide?' wide':''}`} key={detail.key}><span>{detail.label}</span><strong dir={detail.ltr?'ltr':undefined}>{detail.value}</strong></div>)}</div>}
        {!addressDetails.length&&address&&<div className="address-detail"><span>العنوان التفصيلي</span><p>{address}</p></div>}
        {mode==='location'&&!resultShortcode&&<p className="address-note">هدهد أعاد العنوان التفصيلي لهذا الموقع، لكنه لم يُرجع عنوانًا مختصرًا.</p>}
        <div className="address-actions"><button onClick={copy}>{copied?<Check size={18}/>:<Copy size={18}/>} {copied?'تم النسخ':'نسخ'}</button><button onClick={share}><Share2 size={18}/> مشاركة</button></div>
      </section>}
    </section>
    <footer>مدعوم بخدمات هدهد داخل المملكة العربية السعودية · لا يتطلب تسجيل دخول</footer>
  </main>;
}
