// zoho-intake v4 — DEDICATED endpoint for Zoho-side report files.
//
// Separate from /webhook-intake on purpose (that one handles carrier
// emails → /webhook inbox). This one only ever touches
// zoho_intake_events and surfaces via /uploads.
//
// v4 changes (over v3):
//   • Acknowledges forwarder verification pings — e.g. InboxDone sends
//     { test: true, hasAttachments: false, attachments: [] } when the
//     operator first wires the URL. Returning 400 there would make
//     the wiring step fail; we now return 200 OK without persisting.
//
// v3 features kept:
//   • Multipart + URL-pointer attachments
//   • Nested envelopes (data / body / payload)
//   • Wildcard key scanning (attach* / file* / media* / doc*)
//   • Numbered Mailgun keys (attachment-1, attachment-2, ...)
//   • Base64 sniffing on string values
//   • Failure log into zoho_intake_failures for inspection
//
// Auth: x-zoho-intake-secret header must match ZOHO_INTAKE_SECRET env.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED_SECRET = Deno.env.get("ZOHO_INTAKE_SECRET") ?? "";
const BUCKET        = "zoho-intake";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-zoho-intake-secret, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const bin   = atob(clean);
  const arr   = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function sanitizeStorageName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file.bin";
}

function looksLikeBase64(s: string): boolean {
  if (typeof s !== 'string' || s.length < 200) return false;
  if (s.startsWith('data:')) return true;
  return /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 256));
}

function detectSource(fileName: string, subject: string): { source: string | null; method: string } {
  const blob = `${fileName} ${subject}`.toLowerCase();
  if (blob.includes("ملخص أرصدة الموردين") || blob.includes("ملخص ارصدة الموردين")
   || blob.includes("vendor balance") || blob.includes("vendor balances")) {
    return { source: "zoho_vendors", method: "subject" };
  }
  if (blob.includes("ملخص أرصدة العملاء") || blob.includes("ملخص ارصده العملاء")
   || blob.includes("ملخص ارصدة العملاء") || blob.includes("ملخص التزامات المستفيدين")
   || blob.includes("customer balance") || blob.includes("customer balances")) {
    return { source: "zoho_customers", method: "subject" };
  }
  if (blob.includes("تفاصيل الفاتورة") || blob.includes("تفاصيل الفواتير")
   || blob.includes("invoice detail") || blob.includes("invoice details")
   || blob.includes("فواتير الشهر")) {
    return { source: "receivables", method: "subject" };
  }
  return { source: null, method: "failed" };
}

type Attachment = { filename: string; content?: string; url?: string };

function extractFromObject(obj: any, items: Attachment[], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return;
  const filename = obj.filename ?? obj.name ?? obj.fileName ?? obj.file_name ?? obj.title;
  const content  = obj.content ?? obj.contentBytes ?? obj.data ?? obj.file_base64 ?? obj.base64;
  const url      = obj.url ?? obj.file_url ?? obj.download_url ?? obj.href ?? obj.link;
  if (filename && (content || url)) {
    if (content && typeof content === 'string') items.push({ filename: String(filename), content });
    else if (url  && typeof url === 'string')     items.push({ filename: String(filename), url });
    return;
  }
  const count = Number(obj['attachment-count'] ?? obj.attachmentCount ?? 0);
  if (count > 0) {
    for (let i = 1; i <= count; i++) {
      const k = `attachment-${i}`;
      const v = obj[k];
      if (v && typeof v === 'object') extractFromObject(v, items, depth + 1);
      else if (typeof v === 'string' && looksLikeBase64(v)) {
        items.push({ filename: `${k}.xlsx`, content: v });
      }
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (!v) continue;
    const lowK = k.toLowerCase();
    const isAttachmentish = /^(attach|file|media|doc|content|payload|message)/i.test(lowK);
    if (Array.isArray(v)) { for (const item of v) extractFromObject(item, items, depth + 1); continue; }
    if (typeof v === 'object') { extractFromObject(v, items, depth + 1); continue; }
    if (typeof v === 'string' && isAttachmentish && looksLikeBase64(v)) {
      items.push({ filename: `${k}.xlsx`, content: v });
    }
  }
}

function pickAttachments(payload: any): { items: Attachment[]; foundKeys: string[] } {
  const items: Attachment[] = [];
  extractFromObject(payload, items);
  const seen = new Set<string>();
  const dedup: Attachment[] = [];
  for (const a of items) {
    const key = `${a.filename}::${(a.content || a.url || '').slice(0, 64)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(a);
  }
  const foundKeys = (payload && typeof payload === 'object') ? Object.keys(payload) : [];
  return { items: dedup, foundKeys };
}

async function fetchAttachmentFromUrl(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function truncatePayload(p: any, max = 200): any {
  if (p === null || p === undefined) return p;
  if (typeof p === 'string') return p.length > max ? p.slice(0, max) + `… [+${p.length - max}]` : p;
  if (typeof p !== 'object') return p;
  if (Array.isArray(p)) return p.slice(0, 10).map((v) => truncatePayload(v, max));
  const out: any = {};
  for (const [k, v] of Object.entries(p)) out[k] = truncatePayload(v, max);
  return out;
}

async function logFailure(
  supabase: any, contentType: string, userAgent: string,
  payloadSize: number, payload: any, error: string, foundKeys: string[],
) {
  try {
    await supabase.from("zoho_intake_failures").insert({
      content_type: contentType, user_agent: userAgent,
      payload_size: payloadSize, payload: truncatePayload(payload),
      error, received_keys: foundKeys,
    });
  } catch { /* swallow */ }
}

// Forwarder verification pings — InboxDone/Make/Zapier all send a
// trial payload when the operator first wires the URL. Hallmarks:
//   { test: true }                                — InboxDone test
//   { hasAttachments: false, attachments: [] }    — same
//   { ping: true } / { verify: true }             — generic
//   { event: "webhook.verify" }                   — some platforms
function isVerificationPing(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.test === true || payload.ping === true || payload.verify === true) return true;
  if (payload.event && /verify|ping|test/i.test(String(payload.event))) return true;
  if (payload.hasAttachments === false) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET")     return json({ ok: true, hint: "POST a JSON or multipart payload" });
  if (req.method !== "POST")    return json({ error: "method-not-allowed" }, 405);

  if (SHARED_SECRET) {
    const incoming = req.headers.get("x-zoho-intake-secret") ?? "";
    if (incoming !== SHARED_SECRET) return json({ error: "unauthorized" }, 401);
  }

  const contentType = req.headers.get("content-type") || "";
  const userAgent   = req.headers.get("user-agent")   || "";
  let payload: any = {};
  let multipartAttachments: Attachment[] = [];
  let rawSize = 0;

  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        if (v instanceof File) {
          const buf = await v.arrayBuffer();
          rawSize += buf.byteLength;
          const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          multipartAttachments.push({ filename: v.name || `${k}.bin`, content: b64 });
        } else {
          payload[k] = v;
          rawSize += String(v).length;
        }
      }
    } catch (e) {
      return json({ error: "invalid-multipart", message: (e as Error).message }, 400);
    }
  } else if (contentType.includes("application/json") || contentType === "") {
    try {
      const text = await req.text();
      rawSize = text.length;
      payload = text ? JSON.parse(text) : {};
    }
    catch { return json({ error: "invalid-json" }, 400); }
  } else {
    return json({ error: "unsupported-content-type", got: contentType }, 415);
  }

  // Verification ping: ack with 200 so the forwarder considers the
  // wiring successful. Don't persist anything to the events table.
  if (isVerificationPing(payload) && multipartAttachments.length === 0) {
    return json({ ok: true, verified: true, message: "verification ping acknowledged" });
  }

  const sender  = payload.sender ?? payload.from ?? payload.fromEmail ?? payload.From ?? null;
  const subject = payload.subject ?? payload.Subject ?? "";
  const { items: pickedAttachments, foundKeys } = pickAttachments(payload);
  const attachments = [...pickedAttachments, ...multipartAttachments];

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!attachments.length) {
    await logFailure(supabase, contentType, userAgent, rawSize, payload, 'no-attachments', foundKeys);
    return json({
      error: "no-attachments",
      hint:  "no attachment fields found. Failure logged to zoho_intake_failures for inspection.",
      received_keys: foundKeys.slice(0, 30),
      content_type:  contentType,
    }, 400);
  }

  const results: any[] = [];
  for (const att of attachments) {
    const lower = att.filename.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
      results.push({ filename: att.filename, skipped: "non-spreadsheet" });
      continue;
    }

    let bytes: Uint8Array;
    try {
      if (att.content) bytes = decodeBase64(att.content);
      else if (att.url) bytes = await fetchAttachmentFromUrl(att.url);
      else { results.push({ filename: att.filename, error: 'no-content-or-url' }); continue; }
    } catch (e) {
      results.push({ filename: att.filename, error: `decode-failed: ${(e as Error).message}` });
      continue;
    }

    const detection = detectSource(att.filename, subject);

    const datePart = new Date().toISOString().slice(0, 10);
    const safeName = sanitizeStorageName(att.filename);
    const storagePath = `${datePart}/${crypto.randomUUID()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: lower.endsWith(".csv") ? "text/csv"
                 : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
    if (upErr) {
      results.push({ filename: att.filename, error: `storage: ${upErr.message}` });
      continue;
    }

    const { data: ev, error: insErr } = await supabase
      .from("zoho_intake_events")
      .insert({
        sender, subject,
        file_name:        att.filename,
        file_size:        bytes.length,
        file_path:        storagePath,
        detected_source:  detection.source,
        detection_method: detection.method,
        raw_payload: { sender, subject, attachment_count: attachments.length },
        status: "pending",
      })
      .select("id")
      .single();
    if (insErr) {
      results.push({ filename: att.filename, error: `db: ${insErr.message}` });
      continue;
    }

    results.push({
      filename: att.filename,
      id: ev.id,
      detected_source: detection.source,
      detection_method: detection.method,
    });
  }

  return json({ ok: true, processed: results.length, results });
});
