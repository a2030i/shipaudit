import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // Verify caller is admin
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const { data: callerProfile } = await callerClient.from('profiles').select('role').eq('id', caller.id).single()
    if (callerProfile?.role !== 'admin')
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: cors })

    const { email, password, name, role } = await req.json()
    if (!email || !password || !name || !role)
      return new Response(JSON.stringify({ error: 'email, password, name, role are required' }), { status: 400, headers: cors })

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Create the auth user
    const { data, error } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { name },
    })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors })

    // Upsert profile (trigger may or may not have run yet)
    await adminClient.from('profiles').upsert({
      id: data.user.id,
      email,
      name,
      role,
    }, { onConflict: 'id' })

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors })
  }
})
