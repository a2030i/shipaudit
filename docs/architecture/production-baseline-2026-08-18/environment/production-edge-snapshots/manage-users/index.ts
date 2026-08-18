// manage-users â€” admin-only CRUD for employee accounts.
//
// Roles: 'admin' | 'accountant' (the 3-role accountant1/accountant2
// split was collapsed; the granular permissions JSONB on profiles
// replaces the role tiers).

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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    const { data: caller } = await userClient
      .from('profiles').select('role').eq('id', user.id).single();
    if (caller?.role !== 'admin') throw new Error('Ù…Ø³Ù…ÙˆØ­ Ù„Ù„Ù…Ø¯ÙŠØ± ÙÙ‚Ø·');

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const body        = await req.json();
    const { action }  = body;

    // â”€â”€ Create â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (action === 'create') {
      const { email, password, name, role, avatar_color, permissions, lead_notification_phone, accepts_campaign_leads } = body;
      if (!email || !password) throw new Error('Ø§Ù„Ø¨Ø±ÙŠØ¯ ÙˆÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ù…Ø·Ù„ÙˆØ¨Ø§Ù†');

      // Normalise legacy role names from any stale UI version still
      // sending accountant1/accountant2.
      const safeRole = (role === 'admin') ? 'admin' : 'accountant';

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
        role:         safeRole,
        avatar_color: avatar_color || '#38bdf8',
        permissions:  (permissions && typeof permissions === 'object') ? permissions : {},
        lead_notification_phone: lead_notification_phone || null,
        accepts_campaign_leads: accepts_campaign_leads === true,
      });

      return new Response(JSON.stringify({ success: true, user_id: data.user.id }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // â”€â”€ Delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (action === 'delete') {
      const { user_id } = body;
      if (user_id === user.id) throw new Error('Ù„Ø§ ÙŠÙ…ÙƒÙ†Ùƒ Ø­Ø°Ù Ø­Ø³Ø§Ø¨Ùƒ Ø§Ù„Ø­Ø§Ù„ÙŠ');

      // FKs that referenced profiles with ON DELETE NO ACTION used to
      // block this. The 2026-05-23 migration converted them to ON
      // DELETE SET NULL, so the auth.users delete now cascades cleanly
      // through profiles and audits / tasks / task_actions just lose
      // the user attribution (rows preserved).
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


