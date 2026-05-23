// zoho-intake — DEDICATED endpoint for Zoho-side report files.
//
// Kept separate from /webhook-intake on purpose:
//   • webhook-intake handles emails from shipping carriers
//     (DeliverNow, J&T, etc.) and the resulting rows land in
//     webhook_events → /webhook inbox for the operator to review
//     and turn into audits.
//   • zoho-intake handles scheduled emails Zoho sends with the
//     three financial reports (Customer Balance Summary, Vendor
//     Balance Summary, Invoice Detail). The resulting rows land
//     in zoho_intake_events and appear in /uploads under a
//     "Zoho Inbox" section the operator can one-click process.
//
// Two request shapes accepted (same as webhook-intake):
//
// A) Direct API call (Make/Zapier/cURL):
//    { file_name, file_base64, sender?, subject? }
//
// B) Email envelope (InboxDone / Zoho's built-in Email Report):
//    { subject?, from?, attachments: [{ filename, content }, ...] }
//
// Auth: every request must include the x-zoho-intake-secret header
// matching the ZOHO_INTAKE_SECRET environment variable. Without it
// the function returns 401 without leaking implementation details.

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

// Storage keys must be ASCII-safe — same sanitizer the carrier
// webhook function uses. The original filename is preserved on
// the event row.
function sanitizeStorageName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file.bin";
}

// ── auto-detect which Zoho report this file represents ──
// Looks at filename + subject for the canonical Arabic/English
// signature strings. Failure mode is null (operator picks manually).
function detectSource(fileName: string, subject: string): { source: string | null; method: string } {
  const blob = `${fileName} ${subject}`.toLowerCase();

  // Vendor balance — check FIRST because "موردين" is more specific
  // than "عملاء" and we don't want a partial match like "اسم
  // المورد" to fall through to customer-balance.
  if (blob.includes("ملخص أرصدة الموردين")
   || blob.includes("ملخص ارصدة الموردين")
   || blob.includes("vendor balance")
   || blob.includes("vendor balances")) {
    return { source: "zoho_vendors", method: "subject" };
  }
  // Customer balance summary
  if (blob.includes("ملخص أرصدة العملاء")
   || blob.includes("ملخص ارصده العملاء")
   || blob.includes("ملخص ارصدة العملاء")
   || blob.includes("ملخص التزامات المستفيدين")
   || blob.includes("customer balance")
   || blob.includes("customer balances")) {
    return { source: "zoho_customers", method: "subject" };
  }
  // Invoice detail (customer receivables)
  if (blob.includes("تفاصيل الفاتورة")
   || blob.includes("تفاصيل الفواتير")
   || blob.includes("invoice detail")
   || blob.includes("invoice details")
   || blob.includes("فواتير الشهر")) {
    return { source: "receivables", method: "subject" };
  }
  return { source: null, method: "failed" };
}

// ── attachment normalizer — flexible across forwarders ──
// Common shapes we accept (everything boils down to filename + base64):
//   { file_base64, file_name }                       — direct API
//   { attachments: [{ filename, content }] }          — InboxDone / Mailgun JSON
//   { attachments: [{ name, contentBytes }] }         — Microsoft Graph
//   { Attachments: [...] }                            — case variant
//   { data: { attachments: [...] } }                  — Zapier nested
//   { body: { attachments: [...] } }                  — some webhook proxies
//   { file_url, file_name }                           — URL pointer (we fetch)
//   { attachments: [{ url, name }] }                  — URL-based attachment list
type Attachment = { filename: string; content?: string; url?: string };
function pickAttachments(payload: any): { items: Attachment[]; foundKeys: string[] } {
  const items: Attachment[] = [];
  const foundKeys: string[] = [];

  // Recurse into common envelopes — Zapier wraps under "data", some
  // proxies wrap under "body". Only one level of unwrap.
  const envelopes = [payload, payload?.data, payload?.body, payload?.payload].filter(Boolean);
  for (const env of envelopes) {
    if (!env || typeof env !== 'object') continue;
    foundKeys.push(...Object.keys(env));

    // Single-file: base64 inline
    if (env.file_base64 && env.file_name) {
      items.push({ filename: String(env.file_name), content: String(env.file_base64) });
    }
    // Single-file: URL pointer
    if (env.file_url && env.file_name) {
      items.push({ filename: String(env.file_name), url: String(env.file_url) });
    }

    // attachments[] in any common casing
    const lists = [env.attachments, env.Attachments, env.attachment, env.Files, env.files];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const a of list) {
        if (!a || typeof a !== 'object') continue;
        const filename = a.filename ?? a.name ?? a.fileName ?? a.file_name ?? a.title;
        if (!filename) continue;
        // Inline content first
        const content = a.content ?? a.contentBytes ?? a.data ?? a.file_base64 ?? a.base64;
        if (content && typeof content === 'string') {
          items.push({ filename: String(filename), content });
          continue;
        }
        // URL-based — we'll fetch later
        const url = a.url ?? a.file_url ?? a.download_url ?? a.href;
        if (url && typeof url === 'string') {
          items.push({ filename: String(filename), url });
        }
      }
    }
  }

  // Dedupe by (filename + content/url hash prefix)
  const seen = new Set<string>();
  const dedup: Attachment[] = [];
  for (const a of items) {
    const key = `${a.filename}::${(a.content || a.url || '').slice(0, 64)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(a);
  }
  return { items: dedup, foundKeys: [...new Set(foundKeys)] };
}

async function fetchAttachmentFromUrl(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET")     return json({ ok: true, hint: "POST a JSON or multipart payload — see README" });
  if (req.method !== "POST")    return json({ error: "method-not-allowed" }, 405);

  // Auth — when secret is configured, enforce it. When unset (local
  // dev) we allow through.
  if (SHARED_SECRET) {
    const incoming = req.headers.get("x-zoho-intake-secret") ?? "";
    if (incoming !== SHARED_SECRET) return json({ error: "unauthorized" }, 401);
  }

  const contentType = req.headers.get("content-type") || "";
  let payload: any = {};
  let multipartAttachments: Attachment[] = [];

  if (contentType.includes("multipart/form-data")) {
    // Browser/cURL form upload OR Mailgun's multipart webhook.
    // Pull every file field + every text field into a flat payload.
    try {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        if (v instanceof File) {
          const buf = await v.arrayBuffer();
          const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          multipartAttachments.push({ filename: v.name || k, content: b64 });
        } else {
          payload[k] = v;
        }
      }
    } catch (e) {
      return json({ error: "invalid-multipart", message: (e as Error).message }, 400);
    }
  } else if (contentType.includes("application/json") || contentType === "") {
    try { payload = await req.json(); }
    catch { return json({ error: "invalid-json" }, 400); }
  } else {
    return json({ error: "unsupported-content-type", got: contentType }, 415);
  }

  const sender  = payload.sender ?? payload.from ?? payload.fromEmail ?? null;
  const subject = payload.subject ?? payload.Subject ?? "";
  const { items: pickedAttachments, foundKeys } = pickAttachments(payload);
  const attachments = [...pickedAttachments, ...multipartAttachments];

  if (!attachments.length) {
    return json({
      error: "no-attachments",
      hint:  "send JSON with attachments[] / file_base64, multipart with a file field, or { file_url, file_name }",
      received_keys: foundKeys.slice(0, 30),    // help the user debug what they sent
      content_type:  contentType,
    }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results: any[] = [];
  for (const att of attachments) {
    // Skip non-spreadsheet attachments without erroring (Zoho emails
    // sometimes include an inline logo or PDF cover).
    const lower = att.filename.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
      results.push({ filename: att.filename, skipped: "non-spreadsheet" });
      continue;
    }

    let bytes: Uint8Array;
    try {
      if (att.content) {
        bytes = decodeBase64(att.content);
      } else if (att.url) {
        bytes = await fetchAttachmentFromUrl(att.url);
      } else {
        results.push({ filename: att.filename, error: 'no-content-or-url' });
        continue;
      }
    } catch (e) {
      results.push({ filename: att.filename, error: `decode-failed: ${(e as Error).message}` });
      continue;
    }

    const detection = detectSource(att.filename, subject);

    // Save to storage under a date-partitioned path
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

    // Log the intake event
    const { data: ev, error: insErr } = await supabase
      .from("zoho_intake_events")
      .insert({
        sender,
        subject,
        file_name:        att.filename,
        file_size:        bytes.length,
        file_path:        storagePath,
        detected_source:  detection.source,
        detection_method: detection.method,
        raw_payload: {
          sender, subject,
          attachment_count: attachments.length,
        },
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
