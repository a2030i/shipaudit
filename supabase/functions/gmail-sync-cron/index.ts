import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Accept service role key OR anon key (pg_cron uses anon key; direct calls use service role)
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== serviceKey && token !== anonKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceKey);

  // Get all active Gmail connections
  const { data: connections, error } = await adminClient
    .from('gmail_connections')
    .select('user_id')
    .not('refresh_token', 'is', null);

  if (error || !connections?.length) {
    return new Response(JSON.stringify({ message: 'No active connections', error: error?.message }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Sync each user sequentially to avoid overloading
  const results: { user_id: string; ok: boolean; error?: string }[] = [];
  for (const { user_id } of connections) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/gmail-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ cron_user_id: user_id }),
      });
      // gmail-sync streams NDJSON — just drain it
      await res.body?.cancel();
      results.push({ user_id, ok: res.ok });
    } catch (e: any) {
      results.push({ user_id, ok: false, error: e.message });
    }
  }

  return new Response(JSON.stringify({ synced: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
