import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return json({ error: 'Unauthorized' }, 401);

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { attachment_id } = await req.json();
    if (!attachment_id) return json({ error: 'attachment_id required' }, 400);

    // Load attachment record
    const { data: att, error: attErr } = await adminClient
      .from('attachments').select('*').eq('id', attachment_id).single();
    if (attErr || !att) return json({ error: 'Attachment not found' }, 404);

    // If already downloaded, return signed URL directly
    if (att.storage_path) {
      const { data } = await adminClient.storage
        .from('task-files').createSignedUrl(att.storage_path, 3600);
      return json({ url: data?.signedUrl ?? null });
    }

    if (!att.gmail_msg_id || !att.gmail_attachment_id)
      return json({ error: 'No Gmail reference stored for this attachment' }, 400);

    // Get Gmail token
    const { data: conn, error: connErr } = await adminClient
      .from('gmail_connections').select('*').eq('user_id', user.id).single();
    if (connErr || !conn) return json({ error: 'No Gmail connection found' }, 404);

    const expiry = conn.token_expiry ? new Date(conn.token_expiry) : null;
    let token = conn.access_token;
    if (!expiry || expiry.getTime() < Date.now() + 5 * 60 * 1000) {
      const [{ data: cidRow }, { data: csecRow }] = await Promise.all([
        adminClient.from('app_settings').select('value').eq('key', 'GOOGLE_CLIENT_ID').single(),
        adminClient.from('app_settings').select('value').eq('key', 'GOOGLE_CLIENT_SECRET').single(),
      ]);
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cidRow?.value, client_secret: csecRow?.value,
          refresh_token: conn.refresh_token, grant_type: 'refresh_token',
        }),
      });
      const td = await res.json();
      if (td.error) return json({ error: td.error_description || td.error }, 500);
      token = td.access_token;
      await adminClient.from('gmail_connections').update({
        access_token: token,
        token_expiry: new Date(Date.now() + (td.expires_in ?? 3600) * 1000).toISOString(),
      }).eq('id', conn.id);
    }

    // Fetch attachment data from Gmail
    const gmailRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${att.gmail_msg_id}/attachments/${att.gmail_attachment_id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const gmailData = await gmailRes.json();
    if (!gmailData.data) return json({ error: 'Gmail returned no data' }, 502);

    const b64 = (gmailData.data as string).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));

    const safeName = att.filename.replace(/[^a-zA-Z0-9._\-؀-ۿ]/g, '_');
    const path = `${att.task_id}/${Date.now()}_${safeName}`;
    const { error: upErr } = await adminClient.storage
      .from('task-files')
      .upload(path, bytes.buffer, { contentType: att.file_type === 'pdf' ? 'application/pdf' : 'application/octet-stream', upsert: true });
    if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

    await adminClient.from('attachments').update({ storage_path: path }).eq('id', attachment_id);

    const { data: signed } = await adminClient.storage
      .from('task-files').createSignedUrl(path, 3600);
    return json({ url: signed?.signedUrl ?? null });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
