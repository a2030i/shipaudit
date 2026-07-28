import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_PER_RUN = 100; // messages per HTTP call (keep runs well under 150s)

async function refreshAccessToken(adminClient: any, conn: any): Promise<string> {
  const [{ data: cidRow }, { data: csecRow }] = await Promise.all([
    adminClient.from('app_settings').select('value').eq('key', 'GOOGLE_CLIENT_ID').single(),
    adminClient.from('app_settings').select('value').eq('key', 'GOOGLE_CLIENT_SECRET').single(),
  ]);
  const clientId     = cidRow?.value;
  const clientSecret = csecRow?.value;
  if (!clientId || !clientSecret) throw new Error('Google credentials not configured');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: conn.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);

  const expiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  await adminClient.from('gmail_connections').update({
    access_token: data.access_token,
    token_expiry: expiry.toISOString(),
  }).eq('id', conn.id);

  return data.access_token;
}

async function getValidToken(adminClient: any, conn: any): Promise<string> {
  const expiry = conn.token_expiry ? new Date(conn.token_expiry) : null;
  const needsRefresh = !expiry || expiry.getTime() < Date.now() + 5 * 60 * 1000;
  if (needsRefresh) return await refreshAccessToken(adminClient, conn);
  return conn.access_token;
}

function decodeB64(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  try {
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return binary;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&zwnj;/gi, '')
    .replace(/&zwj;/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[​-‍﻿]/g, '');
}

function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanPlainText(s: string): string {
  return decodeEntities(s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/-->/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBody(payload: any): { text: string; html: string | null } {
  if (!payload) return { text: '', html: null };
  if (payload.body?.data) {
    const decoded = decodeB64(payload.body.data);
    const mime = (payload.mimeType ?? '').toLowerCase();
    if (mime.includes('html')) return { text: stripHtml(decoded), html: decoded };
    return { text: cleanPlainText(decoded), html: null };
  }
  if (payload.parts) {
    let plainText: string | null = null;
    let htmlRaw:   string | null = null;
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data && !plainText)
        plainText = cleanPlainText(decodeB64(part.body.data));
      if (part.mimeType === 'text/html' && part.body?.data && !htmlRaw)
        htmlRaw = decodeB64(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/') && part.parts) {
        const nested = extractBody(part);
        if (nested.text && !plainText) plainText = nested.text;
        if (nested.html && !htmlRaw)   htmlRaw   = nested.html;
      }
    }
    if (plainText) return { text: plainText, html: htmlRaw };
    if (htmlRaw)   return { text: stripHtml(htmlRaw), html: htmlRaw };
  }
  return { text: '', html: null };
}

interface AttMeta { filename: string; mimeType: string; size: number; data?: string; attachmentId?: string; }

function collectAttachments(payload: any): AttMeta[] {
  const results: AttMeta[] = [];
  const walk = (p: any) => {
    if (!p) return;
    if (p.filename && p.filename.length > 0 && p.body) {
      const ext = p.filename.toLowerCase();
      const mime = (p.mimeType ?? '').toLowerCase();
      const isUseful = ext.match(/\.(xlsx?|csv|pdf)$/)
        || mime.includes('spreadsheet') || mime.includes('excel')
        || mime.includes('pdf') || mime.includes('csv');
      if (isUseful) {
        const att: AttMeta = {
          filename: p.filename,
          mimeType: p.mimeType ?? 'application/octet-stream',
          size: p.body.size ?? 0,
        };
        if (p.body.data)         att.data         = p.body.data;
        if (p.body.attachmentId) att.attachmentId = p.body.attachmentId;
        if (att.data || att.attachmentId) results.push(att);
      }
    }
    if (p.parts) for (const sub of p.parts) walk(sub);
  };
  walk(payload);
  return results;
}

function detectAttachments(payload: any): { has_excel: boolean; has_pdf: boolean } {
  const atts = collectAttachments(payload);
  return {
    has_excel: atts.some(a => a.filename.toLowerCase().match(/\.(xlsx?|csv)$/)
      || a.mimeType.includes('spreadsheet') || a.mimeType.includes('excel')),
    has_pdf:   atts.some(a => a.filename.toLowerCase().endsWith('.pdf')
      || a.mimeType.includes('pdf')),
  };
}

// Full attachment download: inline → immediate, external ref → Gmail API call
async function syncAttachments(
  taskId: string, msgId: string, atts: AttMeta[],
  token: string, adminClient: any
) {
  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  for (const att of atts) {
    try {
      const ext = att.filename.toLowerCase().split('.').pop() ?? '';
      const fileType = ['xlsx','xls','csv'].includes(ext) ? 'excel' : ext === 'pdf' ? 'pdf' : 'other';

      if (att.size > MAX_SIZE) {
        if (att.attachmentId) {
          await adminClient.from('attachments').insert({
            task_id: taskId, filename: att.filename, file_type: fileType,
            file_size: att.size, gmail_msg_id: msgId, gmail_attachment_id: att.attachmentId,
          });
        }
        continue;
      }

      let bytes: Uint8Array;
      if (att.data) {
        const bin = atob(att.data.replace(/-/g, '+').replace(/_/g, '/'));
        bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      } else if (att.attachmentId) {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${att.attachmentId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const j = await res.json();
        if (!j.data) continue;
        const bin = atob(j.data.replace(/-/g, '+').replace(/_/g, '/'));
        bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      } else continue;

      const safeName = att.filename.replace(/[^a-zA-Z0-9._\-؀-ۿ]/g, '_');
      const path = `${taskId}/${Date.now()}_${safeName}`;
      const { error: upErr } = await adminClient.storage
        .from('task-files')
        .upload(path, bytes.buffer, { contentType: att.mimeType, upsert: true });

      await adminClient.from('attachments').insert({
        task_id: taskId, filename: att.filename, file_type: fileType,
        file_size: att.size, gmail_msg_id: msgId,
        storage_path: upErr ? null : path,
        gmail_attachment_id: att.attachmentId ?? null,
      });
    } catch { /* ignore individual attachment errors */ }
  }
}

// ── Sync rules ────────────────────────────────────────────────────────────────
function matchesRule(rule: any, email: {
  fromEmail: string; fromDomain: string;
  subject: string; body: string;
  hasAttachment: boolean; hasExcel: boolean; hasPdf: boolean;
}): boolean {
  const val = (rule.cond_value ?? '').toLowerCase();
  let field: string;
  switch (rule.cond_field) {
    case 'from_email':     field = email.fromEmail.toLowerCase();  break;
    case 'from_domain':    field = email.fromDomain.toLowerCase(); break;
    case 'subject':        field = email.subject.toLowerCase();    break;
    case 'body':           field = email.body.toLowerCase();       break;
    case 'has_attachment': return email.hasAttachment;
    case 'has_excel':      return email.hasExcel;
    case 'has_pdf':        return email.hasPdf;
    case 'no_attachment':  return !email.hasAttachment;
    case 'no_excel':       return !email.hasExcel;
    case 'no_pdf':         return !email.hasPdf;
    default:               return false;
  }
  switch (rule.cond_op) {
    case 'contains':    return field.includes(val);
    case 'equals':      return field === val;
    case 'starts_with': return field.startsWith(val);
    case 'ends_with':   return field.endsWith(val);
    case 'is_true':     return true;
    default:            return false;
  }
}

function evaluateRules(rules: any[], emailData: any): {
  block: boolean; priority: string; assignRole: string | null; assignEmployeeId: string | null;
} {
  let priority = 'normal';
  let assignRole: string | null = null;
  let assignEmployeeId: string | null = null;
  for (const rule of rules) {
    if (!matchesRule(rule, emailData)) continue;
    if (rule.action === 'block')            return { block: true, priority, assignRole, assignEmployeeId };
    if (rule.action === 'set_priority')     priority          = rule.action_value || 'normal';
    if (rule.action === 'assign_role')      assignRole        = rule.action_value || null;
    if (rule.action === 'assign_employee')  assignEmployeeId  = rule.action_value || null;
  }
  return { block: false, priority, assignRole, assignEmployeeId };
}

async function aiClassify(subject: string, body: string, apiKey: string): Promise<{
  priority?: string; summary?: string; block?: boolean;
} | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [{
          role: 'user',
          content: `أنت مساعد لتصنيف إيميلات شركة شحن ولوجستيات. صنّف هذا الإيميل وأجب بـ JSON فقط بدون أي نص إضافي.\nالموضوع: ${subject}\nالمحتوى: ${body.slice(0, 600)}\n\nأجب بهذا التنسيق الحرفي:\n{"priority":"low|normal|high|urgent","summary":"ملخص قصير بالعربي بجملة واحدة","block":false}\n\n- block: true فقط إذا كان الإيميل إعلاناً أو spam أو غير ذي صلة بالعمل`,
        }],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function fetchAllMessageIds(token: string, query: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: '500' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.messages) for (const m of data.messages) ids.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader  = req.headers.get('Authorization')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isCronCall  = authHeader === `Bearer ${serviceKey}`;

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

    let userId: string;
    if (isCronCall) {
      const cronBody = await req.json().catch(() => ({}));
      if (!cronBody.cron_user_id)
        return new Response(JSON.stringify({ error: 'cron_user_id required' }), { status: 400, headers: CORS });
      userId = cronBody.cron_user_id;
      (req as any)._parsedBody = cronBody;
    } else {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: uErr } = await supabase.auth.getUser();
      if (uErr || !user)
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
      userId = user.id;
    }

    const { data: conn, error: connErr } = await adminClient
      .from('gmail_connections').select('*').eq('user_id', userId).single();
    if (connErr || !conn)
      return new Response(JSON.stringify({ error: 'No Gmail connection found' }), {
        status: 404, headers: { ...CORS, 'Content-Type': 'application/json' }
      });

    const body = (req as any)._parsedBody
      ?? (req.method === 'POST' ? await req.json().catch(() => ({})) : {});
    const fromDate: string | undefined = body.fromDate;
    const resume: boolean = body.resume === true;

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = async (obj: object) => {
      await writer.write(enc.encode(JSON.stringify(obj) + '\n'));
    };

    (async () => {
      try {
        const token = await getValidToken(adminClient, conn);

        let toInsert: string[];
        let toFix: Map<string, string>;
        let grandTotal: number;
        let gmailTotal: number;
        let alreadyDone: number;
        let alreadyCreated: number;

        const [{ data: rulesData }, { data: aiToggleRow }, { data: orKeyRow }] = await Promise.all([
          adminClient.from('sync_rules').select('*').eq('enabled', true).order('sort_order'),
          adminClient.from('app_settings').select('value').eq('key', 'AI_AUTO_CLASSIFY').maybeSingle(),
          adminClient.from('app_settings').select('value').eq('key', 'OPENROUTER_API_KEY').maybeSingle(),
        ]);
        const syncRules: any[] = rulesData ?? [];
        const aiAutoClassify   = aiToggleRow?.value === 'true';
        const openrouterKey    = orKeyRow?.value ?? '';
        const blockedIds       = new Set<string>(conn.blocked_msg_ids ?? []);
        const blockedThisRun   = new Set<string>();

        const { data: allProfiles } = await adminClient
          .from('profiles').select('id, role').neq('role', 'admin');
        const roleToProfileId = new Map<string, string>();
        const idToRole        = new Map<string, string>();
        for (const p of allProfiles ?? []) {
          if (!roleToProfileId.has(p.role)) roleToProfileId.set(p.role, p.id);
          idToRole.set(p.id, p.role);
        }

        if (resume && conn.sync_state) {
          const st = conn.sync_state as any;
          toInsert      = st.toInsert      ?? [];
          toFix         = new Map(Object.entries(st.toFix ?? {}));
          grandTotal    = st.total         ?? 0;
          gmailTotal    = st.gmail_total   ?? 0;
          alreadyDone   = st.done          ?? 0;
          alreadyCreated = st.created      ?? 0;
          await send({ type: 'resume', done: alreadyDone, total: grandTotal, gmail_total: gmailTotal });
        } else {
          let query = 'in:inbox';
          if (fromDate) query += ` after:${fromDate.replace(/-/g, '/')}`;

          await send({ type: 'fetching' });
          const messageIds = await fetchAllMessageIds(token, query);
          gmailTotal = messageIds.length;

          const existingMap = new Map<string, { id: string; email_body: string | null; has_excel: boolean; has_pdf: boolean }>();
          for (let i = 0; i < messageIds.length; i += 500) {
            const chunk = messageIds.slice(i, i + 500);
            const { data: rows } = await adminClient
              .from('tasks').select('id, external_id, email_body, has_excel, has_pdf').in('external_id', chunk);
            for (const row of rows ?? [])
              existingMap.set(row.external_id, { id: row.id, email_body: row.email_body, has_excel: !!row.has_excel, has_pdf: !!row.has_pdf });
          }

          const flaggedTaskIds = [...existingMap.values()]
            .filter(v => v.has_excel || v.has_pdf)
            .map(v => v.id);
          const hasAttachmentSet = new Set<string>();
          for (let i = 0; i < flaggedTaskIds.length; i += 50) {
            const chunk = flaggedTaskIds.slice(i, i + 50);
            const { data: rows } = await adminClient
              .from('attachments')
              .select('task_id, storage_path, gmail_attachment_id')
              .in('task_id', chunk);
            for (const r of rows ?? []) {
              if (r.storage_path !== null || r.gmail_attachment_id !== null)
                hasAttachmentSet.add(r.task_id);
            }
          }

          toInsert = [];
          toFix = new Map();
          for (const msgId of messageIds) {
            const ex = existingMap.get(msgId);
            if (!ex) {
              if (!blockedIds.has(msgId)) toInsert.push(msgId);
            } else {
              const missingAtts = (ex.has_excel || ex.has_pdf) && !hasAttachmentSet.has(ex.id);
              if (missingAtts) toFix.set(msgId, ex.id);
            }
          }

          grandTotal    = toInsert.length + toFix.size;
          alreadyDone   = 0;
          alreadyCreated = 0;
          await send({ type: 'start', total: grandTotal, gmail_total: gmailTotal });
        }

        let slots = MAX_PER_RUN;
        const insertThisRun: string[] = [];
        const fixThisRun: string[]    = [];

        for (const id of toInsert) {
          if (slots <= 0) break;
          insertThisRun.push(id); slots--;
        }
        for (const id of toFix.keys()) {
          if (slots <= 0) break;
          fixThisRun.push(id); slots--;
        }

        const toProcess = [...insertThisRun, ...fixThisRun];

        let created = alreadyCreated;
        let done    = alreadyDone;
        const errors: string[] = [];
        const BATCH = 8;

        const remInsertSet = new Set(toInsert);
        const remFixMap    = new Map(toFix);

        const processOne = async (msgId: string) => {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            const msgData = await msgRes.json();

            const hdrs: Record<string, string> = {};
            for (const h of msgData.payload?.headers ?? [])
              hdrs[h.name.toLowerCase()] = h.value;

            const subject   = hdrs['subject'] ?? '(بدون موضوع)';
            const fromRaw   = hdrs['from'] ?? '';
            const fromMatch = fromRaw.match(/^(?:"?(.+?)"?\s*<)?([^>]+)>?$/);
            const fromName  = (fromMatch?.[1] ?? fromRaw).trim();
            const fromEmail = (fromMatch?.[2] ?? fromRaw).trim();
            const bodyResult = extractBody(msgData.payload);
            const emailBody = bodyResult.text.slice(0, 4000);
            const emailHtml = bodyResult.html ? bodyResult.html.slice(0, 200000) : null;
            const sentDate  = hdrs['date'] ? new Date(hdrs['date']).toISOString() : new Date().toISOString();
            const { has_excel, has_pdf } = detectAttachments(msgData.payload);
            const atts = collectAttachments(msgData.payload);

            const fixId = toFix.get(msgId);
            let finalPriority = 'normal';
            let assignedTo: string | null = null;
            let aiSummaryText: string | null = null;

            if (!fixId) {
              const emailData = {
                fromEmail, fromDomain: fromEmail.split('@').pop() ?? '',
                subject, body: emailBody,
                hasAttachment: has_excel || has_pdf,
                hasExcel: has_excel, hasPdf: has_pdf,
              };
              const ruleResult = evaluateRules(syncRules, emailData);

              if (ruleResult.block) {
                blockedThisRun.add(msgId);
                return;
              }

              finalPriority = ruleResult.priority;
              if (ruleResult.assignEmployeeId) {
                assignedTo = ruleResult.assignEmployeeId;
              } else if (ruleResult.assignRole) {
                assignedTo = roleToProfileId.get(ruleResult.assignRole) ?? null;
              }

              if (aiAutoClassify && openrouterKey) {
                const ai = await aiClassify(subject, emailBody, openrouterKey);
                if (ai) {
                  if (ai.block) { blockedThisRun.add(msgId); return; }
                  if (ai.priority) finalPriority = ai.priority;
                  if (ai.summary)  aiSummaryText = ai.summary;
                }
              }
            }

            if (fixId) {
              await adminClient.from('tasks')
                .update({ email_body: emailBody, email_html: emailHtml, has_excel, has_pdf })
                .eq('id', fixId);
              if (atts.length > 0) {
                const isUsable = (r: any) => r.storage_path !== null || r.gmail_attachment_id !== null;
                const { data: existingAtts } = await adminClient
                  .from('attachments').select('storage_path, gmail_attachment_id')
                  .eq('task_id', fixId);
                const goodCount = (existingAtts ?? []).filter(isUsable).length;
                if (!goodCount) {
                  await adminClient.from('attachments').delete()
                    .eq('task_id', fixId).is('storage_path', null);
                  await syncAttachments(fixId, msgId, atts, token, adminClient);
                  const { data: afterAtts } = await adminClient
                    .from('attachments').select('storage_path, gmail_attachment_id')
                    .eq('task_id', fixId);
                  if (!(afterAtts ?? []).some(isUsable)) {
                    await adminClient.from('tasks')
                      .update({ has_excel: false, has_pdf: false })
                      .eq('id', fixId);
                  }
                }
              }
            } else {
              const { data: task, error: taskErr } = await adminClient
                .from('tasks')
                .insert({
                  email_subject:   subject,
                  email_from:      fromEmail,
                  email_from_name: fromName,
                  email_body:      emailBody,
                  email_html:      emailHtml,
                  email_date:      sentDate,
                  status:          assignedTo
                    ? (idToRole.get(assignedTo) === 'accountant2' ? 'pending_acc2' : 'pending_acc1')
                    : 'unassigned',
                  priority:        finalPriority ?? 'normal',
                  created_by:      userId,
                  external_id:     msgId,
                  source:          'gmail',
                  has_excel,
                  has_pdf,
                  assigned_to:     assignedTo,
                  ai_summary:      aiSummaryText,
                })
                .select().single();

              if (taskErr) {
                errors.push(taskErr.message);
              } else if (task) {
                await adminClient.from('task_actions').insert({
                  task_id: task.id, user_id: userId, action: 'created',
                  notes: `استيراد تلقائي من Gmail: ${subject}`,
                });
                created++;
                if (atts.length > 0)
                  await syncAttachments(task.id, msgId, atts, token, adminClient);
              }
            }
          } catch (e: any) {
            errors.push(e.message);
          }
          done++;
          remInsertSet.delete(msgId);
          remFixMap.delete(msgId);
          await send({ type: 'progress', done, total: grandTotal });
        };

        for (let i = 0; i < toProcess.length; i += BATCH) {
          await Promise.all(toProcess.slice(i, i + BATCH).map(processOne));

          const remInsert = toInsert.filter(id => remInsertSet.has(id));
          const remFix: Record<string, string> = {};
          for (const [k, v] of remFixMap) remFix[k] = v;
          const checkpoint = remInsert.length + Object.keys(remFix).length;
          if (checkpoint > 0) {
            await adminClient.from('gmail_connections').update({
              sync_state: {
                toInsert: remInsert, toFix: remFix,
                total: grandTotal, gmail_total: gmailTotal, done, created,
              },
            }).eq('id', conn.id);
          }
        }

        const remInsertFinal = toInsert.filter(id => remInsertSet.has(id));
        const remFixFinal: Record<string, string> = {};
        for (const [k, v] of remFixMap) remFixFinal[k] = v;
        const remaining = remInsertFinal.length + Object.keys(remFixFinal).length;

        if (blockedThisRun.size > 0) {
          const allBlocked = [...blockedIds, ...blockedThisRun];
          await adminClient.from('gmail_connections')
            .update({ blocked_msg_ids: allBlocked })
            .eq('id', conn.id);
        }

        if (remaining > 0) {
          await adminClient.from('gmail_connections').update({
            sync_state: {
              toInsert: remInsertFinal, toFix: remFixFinal,
              total: grandTotal, gmail_total: gmailTotal, done, created,
            },
          }).eq('id', conn.id);
          await send({ type: 'partial', done, total: grandTotal, gmail_total: gmailTotal });
        } else {
          await adminClient.from('gmail_connections').update({
            last_sync_at: new Date().toISOString(),
            sync_state:   null,
          }).eq('id', conn.id);
          await send({ type: 'done', created, total: grandTotal, gmail_total: gmailTotal, errors });
        }
      } catch (e: any) {
        await send({ type: 'error', message: e.message });
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...CORS, 'Content-Type': 'application/x-ndjson' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
