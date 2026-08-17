import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
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
const distanceMeters=(a,b)=>{if(!a||!b)return null;const r=6371000,toRad=n=>n*Math.PI/180,dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon),x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;return Math.round(2*r*Math.asin(Math.sqrt(x)));};
const resultPoint=data=>{const source=data?.location||data;const lat=Number(source?.lat),lon=Number(source?.lon);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;};
const EXPECTED={location:[['road','الشارع أو الطريق'],['neighbourhood','الحي'],['city','المدينة'],['region','المنطقة'],['postalCode','الرمز البريدي'],['shortcode','العنوان المختصر']],shortcode:[['building','رقم المبنى'],['street','الشارع'],['district','الحي'],['city','المدينة'],['region','المنطقة'],['postalCode','الرمز البريدي']]};
const HudhudAddressMap=lazy(()=>import('../components/HudhudAddressMap.jsx'));
const rawLabels={shortcode:'العنوان المختصر',address_ar:'العنوان بالعربية',address_en:'العنوان بالإنجليزية',lat:'خط العرض',lon:'خط الطول',name:'اسم الموقع',display_name:'العنوان الكامل',place_id:'معرّف المكان',place_rank:'ترتيب المكان',importance:'درجة الأهمية',category:'التصنيف العام',type:'نوع الموقع',addresstype:'نوع العنوان',boundingbox:'حدود الموقع',road:'الشارع',neighbourhood:'الحي',suburb:'الضاحية',city:'المدينة',municipality:'البلدية',province:'المحافظة',postcode:'الرمز البريدي',country:'الدولة',country_code:'رمز الدولة',location:'الموقع',geocoding:'بيانات تحديد الموقع'};
const rawDetailsOf=(value,path=[],result=[])=>{if(value===undefined||value===null||value==='')return result;if(Array.isArray(value)){result.push({key:path.join('.'),label:rawLabels[path.at(-1)]||path.at(-1),value:value.join('، ')});return result;}if(typeof value==='object'){for(const [key,nested] of Object.entries(value))rawDetailsOf(nested,[...path,key],result);return result;}result.push({key:path.join('.'),label:rawLabels[path.at(-1)]||path.at(-1),value:String(value)});return result;};

export default function PublicShortAddress(){
  const [mode,setMode]=useState('location');
  const [shortcode,setShortcode]=useState('');
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
  const [accuracy,setAccuracy]=useState(null);
  const [deviceLocation,setDeviceLocation]=useState(null);
  const requestRef=useRef(null);

  const call=useCallback(async(action,body={})=>{requestRef.current?.abort();const controller=new AbortController();requestRef.current=controller;setBusy(true);setError('');setResult(null);try{const response=await fetch(`${supabase.supabaseUrl}/functions/v1/hudhud-short-address`,{method:'POST',headers:{apikey:supabase.supabaseKey,Authorization:`Bearer ${supabase.supabaseKey}`,'Content-Type':'application/json','x-region':'eu-central-1'},body:JSON.stringify({action,...body,website:''}),signal:controller.signal});const data=await response.json().catch(()=>null);if(!response.ok||!data?.ok)throw Error(data?.error||'تعذر تنفيذ الطلب.');setResult(data.data);return data.data;}catch(e){if(e?.name!=='AbortError')setError(e?.message||'تعذر الوصول إلى هدهد.');return null;}finally{if(requestRef.current===controller){requestRef.current=null;setBusy(false);}}},[]);

  const switchMode=next=>{setMode(next);setResult(null);setError('');setCopied(false);};
  const locate=()=>{if(!navigator.geolocation){setError('متصفحك لا يدعم تحديد الموقع.');return;}requestRef.current?.abort();setBusy(true);setError('');navigator.geolocation.getCurrentPosition(({coords})=>{const point={lat:coords.latitude,lon:coords.longitude};setAccuracy(Math.round(coords.accuracy));setDeviceLocation(point);call('reverse',point);},()=>{setBusy(false);setError('اسمح للموقع بالوصول إلى موقعك ثم حاول مرة أخرى.');},{enableHighAccuracy:true,timeout:15000,maximumAge:0});};
  const lookup=async e=>{e.preventDefault();await call('shortcode',{shortcode});};
  const message=useMemo(()=>messageOf(result),[result]);
  const copy=async()=>{if(!message)return;await navigator.clipboard.writeText(message);setCopied(true);setTimeout(()=>setCopied(false),1600);};
  const share=async()=>{if(!message)return;if(navigator.share)await navigator.share({title:'مشاركة عنوان',text:message});else copy();};
  const address=cleanAddress(addressOf(result));
  const resultShortcode=shortcodeOf(result);
  const addressDetails=useMemo(()=>addressDetailsOf(result),[result]);
  const missing=useMemo(()=>{const keys=new Set(addressDetails.map(item=>item.key));return EXPECTED[mode].filter(([key])=>!keys.has(key)).map(([,label])=>label);},[addressDetails,mode]);
  const distance=useMemo(()=>distanceMeters(deviceLocation,resultPoint(result)),[deviceLocation,result]);
  const accuracyLabel=accuracy==null?'':accuracy<=25?'دقة عالية':accuracy<=100?'دقة متوسطة':'موقع تقريبي';
  const copyText=async(text)=>{if(!text)return;await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),1600);};
  const detailsText=addressDetails.filter(item=>!['shortcode','fullAddress'].includes(item.key)).map(({label,value})=>`${label}: ${value}`).join('\n');
  const fullAddress=addressDetails.find(item=>item.key==='fullAddress')?.value||address;
  const rawDetails=useMemo(()=>rawDetailsOf(result),[result]);
  const mapPoint=resultPoint(result)||deviceLocation;
  const pickOnMap=useCallback(point=>{setDeviceLocation(point);setAccuracy(null);call('reverse',point);},[call]);

  return <main className="address-page" dir="rtl">
    <header className="address-header"><LamhaLogo/></header>
    <section className="address-card">
      <div className="address-intro"><span><MapPin size={24}/></span><h1>العنوان المختصر</h1><p>احصل على عنوانك، أو أدخل عنوانًا مختصرًا لمعرفة تفاصيله.</p></div>
      <div className="address-tabs" role="tablist" aria-label="طريقة البحث">
        <button role="tab" aria-selected={mode==='location'} className={mode==='location'?'active':''} onClick={()=>switchMode('location')}><LocateFixed size={19}/> استخدم موقعي</button>
        <button role="tab" aria-selected={mode==='shortcode'} className={mode==='shortcode'?'active':''} onClick={()=>switchMode('shortcode')}><Search size={19}/> أدخل عنوانًا مختصرًا</button>
      </div>

      <Suspense fallback={<div className="hudhud-map-loading">جاري تحميل الخريطة…</div>}><HudhudAddressMap point={mapPoint} onPick={pickOnMap}/></Suspense>

      {mode==='location'?<section className="address-action"><h2>حدد موقعك الحالي</h2><p>سنستخدم موقعك مرة واحدة لجلب عنوانك من هدهد، ولن نحفظه.</p><button className="address-primary" onClick={locate} disabled={busy}><LocateFixed size={20}/>{busy?'جاري تحديد العنوان…':'استخدم موقعي الحالي'}</button></section>:
      <form className="address-action" onSubmit={lookup}><h2>أدخل العنوان المختصر</h2><p>يتكون من أربعة أحرف وأربعة أرقام.</p><label><span>العنوان المختصر</span><input dir="ltr" inputMode="text" autoCapitalize="characters" maxLength={8} value={shortcode} onChange={e=>setShortcode(e.target.value.replace(/\s/g,'').toUpperCase())} placeholder="MKGA2655"/></label><button className="address-primary" disabled={busy||shortcode.length!==8}><Search size={20}/>{busy?'جاري البحث…':'عرض تفاصيل العنوان'}</button></form>}

      {error&&<div className="address-error" role="alert">{error}</div>}
      {result&&<section className="address-result" aria-live="polite">
        <div className="address-result-title"><span><MapPin size={21}/></span><div><small>نتيجة هدهد</small><h2>{mode==='location'?'تفاصيل الموقع':'تفاصيل العنوان'}</h2></div></div>
        <div className="address-meta"><span>{resultShortcode?'عنوان وطني من هدهد':'وصف جغرافي من هدهد'}</span>{mode==='location'&&accuracy!=null&&<span>{accuracyLabel} · ±{accuracy} م</span>}</div>
        {addressDetails.length>0&&<div className="address-fields">{addressDetails.map(detail=><div className={`address-field${detail.wide?' wide':''}`} key={detail.key}><span>{detail.label}</span><strong dir={detail.ltr?'ltr':undefined}>{detail.value}</strong></div>)}</div>}
        {!addressDetails.length&&address&&<div className="address-detail"><span>العنوان التفصيلي</span><p>{address}</p></div>}
        {mode==='location'&&!resultShortcode&&<p className="address-note">هدهد أعاد العنوان التفصيلي لهذا الموقع، لكنه لم يُرجع عنوانًا مختصرًا.</p>}
        {missing.length>0&&<p className="address-missing">بيانات لم يُرجعها هدهد: {missing.join('، ')}.</p>}
        {distance!=null&&((mode==='location'&&distance>150)||(mode==='shortcode'&&distance>500))&&<p className="address-warning">النتيجة تبعد نحو {distance>=1000?`${(distance/1000).toFixed(1)} كم`:`${distance} م`} عن موقع جهازك. راجع العنوان قبل مشاركته.</p>}
        {rawDetails.length>0&&<details className="address-raw"><summary>كل البيانات التي أعادها هدهد ({rawDetails.length})</summary><div>{rawDetails.map(item=><p key={item.key}><span>{item.label}<small>{item.key}</small></span><strong dir={/lat|lon|id|rank|importance|code|box/i.test(item.key)?'ltr':undefined}>{item.value}</strong></p>)}</div></details>}
        <div className="address-actions">{resultShortcode&&<button onClick={()=>copyText(resultShortcode)}><Copy size={18}/> نسخ المختصر</button>}<button onClick={()=>copyText(detailsText)}><Copy size={18}/> نسخ التفاصيل</button>{fullAddress&&<button onClick={()=>copyText(fullAddress)}><Copy size={18}/> نسخ العنوان الكامل</button>}<button onClick={share}>{copied?<Check size={18}/>:<Share2 size={18}/>} {copied?'تم النسخ':'مشاركة'}</button></div>
      </section>}
    </section>
    <footer>مدعوم بخدمات هدهد داخل المملكة العربية السعودية · لا يتطلب تسجيل دخول</footer>
  </main>;
}
