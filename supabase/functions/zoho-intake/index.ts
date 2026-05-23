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

// ── attachment normalizer — same flexibility as webhook-intake ──
type Attachment = { filename: string; content: string };
function pickAttachments(payload: any): Attachment[] {
  const out: Attachment[] = [];
  // Single-file shape
  if (payload.file_base64 && payload.file_name) {
    out.push({ filename: payload.file_name, content: payload.file_base64 });
  }
  // Email-envelope: attachments[]
  const list = payload.attachments ?? payload.Attachments ?? [];
  for (const a of list) {
    const filename = a.filename ?? a.name ?? a.fileName ?? a.file_name;
    const content  = a.content  ?? a.contentBytes ?? a.data ?? a.file_base64;
    if (filename && content && typeof content === "string") {
      out.push({ filename, content });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json({ error: "method-not-allowed" }, 405);

  // Auth — when secret is configured, enforce it. When unset (local
  // dev) we allow through.
  if (SHARED_SECRET) {
    const incoming = req.headers.get("x-zoho-intake-secret") ?? "";
    if (incoming !== SHARED_SECRET) return json({ error: "unauthorized" }, 401);
  }

  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ error: "invalid-json" }, 400); }

  const sender  = payload.sender ?? payload.from ?? payload.fromEmail ?? null;
  const subject = payload.subject ?? "";
  const attachments = pickAttachments(payload);

  if (!attachments.length) {
    return json({ error: "no-attachments", expected: "file_base64 OR attachments[]" }, 400);
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
    try { bytes = decodeBase64(att.content); }
    catch (e) {
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
