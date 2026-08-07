import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'https://shipaudit-five.vercel.app','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);const input=await req.json().catch(()=>({}));
 const {data:secret}=await db.from('zoho_auth').select('cron_key').eq('id',1).maybeSingle();const cron=!!secret?.cron_key&&req.headers.get('x-cron-key')===secret.cron_key;let userId=null;
 if(!cron){const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');const {data:{user}}=await db.auth.getUser(token);userId=user?.id||null;if(!userId)return json({ok:false,error:'unauthorized'},401);const {data:p}=await db.from('profiles').select('role,permissions').eq('id',userId).maybeSingle();const perm=input.action==='preview'?'agents.view':'agents.run';if(p?.role!=='admin'&&!p?.permissions?.[perm])return json({ok:false,error:'forbidden'},403);}
 const {data:agent}=await db.from('work_agents').select('*').eq('agent_key','management_daily_report').single();if(cron&&agent.status!=='active')return json({ok:true,skipped:true,reason:'paused'});
 const {data:snapshot,error}=await db.rpc('management_daily_snapshot');if(error)return json({ok:false,error:error.message},500);if(input.action==='preview')return json({ok:true,preview:true,snapshot});
 const summary=`متأخرات ${Number(snapshot.overdue_amount||0).toLocaleString('en-US',{maximumFractionDigits:2})} ر.س · زاتكا ${snapshot.zatca_pending} · عملاء جدد ${snapshot.new_leads_today} · مهام متأخرة ${snapshot.overdue_tasks}`;
 const {data:run,error:runError}=await db.from('work_agent_runs').insert({agent_id:agent.id,status:'succeeded',trigger_type:cron?'schedule':'manual',finished_at:new Date().toISOString(),checked_count:Number(snapshot.overdue_invoices||0)+Number(snapshot.new_leads_today||0)+Number(snapshot.overdue_tasks||0),action_count:1,summary,details:{report_type:'management_daily',snapshot},approved_by:userId}).select('id').single();if(runError)return json({ok:false,error:runError.message},500);
 const nextRun=new Date();nextRun.setUTCDate(nextRun.getUTCDate()+1);nextRun.setUTCHours(7,0,0,0);
 await db.from('work_agents').update({last_run_at:new Date().toISOString(),next_run_at:nextRun.toISOString()}).eq('id',agent.id);return json({ok:true,run_id:run.id,summary,snapshot});
});
