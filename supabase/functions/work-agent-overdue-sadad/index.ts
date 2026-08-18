import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { riyadhDateKey, sha256Hex } from '../_shared/idempotency.ts';

const cors = { 'Access-Control-Allow-Origin':'https://shipaudit-five.vercel.app', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const norm = (v: unknown) => String(v || '').replace(/\D/g,'');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:cors});
  const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(()=>({}));
  const cronKey = req.headers.get('x-cron-key') || '';
  const { data: secret } = await db.from('zoho_auth').select('cron_key').eq('id',1).maybeSingle();
  const scheduled = !!secret?.cron_key && cronKey === secret.cron_key;
  let userId: string|null = null;
  if (!scheduled) {
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    const { data:{user} }=await db.auth.getUser(token); userId=user?.id||null;
    if (!userId) return json({ok:false,error:'unauthorized'},401);
    const { data:p }=await db.from('profiles').select('role,permissions').eq('id',userId).maybeSingle();
    const permission=body.action==='preview'?'agents.view':'agents.run';
    if (p?.role!=='admin' && !p?.permissions?.[permission]) return json({ok:false,error:'forbidden'},403);
  }
  const { data:agent,error:agentError }=await db.from('work_agents').select('*').eq('agent_key','overdue_sadad').single();
  if (agentError) return json({ok:false,error:agentError.message},500);
  if (scheduled && agent.status!=='active') return json({ok:true,skipped:true,reason:'paused'});
  const c=agent.config||{};
  const { data:raw,error }=await db.rpc('work_agent_overdue_candidates',{
    p_min_days:Number(c.min_overdue_days||30),p_min_balance:Number(c.min_balance||0.5),p_limit:Number(c.max_recipients||500)
  });
  if (error) return json({ok:false,error:error.message},500);
  const byPhone=new Map<string,any>(); let missingPhone=0;
  for (const r of raw||[]) {
    const phone=norm(r.phone); if (!phone || phone.length<11) { missingPhone++; continue; }
    const prior=byPhone.get(phone);
    if (prior) { prior.owed+=Number(r.owed||0); prior.invoice_count+=Number(r.invoice_count||0); prior.customers.push(r.customer_name); }
    else byPhone.set(phone,{...r,phone,owed:Number(r.owed||0),invoice_count:Number(r.invoice_count||0),customers:[r.customer_name]});
  }
  const candidates=[...byPhone.values()];
  if (body.action==='preview') return json({
    ok:true,total:candidates.length,missing_phone:missingPhone,
    total_owed:candidates.reduce((s,r)=>s+r.owed,0),
    items:candidates.map(r=>({
      customer_name:r.customer_name,store_name:r.store_name,phone:r.phone,
      owed:r.owed,invoice_count:r.invoice_count,oldest_due:r.oldest_due,
    })),
  });

  const now=new Date();
  const cycle=riyadhDateKey(now);
  const campaignName=`وكيل سداد المتأخرات ${cycle}`;
  const recipients=candidates.map(r=>({to:r.phone,name:r.store_name||r.customer_name,amount:r.owed,
    vars:[r.store_name||r.customer_name,r.owed.toLocaleString('en-US',{maximumFractionDigits:2}),String(r.invoice_count)],
    idempotency_ref:`work-agent:overdue-sadad:${cycle}:${r.phone}`}));
  const batches=[];
  for(let i=0;i<recipients.length;i+=100) batches.push(recipients.slice(i,i+100));
  const inputHash=await sha256Hex(recipients);
  const runKey=`work-agent:overdue-sadad:${cycle}:${inputHash}`;
  try {
    const totalOwed=candidates.reduce((s,r)=>s+r.owed,0);
    const {data:claimed,error:claimError}=await db.rpc('enqueue_idempotent_work_agent_campaign',{
      p_agent_id:agent.id,p_idempotency_key:runKey,p_trigger_type:scheduled?'schedule':'manual',
      p_checked_count:(raw||[]).length,p_action_count:recipients.length,
      p_summary:`جُدولت ${recipients.length} رسالة سداد`,
      p_details:{cycle,missing_phone:missingPhone,total_owed:totalOwed},p_approved_by:userId,
      p_template_name:'sadad',p_bucket_label:campaignName,p_batches:batches,
    });
    if(claimError) throw claimError;
    if(claimed?.inserted===true&&recipients.length) fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/campaign-runner`,{method:'POST',headers:{'Content-Type':'application/json','X-Cron-Key':secret?.cron_key||''},body:'{}'}).catch(()=>{});
    return json({ok:true,queued:claimed?.inserted===true?recipients.length:0,duplicate:claimed?.inserted!==true,missing_phone:missingPhone,total_owed:totalOwed,run_id:claimed?.run_id,queue_rows:claimed?.queue_rows||0});
  } catch(e) {
    const message=String((e as Error).message||e);
    return json({ok:false,error:message},500);
  }
});
