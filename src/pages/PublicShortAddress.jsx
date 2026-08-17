import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, LocateFixed, MapPin, Search, Share2, Upload } from 'lucide-react';
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
const EXPECTED={location:[['road','الشارع أو الطريق'],['neighbourhood','الحي'],['city','المدينة'],['region','المنطقة'],['postalCode','الرمز البريدي'],['shortcode','العنوان المختصر']],shortcode:[['building','رقم المبنى'],['street','الشارع'],['district','الحي'],['city','المدينة'],['region','المنطقة'],['postalCode','الرمز البريدي']],search:[['road','الشارع أو الطريق'],['neighbourhood','الحي'],['city','المدينة'],['region','المنطقة'],['postalCode','الرمز البريدي']]};
const HudhudAddressMap=lazy(()=>import('../components/HudhudAddressMap.jsx'));
const rawLabels={shortcode:'العنوان المختصر',address_ar:'العنوان بالعربية',address_en:'العنوان بالإنجليزية',lat:'خط العرض',lon:'خط الطول',name:'اسم الموقع',display_name:'العنوان الكامل',place_id:'معرّف المكان',place_rank:'ترتيب المكان',importance:'درجة الأهمية',category:'التصنيف العام',type:'نوع الموقع',addresstype:'نوع العنوان',boundingbox:'حدود الموقع',road:'الشارع',neighbourhood:'الحي',suburb:'الضاحية',city:'المدينة',municipality:'البلدية',province:'المحافظة',postcode:'الرمز البريدي',country:'الدولة',country_code:'رمز الدولة',location:'الموقع',geocoding:'بيانات تحديد الموقع'};
const rawDetailsOf=(value,path=[],result=[])=>{if(value===undefined||value===null||value==='')return result;if(Array.isArray(value)){result.push({key:path.join('.'),label:rawLabels[path.at(-1)]||path.at(-1),value:value.join('، ')});return result;}if(typeof value==='object'){for(const [key,nested] of Object.entries(value))rawDetailsOf(nested,[...path,key],result);return result;}result.push({key:path.join('.'),label:rawLabels[path.at(-1)]||path.at(-1),value:String(value)});return result;};
const placeTypeLabel={city:'مدينة',town:'بلدة',village:'قرية',hamlet:'هجرة أو تجمع',administrative:'نطاق إداري',province:'محافظة أو منطقة',locality:'موقع محلي'};
const normalizePlaceName=value=>String(value||'').trim().replace(/^ال/,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/\s+/g,' ');
const bestPlaceResult=(name,items)=>[...items].sort((a,b)=>{const exactA=normalizePlaceName(a.name)===normalizePlaceName(name)?1:0,exactB=normalizePlaceName(b.name)===normalizePlaceName(name)?1:0;const useful={city:6,town:5,village:4,hamlet:3,administrative:2,province:1};return (exactB-exactA)+((useful[b.type]||0)-(useful[a.type]||0));})[0]||null;
const enrichPlaceResult=(source,item)=>{if(!item)return {...source,hudhud_status:'not_found'};const parts=cleanAddress(item.display_name).split('،').map(v=>v.trim()).filter(Boolean);const region=parts.find(v=>/^منطقة\s/.test(v))||null;const regionIndex=region?parts.indexOf(region):-1;const parent=regionIndex>1?parts[regionIndex-1]:null;const exact=normalizePlaceName(item.name)===normalizePlaceName(source.name||source.name_ar);return {...source,hudhud_status:'matched',hudhud_name:item.name||null,hudhud_type:item.address_type||item.type||null,hudhud_type_ar:placeTypeLabel[item.address_type]||placeTypeLabel[item.type]||item.address_type||item.type||null,parent_place:parent,region,country:parts.at(-1)||null,latitude:item.lat??null,longitude:item.lon??null,display_name:item.display_name||null,hudhud_place_id:item.place_id??null,match_confidence:exact?(region?95:85):60};};

export default function PublicShortAddress(){
  const [mode,setMode]=useState('location');
  const [shortcode,setShortcode]=useState('');
  const [query,setQuery]=useState('');
  const [searchResults,setSearchResults]=useState([]);
  const [nearbyOpen,setNearbyOpen]=useState(false);
  const [categories,setCategories]=useState([]);
  const [nearbyResults,setNearbyResults]=useState([]);
  const [nearbyDetail,setNearbyDetail]=useState(null);
  const [nearbyPoint,setNearbyPoint]=useState(null);
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
  const [accuracy,setAccuracy]=useState(null);
  const [deviceLocation,setDeviceLocation]=useState(null);
  const requestRef=useRef(null);
  const [placeRows,setPlaceRows]=useState([]);
  const [placeCursor,setPlaceCursor]=useState(0);
  const [placeBusy,setPlaceBusy]=useState(false);
  const [placeMessage,setPlaceMessage]=useState('');

  const call=useCallback(async(action,body={},commit=true)=>{requestRef.current?.abort();const controller=new AbortController();requestRef.current=controller;setBusy(true);setError('');if(commit)setResult(null);try{const response=await fetch(`${supabase.supabaseUrl}/functions/v1/hudhud-short-address`,{method:'POST',headers:{apikey:supabase.supabaseKey,Authorization:`Bearer ${supabase.supabaseKey}`,'Content-Type':'application/json','x-region':'eu-central-1'},body:JSON.stringify({action,...body,website:''}),signal:controller.signal});const data=await response.json().catch(()=>null);if(!response.ok||!data?.ok)throw Error(data?.error||'تعذر تنفيذ الطلب.');if(commit)setResult(data.data);return data.data;}catch(e){if(e?.name!=='AbortError')setError(e?.message||'تعذر الوصول إلى هدهد.');return null;}finally{if(requestRef.current===controller){requestRef.current=null;setBusy(false);}}},[]);

  const switchMode=next=>{setMode(next);setResult(null);setSearchResults([]);setError('');setCopied(false);};
  const locate=()=>{if(!navigator.geolocation){setError('متصفحك لا يدعم تحديد الموقع.');return;}requestRef.current?.abort();setBusy(true);setError('');navigator.geolocation.getCurrentPosition(({coords})=>{const point={lat:coords.latitude,lon:coords.longitude};setAccuracy(Math.round(coords.accuracy));setDeviceLocation(point);call('reverse',point);},()=>{setBusy(false);setError('اسمح للموقع بالوصول إلى موقعك ثم حاول مرة أخرى.');},{enableHighAccuracy:true,timeout:15000,maximumAge:0});};
  const lookup=async e=>{e.preventDefault();await call('shortcode',{shortcode});};
  const searchAddress=async e=>{e.preventDefault();setResult(null);setSearchResults([]);const data=await call('geocode',{query},false);const items=Array.isArray(data)?data:Array.isArray(data?.results)?data.results:[];setSearchResults(deviceLocation?[...items].sort((a,b)=>(distanceMeters(deviceLocation,resultPoint(a))??Infinity)-(distanceMeters(deviceLocation,resultPoint(b))??Infinity)):items);};
  const selectSearchResult=async item=>{const point=resultPoint(item);if(!point){setResult(item);return;}const details=await call('reverse',point,false);setResult(details?{...details,search_match:item}:item);};
  const openNearby=async()=>{setNearbyOpen(value=>!value);if(categories.length)return;const data=await call('categories',{},false);setCategories(Array.isArray(data)?data:Array.isArray(data?.categories)?data.categories:[]);};
  const findNearby=async category=>{const center=resultPoint(result)||deviceLocation;if(!center)return;setNearbyResults([]);setNearbyDetail(null);const data=await call('places',{query:category.key,user_location:center},false);setNearbyResults(Array.isArray(data)?data:Array.isArray(data?.results)?data.results:[]);};
  const showPlace=async place=>{const lat=Number(place.latitude),lon=Number(place.longitude);if(Number.isFinite(lat)&&Number.isFinite(lon))setNearbyPoint({lat,lon});const data=await call('place_detail',{id:place.id},false);setNearbyDetail(data||place);};
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
  const mapPoint=nearbyPoint||resultPoint(result)||deviceLocation;
  const pickOnMap=useCallback(point=>{setDeviceLocation(point);setAccuracy(null);call('reverse',point);},[call]);
  const uploadPlaces=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setPlaceMessage('');try{const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed))throw Error('يجب أن يحتوي الملف على قائمة JSON.');const rows=parsed.filter(row=>row&&typeof row==='object'&&(row.name||row.name_ar||row.name_en));if(!rows.length)throw Error('لم نجد أسماء مدن أو قرى داخل الملف.');setPlaceRows(rows);setPlaceCursor(0);setPlaceMessage(`تم تحميل ${rows.length.toLocaleString('ar-SA')} سجل. ستتم المعالجة على دفعات من 20 سجلًا.`);}catch(e){setPlaceMessage(e.message||'تعذر قراءة الملف.');}};
  const processPlaces=async()=>{if(placeBusy||placeCursor>=placeRows.length)return;setPlaceBusy(true);const end=Math.min(placeCursor+20,placeRows.length),next=[...placeRows];for(let index=placeCursor;index<end;index++){const source=next[index],name=source.name||source.name_ar||source.name_en;try{const response=await fetch(`${supabase.supabaseUrl}/functions/v1/hudhud-short-address`,{method:'POST',headers:{apikey:supabase.supabaseKey,Authorization:`Bearer ${supabase.supabaseKey}`,'Content-Type':'application/json','x-region':'eu-central-1'},body:JSON.stringify({action:'geocode',query:String(name).trim(),website:''})});const payload=await response.json().catch(()=>null);if(!response.ok||!payload?.ok)throw Error(payload?.error||'فشل البحث');const items=Array.isArray(payload.data)?payload.data:payload.data?.results||[];next[index]=enrichPlaceResult(source,bestPlaceResult(name,items));}catch(e){next[index]={...source,hudhud_status:'error',hudhud_error:e.message||'فشل البحث'};}setPlaceRows([...next]);await new Promise(resolve=>setTimeout(resolve,700));}setPlaceCursor(end);setPlaceMessage(`اكتملت معالجة ${end.toLocaleString('ar-SA')} من ${next.length.toLocaleString('ar-SA')} سجل.`);setPlaceBusy(false);};
  const downloadPlaces=()=>{if(!placeRows.length)return;const blob=new Blob([JSON.stringify(placeRows,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='hudhud-cities-enriched.json';anchor.click();URL.revokeObjectURL(url);};

  return <main className="address-page" dir="rtl">
    <header className="address-header"><LamhaLogo/></header>
    <section className="address-card">
      <div className="address-intro"><span><MapPin size={24}/></span><h1>العنوان المختصر</h1><p>احصل على عنوانك، أو أدخل عنوانًا مختصرًا لمعرفة تفاصيله.</p></div>
      <div className="address-tabs" role="tablist" aria-label="طريقة البحث">
        <button role="tab" aria-selected={mode==='location'} className={mode==='location'?'active':''} onClick={()=>switchMode('location')}><LocateFixed size={19}/> استخدم موقعي</button>
        <button role="tab" aria-selected={mode==='shortcode'} className={mode==='shortcode'?'active':''} onClick={()=>switchMode('shortcode')}><Search size={19}/> أدخل عنوانًا مختصرًا</button>
        <button role="tab" aria-selected={mode==='search'} className={mode==='search'?'active':''} onClick={()=>switchMode('search')}><MapPin size={19}/> ابحث باسم العنوان</button>
      </div>

      <Suspense fallback={<div className="hudhud-map-loading">جاري تحميل الخريطة…</div>}><HudhudAddressMap point={mapPoint} onPick={pickOnMap}/></Suspense>

      {mode==='location'?<section className="address-action"><h2>حدد موقعك الحالي</h2><p>سنستخدم موقعك مرة واحدة لجلب عنوانك من هدهد، ولن نحفظه.</p><button className="address-primary" onClick={locate} disabled={busy}><LocateFixed size={20}/>{busy?'جاري تحديد العنوان…':'استخدم موقعي الحالي'}</button></section>:mode==='shortcode'?
      <form className="address-action" onSubmit={lookup}><h2>أدخل العنوان المختصر</h2><p>يتكون من أربعة أحرف وأربعة أرقام.</p><label><span>العنوان المختصر</span><input dir="ltr" inputMode="text" autoCapitalize="characters" maxLength={8} value={shortcode} onChange={e=>setShortcode(e.target.value.replace(/\s/g,'').toUpperCase())} placeholder="MKGA2655"/></label><button className="address-primary" disabled={busy||shortcode.length!==8}><Search size={20}/>{busy?'جاري البحث…':'عرض تفاصيل العنوان'}</button></form>:
      <form className="address-action" onSubmit={searchAddress}><h2>ابحث باسم العنوان</h2><p>اكتب اسم المكان أو الشارع أو الحي والمدينة، ثم اختر النتيجة الصحيحة.</p><label><span>اسم العنوان أو المكان</span><input className="address-query" inputMode="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="مثال: شارع التحلية، جدة"/></label><button className="address-primary" disabled={busy||query.trim().length<2}><Search size={20}/>{busy?'جاري البحث في هدهد…':'بحث في هدهد'}</button></form>}

      {mode==='search'&&searchResults.length>0&&<section className="address-search-results" aria-live="polite"><div className="address-search-heading"><h2>نتائج هدهد</h2><span>{searchResults.length} نتائج</span></div>{searchResults.map((item,index)=><button type="button" key={item.place_id||`${item.lat}-${item.lon}-${index}`} onClick={()=>selectSearchResult(item)} disabled={busy}><span className="address-search-number">{index+1}</span><span><strong>{item.name||item.display_name||'موقع'}</strong><small>{cleanAddress(item.display_name)}</small>{(item.category||item.type)&&<em>{[item.category,item.type].filter(Boolean).join(' · ')}</em>}</span></button>)}</section>}

      {error&&<div className="address-error" role="alert">{error}</div>}
      {result&&<section className="address-result" aria-live="polite">
        <div className="address-result-title"><span><MapPin size={21}/></span><div><small>نتيجة هدهد</small><h2>{mode==='location'?'تفاصيل الموقع':mode==='search'?'تفاصيل المكان':'تفاصيل العنوان'}</h2></div></div>
        <div className="address-meta"><span>{resultShortcode?'عنوان وطني من هدهد':'وصف جغرافي من هدهد'}</span>{mode==='location'&&accuracy!=null&&<span>{accuracyLabel} · ±{accuracy} م</span>}</div>
        {addressDetails.length>0&&<div className="address-fields">{addressDetails.map(detail=><div className={`address-field${detail.wide?' wide':''}`} key={detail.key}><span>{detail.label}</span><strong dir={detail.ltr?'ltr':undefined}>{detail.value}</strong></div>)}</div>}
        {!addressDetails.length&&address&&<div className="address-detail"><span>العنوان التفصيلي</span><p>{address}</p></div>}
        {mode==='location'&&!resultShortcode&&<p className="address-note">هدهد أعاد العنوان التفصيلي لهذا الموقع، لكنه لم يُرجع عنوانًا مختصرًا.</p>}
        {missing.length>0&&<p className="address-missing">بيانات لم يُرجعها هدهد: {missing.join('، ')}.</p>}
        {distance!=null&&((mode==='location'&&distance>150)||(mode==='shortcode'&&distance>500))&&<p className="address-warning">النتيجة تبعد نحو {distance>=1000?`${(distance/1000).toFixed(1)} كم`:`${distance} م`} عن موقع جهازك. راجع العنوان قبل مشاركته.</p>}
        {rawDetails.length>0&&<details className="address-raw"><summary>كل البيانات التي أعادها هدهد ({rawDetails.length})</summary><div>{rawDetails.map(item=><p key={item.key}><span>{item.label}<small>{item.key}</small></span><strong dir={/lat|lon|id|rank|importance|code|box/i.test(item.key)?'ltr':undefined}>{item.value}</strong></p>)}</div></details>}
        <div className="address-actions">{resultShortcode&&<button onClick={()=>copyText(resultShortcode)}><Copy size={18}/> نسخ المختصر</button>}<button onClick={()=>copyText(detailsText)}><Copy size={18}/> نسخ التفاصيل</button>{fullAddress&&<button onClick={()=>copyText(fullAddress)}><Copy size={18}/> نسخ العنوان الكامل</button>}<button onClick={share}>{copied?<Check size={18}/>:<Share2 size={18}/>} {copied?'تم النسخ':'مشاركة'}</button></div>
      </section>}

      {mapPoint&&<section className="nearby-section"><button type="button" className="nearby-toggle" onClick={openNearby} disabled={busy}><MapPin size={19}/><span><strong>الأماكن القريبة</strong><small>مطاعم، مستشفيات، مساجد وخدمات حول الموقع</small></span><b>{nearbyOpen?'إخفاء':'عرض'}</b></button>{nearbyOpen&&<div className="nearby-content"><p>اختر تصنيفًا للبحث حول النقطة المحددة على الخريطة.</p><div className="nearby-categories">{categories.map(category=><button type="button" key={category.key} onClick={()=>findNearby(category)} disabled={busy}>{category.name_ar||category.name_en||category.key}</button>)}</div>{nearbyResults.length>0&&<div className="nearby-list">{nearbyResults.map(place=><button type="button" key={place.id} onClick={()=>showPlace(place)} disabled={busy}><span><strong>{place.name_ar||place.name_en}</strong><small>{[place.category_ar,place.district_ar,place.city_ar].filter(Boolean).join(' · ')}</small></span><span>{Number.isFinite(Number(place.rating))?`★ ${Number(place.rating).toFixed(1)}`:''}</span></button>)}</div>}{nearbyDetail&&<details className="address-raw nearby-detail" open><summary>تفاصيل المكان من هدهد</summary><div>{rawDetailsOf(nearbyDetail).map(item=><p key={item.key}><span>{rawLabels[item.key.split('.').at(-1)]||item.label}<small>{item.key}</small></span><strong>{item.value}</strong></p>)}</div></details>}</div>}</section>}
      <section className="place-list-section"><div className="place-list-heading"><span><Upload size={20}/></span><div><h2>تحليل قائمة مدن وقرى</h2><p>ارفع ملف JSON لمعرفة النوع، الموقع التابع، المنطقة والإحداثيات من هدهد.</p></div></div><div className="place-list-actions"><label className="place-upload"><Upload size={18}/> رفع ملف JSON<input type="file" accept="application/json,.json" onChange={uploadPlaces}/></label><button type="button" onClick={processPlaces} disabled={placeBusy||!placeRows.length||placeCursor>=placeRows.length}>{placeBusy?'جاري المعالجة…':placeCursor?'متابعة الدفعة التالية':'بدء التحليل'}</button><button type="button" onClick={downloadPlaces} disabled={!placeRows.length}><Download size={18}/> تنزيل النتائج</button></div>{placeMessage&&<p className="place-list-message">{placeMessage}</p>}{placeRows.length>0&&<><div className="place-progress"><span style={{width:`${Math.round(placeCursor/placeRows.length*100)}%`}}/></div><div className="place-preview">{placeRows.slice(Math.max(0,placeCursor-5),Math.max(5,placeCursor)).map((row,index)=><div key={row.id||`${row.name}-${index}`}><strong>{row.name||row.name_ar||row.name_en}</strong><span>{row.hudhud_status==='matched'?[row.hudhud_type_ar,row.parent_place,row.region].filter(Boolean).join(' ← '):row.hudhud_status==='error'?'تعذر مؤقتًا':row.hudhud_status==='not_found'?'لم توجد مطابقة':'بانتظار المعالجة'}</span>{row.match_confidence&&<small>ثقة {row.match_confidence}%</small>}</div>)}</div></>}</section>
    </section>
    <footer>مدعوم بخدمات هدهد داخل المملكة العربية السعودية · لا يتطلب تسجيل دخول</footer>
  </main>;
}
