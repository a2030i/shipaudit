import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify caller is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    const { data: caller } = await userClient
      .from('profiles').select('role').eq('id', user.id).single();
    if (caller?.role !== 'admin') throw new Error('مسموح للمدير فقط');

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const body        = await req.json();
    const { action }  = body;

    // ── Create ──────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { email, password, name, role, avatar_color } = body;
      if (!email || !password) throw new Error('البريد وكلمة المرور مطلوبان');

      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (error) throw error;

      await adminClient.from('profiles').upsert({
        id:           data.user.id,
        email,
        name:         name || email,
        role:         role || 'accountant1',
        avatar_color: avatar_color || '#38bdf8',
      });

      return new Response(JSON.stringify({ success: true, user_id: data.user.id }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Delete ──────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { user_id } = body;
      if (user_id === user.id) throw new Error('لا يمكنك حذف حسابك الحالي');

      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
