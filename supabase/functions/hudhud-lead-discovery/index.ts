import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const HUDHUD_BASE='https://b.hudhud.sa/v1';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json; charset=utf-8'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const CITIES:Record<string,{label:string;lat:number;lon:number}>={
  riyadh:{label:'الرياض',lat:24.7136,lon:46.6753},jeddah:{label:'جدة',lat:21.5433,lon:39.1728},makkah:{label:'مكة المكرمة',lat:21.3891,lon:39.8579},madinah:{label:'المدينة المنورة',lat:24.5247,lon:39.5692},dammam:{label:'الدمام',lat:26.4207,lon:50.0888},khobar:{label:'الخبر',lat:26.2172,lon:50.1971},dhahran:{label:'الظهران',lat:26.2361,lon:50.0393},jubail:{label:'الجبيل',lat:27.0174,lon:49.6225},qatif:{label:'القطيف',lat:26.5652,lon:50.0089},hofuf:{label:'الهفوف',lat:25.3646,lon:49.5878},
  taif:{label:'الطائف',lat:21.2703,lon:40.4158},yanbu:{label:'ينبع',lat:24.0895,lon:38.0618},tabuk:{label:'تبوك',lat:28.3838,lon:36.5662},abha:{label:'أبها',lat:18.2465,lon:42.5117},khamis:{label:'خميس مشيط',lat:18.3065,lon:42.7294},jazan:{label:'جازان',lat:16.8892,lon:42.5511},najran:{label:'نجران',lat:17.5656,lon:44.2289},baha:{label:'الباحة',lat:20.0129,lon:41.4677},
  buraydah:{label:'بريدة',lat:26.3592,lon:43.9818},unaizah:{label:'عنيزة',lat:26.0843,lon:43.9936},hail:{label:'حائل',lat:27.5114,lon:41.7208},sakaka:{label:'سكاكا',lat:29.9697,lon:40.2064},arar:{label:'عرعر',lat:30.9753,lon:41.0381},hafr:{label:'حفر الباطن',lat:28.4328,lon:45.9708},kharj:{label:'الخرج',lat:24.1556,lon:47.3120},dawadmi:{label:'الدوادمي',lat:24.5077,lon:44.3924}
};
const ALLOWED_CATEGORIES=new Set(['shopping','beauty_care','home_needs','grocery','food_beverages','restaurants','companies']);
const normalizePhone=(value:unknown)=>{let s=String(value||'').replace(/\D/g,'');if(s.startsWith('00'))s=s.slice(2);if(s.startsWith('0'))s=`966${s.slice(1)}`;else if(!s.startsWith('966'))s=`966${s}`;return /^966\d{8,10}$/.test(s)?s:null;};
const score=(p:any)=>{let n=0;const evidence:string[]=[];if(p.website_url){n+=40;evidence.push('website');}if(p.instagram_url||p.tiktok_url||p.snapchat_url||p.x_url){n+=20;evidence.push('social');}if(p.phone_number){n+=15;evidence.push('phone');}if(p.email){n+=10;evidence.push('email');}if(Number(p.rating)>=4){n+=5;evidence.push('rating_4_plus');}if(p.status==='open'){n+=5;evidence.push('open');}if(Number(p.photo_count)>0){n+=5;evidence.push('media');}return {score:Math.min(100,n),evidence};};

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db=createClient(url,serviceKey);
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const {data:{user}}=await db.auth.getUser(token);
  if(!user)return json({ok:false,error:'unauthorized'},401);
  const {data:profile}=await db.from('profiles').select('role,permissions').eq('id',user.id).maybeSingle();
  if(profile?.role!=='admin'&&!profile?.permissions?.['sales.external_leads']&&!profile?.permissions?.['crm.upload_leads'])return json({ok:false,error:'forbidden'},403);
  const body=await req.json().catch(()=>({}));
  if(body.action==='coverage')return json({ok:true,data:Object.entries(CITIES).map(([key,v])=>({key,...v}))});
  const city=CITIES[String(body.city_key||'')],category=String(body.category_key||'shopping');
  if(!city||!ALLOWED_CATEGORIES.has(category))return json({ok:false,error:'invalid_scope'},400);
  const secret=String(Deno.env.get('HUDHUD_SECRET_KEY')||'');if(!secret)return json({ok:false,error:'hudhud_not_configured'},503);
  const {data:scan,error:scanError}=await db.from('hudhud_lead_scans').insert({scope_key:String(body.city_key),scope_label:city.label,category_keys:[category],status:'running',started_at:new Date().toISOString(),created_by:user.id}).select('id').single();
  if(scanError)return json({ok:false,error:scanError.message},500);
  const headers={Authorization:`Bearer ${secret}`,Accept:'application/json','Content-Type':'application/json','Accept-Language':'ar'};
  try{
    const box={min_lat:city.lat-.22,max_lat:city.lat+.22,min_lon:city.lon-.24,max_lon:city.lon+.24};
    const search=await fetch(`${HUDHUD_BASE}/places/search`,{method:'POST',headers,body:JSON.stringify({query:category,user_location:{lat:city.lat,lon:city.lon},bounding_box:box})});
    const payload=await search.json().catch(()=>null);if(!search.ok||payload?.ok===false)throw Error(payload?.error||payload?.message||`hudhud_${search.status}`);
    const places=(payload?.data?.results||payload?.results||[]).slice(0,25);let enriched=0,saved=0;
    for(const place of places){
      const detailResponse=await fetch(`${HUDHUD_BASE}/places/${encodeURIComponent(place.id)}`,{headers});
      if(!detailResponse.ok)continue;const detailPayload=await detailResponse.json().catch(()=>null);const p=detailPayload?.data??detailPayload;if(!p)continue;enriched++;
      const q=score(p);if(q.score<20)continue;
      const row={hudhud_place_id:p.id,scan_id:scan.id,name_ar:p.name_ar||place.name_ar||'نشاط',name_en:p.name_en||null,category_ar:p.category_ar||place.category_ar||null,category_key:p.category_key||category,city_ar:p.city_ar||place.city_ar||city.label,district_ar:p.district_ar||place.district_ar||null,phone:p.phone_number||null,phone_normalized:normalizePhone(p.phone_number),email:p.email||null,website_url:p.website_url||null,instagram_url:p.instagram_url||null,x_url:p.x_url||null,snapchat_url:p.snapchat_url||null,tiktok_url:p.tiktok_url||null,latitude:p.latitude||place.latitude||null,longitude:p.longitude||place.longitude||null,rating:Number.isFinite(Number(p.rating))?Number(p.rating):null,place_status:p.status||null,ecommerce_score:q.score,qualification_evidence:{signals:q.evidence,source:'hudhud_places',review_only:true},raw_payload:p,last_discovered_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      const {error}=await db.from('hudhud_lead_candidates').upsert(row,{onConflict:'hudhud_place_id'});if(!error)saved++;
    }
    await db.from('hudhud_lead_scans').update({status:'completed',places_found:places.length,places_enriched:enriched,candidates_saved:saved,finished_at:new Date().toISOString()}).eq('id',scan.id);
    return json({ok:true,data:{scan_id:scan.id,city:city.label,category,places_found:places.length,places_enriched:enriched,candidates_saved:saved}});
  }catch(e){const message=e instanceof Error?e.message:'scan_failed';await db.from('hudhud_lead_scans').update({status:'failed',error_summary:message,finished_at:new Date().toISOString()}).eq('id',scan.id);return json({ok:false,error:message},502);}
});
