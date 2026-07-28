import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  let returnUrl = 'http://localhost:5173';
  let userId = '';

  try {
    if (state) {
      const parsed = JSON.parse(atob(state));
      returnUrl = parsed.returnUrl || returnUrl;
      userId    = parsed.userId || '';
    }
  } catch { /* ignore */ }

  if (error) {
    return Response.redirect(`${returnUrl}?gmail_error=${encodeURIComponent(error)}`);
  }
  if (!code || !userId) {
    return Response.redirect(`${returnUrl}?gmail_error=missing_params`);
  }

  try {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [{ data: cidRow }, { data: csecRow }] = await Promise.all([
      adminClient.from('app_settings').select('value').eq('key', 'GOOGLE_CLIENT_ID').single(),
      adminClient.from('app_settings').select('value').eq('key', 'GOOGLE_CLIENT_SECRET').single(),
    ]);

    const clientId     = cidRow?.value;
    const clientSecret = csecRow?.value;
    if (!clientId || !clientSecret) {
      return Response.redirect(`${returnUrl}?gmail_error=credentials_missing`);
    }

    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) {
      return Response.redirect(`${returnUrl}?gmail_error=${encodeURIComponent(tokens.error_description || tokens.error)}`);
    }

    // Get Gmail address
    const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const gmailProfile = await profileRes.json();
    const gmailAddress = gmailProfile.emailAddress || 'unknown';

    const expiryTime = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

    const { error: upsertErr } = await adminClient.from('gmail_connections').upsert({
      user_id:       userId,
      gmail_address: gmailAddress,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry:  expiryTime.toISOString(),
    }, { onConflict: 'user_id' });

    if (upsertErr) {
      return Response.redirect(`${returnUrl}?gmail_error=${encodeURIComponent(upsertErr.message)}`);
    }

    return Response.redirect(`${returnUrl}?gmail_connected=1`);
  } catch (e) {
    return Response.redirect(`${returnUrl}?gmail_error=${encodeURIComponent(e.message)}`);
  }
});
