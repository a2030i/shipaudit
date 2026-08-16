import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, Copy, ExternalLink, LocateFixed, Map, MapPin, Navigation, Route, Search, Share2, Table2, X } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import { FunctionRegion } from '@supabase/supabase-js';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '../lib/supabase.js';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import './PublicShortAddress.css';

const RIYADH={lat:24.7136,lon:46.6753};
const KEY=String(import.meta.env.VITE_HUDHUD_PUBLISHABLE_KEY||'').trim();
const MAP_ID=String(import.meta.env.VITE_HUDHUD_MAP_ID||'default').trim();
const STYLE=KEY?`https://b.hudhud.sa/v1/maps/styles/${encodeURIComponent(MAP_ID)}?variant=light&lang=ar&api_key=${encodeURIComponent(KEY)}`:null;
const TOOLS=[
  ['reverse','موقعي إلى عنوان',LocateFixed],['shortcode','العنوان المختصر',MapPin],['geocode','البحث عن عنوان',Search],
  ['places','الأماكن القريبة',Building2],['directions','المسار والاتجاهات',Route],['matrix','مصفوفة المسافات',Table2],
];
const listOf=d=>Array.isArray(d)?d:Array.isArray(d?.results)?d.results:Array.isArray(d?.features)?d.features:Array.isArray(d?.places)?d.places:[];
const coordOf=d=>{const x=d?.geometry?.coordinates||d?.coordinates; if(Array.isArray(x))return {lon:Number(x[0]),lat:Number(x[1])};const lat=Number(d?.lat??d?.latitude??d?.location?.lat),lon=Number(d?.lon??d?.lng??d?.longitude??d?.location?.lon??d?.location?.lng);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;};
const titleOf=d=>d?.name_ar||d?.name||d?.title||d?.shortcode||d?.short_address||d?.display_name||d?.address_ar||d?.properties?.name||'نتيجة هدهد';
const addressOf=d=>d?.address_ar||d?.display_name||d?.formatted_address||d?.national_address||d?.properties?.display_name||[d?.street,d?.district,d?.city,d?.postal_code].filter(Boolean).join('، ');
const shortcodeOf=d=>d?.shortcode||d?.short_address||d?.address?.shortcode||d?.properties?.shortcode;

export default function PublicShortAddress(){
  const mapNode=useRef(null),mapRef=useRef(null),markers=useRef([]);
  const [tool,setTool]=useState('reverse'),[query,setQuery]=useState(''),[points,setPoints]=useState([]),[result,setResult]=useState(null),[items,setItems]=useState([]),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const call=useCallback(async(action,body={})=>{setBusy(true);setError('');try{const {data,error:e}=await supabase.functions.invoke('hudhud-short-address',{body:{action,...body,website:''},region:FunctionRegion.EuCentral1});if(e)throw e;if(!data?.ok)throw Error(data?.error||'تعذر تنفيذ الطلب.');return data.data;}catch(e){setError(e?.message||'تعذر الوصول إلى هدهد.');return null;}finally{setBusy(false);}},[]);
  const clearMap=useCallback(()=>{markers.current.forEach(m=>m.remove());markers.current=[];const map=mapRef.current;if(map?.getLayer('hudhud-route'))map.removeLayer('hudhud-route');if(map?.getSource('hudhud-route'))map.removeSource('hudhud-route');},[]);
  const showPoints=useCallback(next=>{clearMap();if(!mapRef.current)return;next.forEach((p,i)=>{const el=document.createElement('div');el.className='hudhud-marker';el.textContent=String(i+1);markers.current.push(new maplibregl.Marker({element:el}).setLngLat([p.lon,p.lat]).addTo(mapRef.current));});if(next.length)mapRef.current.flyTo({center:[next.at(-1).lon,next.at(-1).lat],zoom:next.length===1?16:12});},[clearMap]);
  const inspect=useCallback(d=>{setSelected(d);const p=coordOf(d);if(p){setPoints([p]);showPoints([p]);}},[showPoints]);
  const runPoint=useCallback(async p=>{const d=await call('reverse',p);if(d){setResult(d);setSelected(d);setItems([]);}},[call]);
  const addPoint=useCallback(p=>{if(tool==='directions'||tool==='matrix'){const max=tool==='directions'?2:6;setPoints(old=>{const next=old.length>=max?[p]:[...old,p];showPoints(next);return next;});}else{setPoints([p]);showPoints([p]);if(tool==='reverse')runPoint(p);}},[runPoint,showPoints,tool]);
  useEffect(()=>{if(!mapNode.current||mapRef.current||!STYLE)return;const map=new maplibregl.Map({container:mapNode.current,style:STYLE,center:[RIYADH.lon,RIYADH.lat],zoom:10.5,attributionControl:false});map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');map.on('click',e=>addPoint({lat:e.lngLat.lat,lon:e.lngLat.lng}));mapRef.current=map;return()=>{map.remove();mapRef.current=null;};},[addPoint]);
  useEffect(()=>{setResult(null);setSelected(null);setItems([]);setError('');setQuery('');setPoints([]);clearMap();},[tool,clearMap]);
  const locate=()=>navigator.geolocation?navigator.geolocation.getCurrentPosition(({coords})=>addPoint({lat:coords.latitude,lon:coords.longitude}),()=>setError('اسمح بالوصول للموقع أو اختر نقطة من الخريطة.'),{enableHighAccuracy:true,timeout:12000}):setError('متصفحك لا يدعم تحديد الموقع.');
  const submit=async e=>{e.preventDefault();let d;if(tool==='shortcode')d=await call('shortcode',{shortcode:query});if(tool==='geocode')d=await call('geocode',{query});if(tool==='places')d=await call('places',{query,user_location:points[0]||RIYADH});if(tool==='directions'||tool==='matrix')d=await call(tool,{coordinates:points});if(!d)return;setResult(d);const found=listOf(d);setItems(found);if(!found.length)setSelected(d);if(tool==='directions'){const geometry=d?.geometry||d?.routes?.[0]?.geometry;const coords=geometry?.coordinates||geometry;if(mapRef.current&&Array.isArray(coords)){mapRef.current.addSource('hudhud-route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:coords}}});mapRef.current.addLayer({id:'hudhud-route',type:'line',source:'hudhud-route',paint:{'line-color':'#087e58','line-width':5}});}}};
  const detail=async item=>{inspect(item);if(item?.id||item?.place_id){const d=await call('place_detail',{id:item.id||item.place_id});if(d)setSelected(d);}};
  const active=TOOLS.find(t=>t[0]===tool);const ActiveIcon=active?.[2];const value=selected||(!items.length&&result);const point=coordOf(value)||points[0];
  const shareText=useMemo(()=>[titleOf(value),shortcodeOf(value),addressOf(value),point&&`${point.lat},${point.lon}`].filter(Boolean).join('\n'),[value,point]);
  const copy=async()=>{if(!shareText)return;await navigator.clipboard.writeText(shareText);setCopied(true);setTimeout(()=>setCopied(false),1600);};
  const share=async()=>{if(!shareText)return;if(navigator.share)await navigator.share({title:'موقع من هدهد',text:shareText,url:location.href});else copy();};
  return <main className="hudhud-page" dir="rtl">
    <header className="hudhud-head"><LamhaLogo/><div><h1>دليل العنوان والموقع</h1><p>جميع خدمات هدهد في مكان واحد</p></div><span className="live-pill"><i/> متصل بخدمات هدهد</span></header>
    <nav className="hudhud-tools" aria-label="أدوات هدهد">{TOOLS.map(([id,label,Icon])=><button key={id} className={tool===id?'active':''} onClick={()=>setTool(id)}><Icon size={19}/><span>{label}</span></button>)}</nav>
    <section className="hudhud-shell">
      <div className="hudhud-map" ref={mapNode}>{!STYLE&&<div className="map-setup"><Map size={38}/><strong>خريطة هدهد بانتظار المفتاح العام</strong><span>أضف VITE_HUDHUD_PUBLISHABLE_KEY وVITE_HUDHUD_MAP_ID. جميع عمليات البحث النصية تعمل الآن.</span></div>}<div className="map-hint">{tool==='directions'?'اختر نقطة البداية ثم الوجهة':tool==='matrix'?'اختر من نقطتين إلى 6 نقاط':'اضغط على الخريطة لتحديد الموقع'}</div></div>
      <aside className="hudhud-panel">
        <div className="panel-title">{ActiveIcon&&<ActiveIcon size={23}/>}<div><h2>{active?.[1]}</h2><p>{tool==='reverse'?'حوّل موقعك إلى عنوان وطني مختصر':tool==='shortcode'?'أدخل 4 أحرف و4 أرقام للوصول للموقع':tool==='geocode'?'ابحث باسم الشارع أو الحي أو المدينة':tool==='places'?'ابحث عن المطاعم والخدمات والمعالم':tool==='directions'?'احسب المسار بين نقطتين': 'قارن المسافات والأزمنة بين عدة نقاط'}</p></div></div>
        {tool==='reverse'?<button className="primary" onClick={locate} disabled={busy}><LocateFixed size={19}/> استخدم موقعي الحالي</button>:<form onSubmit={submit} className="search-form">{!['directions','matrix'].includes(tool)&&<div className="input-wrap"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value.toUpperCase())} placeholder={tool==='shortcode'?'مثال: RBAA2112':tool==='places'?'قهوة، مستشفى، صيدلية…':'اكتب العنوان أو اسم المكان'}/>{query&&<button type="button" onClick={()=>setQuery('')}><X size={16}/></button>}</div>}<button className="primary" disabled={busy||(['directions','matrix'].includes(tool)&&points.length<2)}>{busy?'جاري البحث…':tool==='directions'?'احسب المسار':tool==='matrix'?'أنشئ المصفوفة':'بحث في هدهد'}</button></form>}
        {points.length>0&&<div className="point-count"><MapPin size={16}/> {points.length} {points.length===1?'نقطة محددة':'نقاط محددة'} {['directions','matrix'].includes(tool)&&<button onClick={()=>{setPoints([]);clearMap();}}>مسح</button>}</div>}
        {error&&<div className="api-error">{error}</div>}
        {items.length>0&&<div className="result-list">{items.slice(0,20).map((item,i)=><button key={item.id||i} onClick={()=>detail(item)}><span>{i+1}</span><div><strong>{titleOf(item)}</strong><small>{addressOf(item)||item.category_ar||item.category}</small></div><Navigation size={16}/></button>)}</div>}
        {value&&<article className="result-card"><div className="result-card-head"><span><MapPin size={21}/></span><div><small>نتيجة هدهد</small><h3>{titleOf(value)}</h3></div></div>{shortcodeOf(value)&&<div className="shortcode"><span>العنوان المختصر</span><strong>{shortcodeOf(value)}</strong></div>}<p>{addressOf(value)}</p><dl>{value?.phone&&<><dt>الهاتف</dt><dd>{value.phone}</dd></>}{value?.website&&<><dt>الموقع</dt><dd>{value.website}</dd></>}{value?.rating&&<><dt>التقييم</dt><dd>{value.rating}</dd></>}</dl><div className="result-actions"><button onClick={copy}>{copied?<Check size={17}/>:<Copy size={17}/>} {copied?'تم النسخ':'نسخ'}</button><button onClick={share}><Share2 size={17}/> مشاركة</button>{point&&<a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${point.lat},${point.lon}`}><ExternalLink size={17}/> فتح بالخريطة</a>}</div></article>}
        {!value&&!items.length&&!error&&<div className="empty"><MapPin size={28}/><strong>ابدأ باختيار الأداة</strong><span>لن نحفظ موقعك أو سجل بحثك.</span></div>}
      </aside>
    </section>
    <footer>مدعوم ببيانات وخرائط هدهد داخل المملكة العربية السعودية · لا يتطلب تسجيل دخول</footer>
  </main>;
}
