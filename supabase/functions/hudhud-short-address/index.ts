const ALLOWED = new Set(['https://shipaudit-five.vercel.app','http://localhost:5173','http://127.0.0.1:5173']);
const BASE = 'https://b.hudhud.sa/v1';
const routes: Record<string,{method:'GET'|'POST';path:(b:any)=>string}> = {
  reverse:{method:'POST',path:()=>'/geocoding/reverse'}, shortcode:{method:'POST',path:()=>'/geocoding/lookup_shortcode'},
  geocode:{method:'POST',path:()=>'/geocoding/search'}, categories:{method:'GET',path:()=>'/places/categories'},
  places:{method:'POST',path:()=>'/places/search'}, place_detail:{method:'GET',path:b=>`/places/${encodeURIComponent(b.id)}`},
  directions:{method:'POST',path:()=>'/routing/directions'}, matrix:{method:'POST',path:()=>'/routing/matrix'},
};
function headers(req:Request){const o=req.headers.get('origin')||'';return {'Access-Control-Allow-Origin':ALLOWED.has(o)?o:'https://shipaudit-five.vercel.app','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-region','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};}
function out(req:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:headers(req)});}
function point(p:any){const lat=Number(p?.lat),lon=Number(p?.lon);return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=16&&lat<=33&&lon>=34&&lon<=56?{lat,lon}:null;}
async function ipHash(req:Request,secret:string){const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${secret.slice(0,16)}:${ip}`));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function startEvent(req:Request,secret:string,action:string){try{const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return null;const response=await fetch(`${url}/rest/v1/rpc/start_hudhud_api_request`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_ip_hash:await ipHash(req,secret),p_action:action,p_limit:60,p_window_seconds:60})});if(!response.ok)return null;const id=await response.json();return Number(id)||0;}catch{return null;}}
async function finishEvent(id:number|null,ok:boolean,status:number,started:number,errorCode?:string){if(!id)return;try{const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');await fetch(`${url}/rest/v1/hudhud_api_events?id=eq.${id}`,{method:'PATCH',headers:{apikey:key!,Authorization:`Bearer ${key}`,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({ok,status_code:status,duration_ms:Date.now()-started,error_code:errorCode||null})});}catch{/* Observability must never block the address result. */}}
function payload(action:string,b:any){
  if(action==='reverse'){const p=point(b);if(!p)throw Error('اختر موقعًا داخل المملكة.');return p;}
  if(action==='shortcode'){const shortcode=String(b.shortcode||'').trim().toUpperCase();if(!/^[A-Z]{4}\d{4}$/.test(shortcode))throw Error('العنوان المختصر يجب أن يتكون من 4 أحرف و4 أرقام.');return {shortcode};}
  if(action==='geocode'){const query=String(b.query||'').trim();if(query.length<2)throw Error('اكتب عنوانًا للبحث.');return {query:query.slice(0,160)};}
  if(action==='places'){const query=String(b.query||'').trim();if(query.length<2)throw Error('اكتب اسم مكان أو تصنيفًا.');const p=point(b.user_location)||{lat:24.7136,lon:46.6753};const bounding_box=b.bounding_box||{min_lat:p.lat-.18,max_lat:p.lat+.18,min_lon:p.lon-.18,max_lon:p.lon+.18};return {query:query.slice(0,120),user_location:p,bounding_box};}
  if(action==='place_detail'){if(!String(b.id||'').trim())throw Error('معرّف المكان مطلوب.');return null;}
  if(action==='directions'||action==='matrix'){const coordinates=(Array.isArray(b.coordinates)?b.coordinates:[]).map(point);if(coordinates.some((p:any)=>!p)||coordinates.length<2||coordinates.length>10)throw Error('أضف نقطتين على الأقل داخل المملكة.');return {coordinates,...(action==='matrix'?{sources:b.sources||coordinates.map((_:any,i:number)=>i),destinations:b.destinations||coordinates.map((_:any,i:number)=>i)}:{})};}
  return null;
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:headers(req)}); if(req.method!=='POST')return out(req,{ok:false,error:'method_not_allowed'},405);
  const origin=req.headers.get('origin')||'';if(origin&&!ALLOWED.has(origin))return out(req,{ok:false,error:'origin_not_allowed'},403);
  let b:any;try{b=await req.json();}catch{return out(req,{ok:false,error:'invalid_json'},400);} if(b.website)return out(req,{ok:true,data:null});
  const action=String(b.action||'reverse');
  if(action==='map_config'){
    const publishableKey=String(Deno.env.get('VITE_HUDHUD_PUBLISHABLE_KEY')||'').trim();
    const mapId=String(Deno.env.get('VITE_HUDHUD_MAP_ID')||'default').trim();
    return out(req,{ok:true,data:{publishableKey,mapId}});
  }
  const route=routes[action];if(!route)return out(req,{ok:false,error:'عملية غير مدعومة.'},400);
  const secret=String(Deno.env.get('HUDHUD_SECRET_KEY')||'').trim();if(!secret)return out(req,{ok:false,error:'خدمة هدهد غير مهيأة.'},503);
  const started=Date.now(),eventId=await startEvent(req,secret,action);if(eventId===0)return out(req,{ok:false,error:'طلبات كثيرة، حاول بعد دقيقة.'},429);if(eventId===null)return out(req,{ok:false,error:'تعذر التحقق من حد الاستخدام. حاول مجددًا.'},503);
  let clean:any;try{clean=payload(action,b);}catch(e){return out(req,{ok:false,error:e instanceof Error?e.message:'بيانات غير صحيحة.'},400);}
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);
  try{const upstream=await fetch(BASE+route.path(b),{method:route.method,headers:{Authorization:`Bearer ${secret}`,Accept:'application/json','Content-Type':'application/json','Accept-Language':'ar'},...(route.method==='POST'?{body:JSON.stringify(clean)}:{}),signal:ctl.signal});const data=await upstream.json().catch(()=>null);if(!upstream.ok||data?.ok===false){const status=upstream.status>=400&&upstream.status<500?upstream.status:502,msg=upstream.status===404?'لم نعثر على نتيجة مطابقة.':upstream.status===429?'تم بلوغ حد طلبات هدهد مؤقتًا.':data?.message||data?.error||'تعذر تنفيذ الطلب لدى هدهد.';await finishEvent(eventId,false,status,started,`hudhud_${upstream.status}`);return out(req,{ok:false,error:msg},status);}const result=data?.data??data;if(action==='shortcode'){const p=point(result?.location);if(p){try{const reverseResponse=await fetch(BASE+'/geocoding/reverse',{method:'POST',headers:{Authorization:`Bearer ${secret}`,Accept:'application/json','Content-Type':'application/json','Accept-Language':'ar'},body:JSON.stringify(p),signal:ctl.signal});const reversePayload=await reverseResponse.json().catch(()=>null);if(reverseResponse.ok&&reversePayload?.ok!==false){await finishEvent(eventId,true,200,started);return out(req,{ok:true,data:{...result,geocoding:reversePayload?.data??reversePayload}});}}catch{/* Keep the valid shortcode result if optional enrichment fails. */}}}await finishEvent(eventId,true,200,started);return out(req,{ok:true,data:result});}
  catch(e){await finishEvent(eventId,false,502,started,e instanceof DOMException&&e.name==='AbortError'?'timeout':'network_error');return out(req,{ok:false,error:e instanceof DOMException&&e.name==='AbortError'?'انتهت مهلة هدهد. حاول مجددًا.':'تعذر الاتصال بخدمة هدهد.'},502);}finally{clearTimeout(timer);}
});
