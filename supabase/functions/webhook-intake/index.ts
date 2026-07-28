// webhook-intake v11 — inbound endpoint for carrier invoice files.
//
// v11: tolerant request parsing — accepts JSON, multipart/form-data, and
//      empty/verification-ping bodies (older code 400'd everything that
//      wasn't strict JSON → "invalid_json" during forwarder wiring).
//
// Accepts TWO request shapes:
//
// A) Single-file (legacy + direct API callers):
//    { file_name, file_base64, sender?, subject?, metadata? }
//
// B) Email-envelope (most email automations send this):
//    {
//      subject?: string,
//      from?:    string,  // alias: sender, fromEmail
//      to?:      string,
//      date?:    string,
//      body?:    string,
//      attachments: [
//        { filename, content }      // content = base64 string
//        // also accepted: { name, contentBytes } / { fileName, data } / etc.
//      ]
//    }
//    Each attachment becomes its own webhook_events row + carrier
//    detection. Non-Excel attachments are silently skipped.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED_SECRET = Deno.env.get("WEBHOOK_SHARED_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-webhook-secret, content-type",
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
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Chunked base64 encode — avoids the call-stack blowup that
// `btoa(String.fromCharCode(...bigArray))` hits on large attachments.
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface FileSignature {
  email_from?: string[];
  filename_pattern?: string;
  header_must_contain?: string[];
}

function matchByEmail(sender: string, sig: FileSignature): number {
  if (!sender || !sig.email_from?.length) return 0;
  const senderLower = sender.toLowerCase();
  for (const pat of sig.email_from) {
    const p = pat.toLowerCase().trim();
    if (p.startsWith("@") && senderLower.includes(p)) return 1;
    if (senderLower === p || senderLower.endsWith("@" + p) || senderLower.includes(p)) return 1;
  }
  return 0;
}

function matchByFilename(fileName: string, sig: FileSignature): number {
  if (!fileName || !sig.filename_pattern) return 0;
  try {
    const re = new RegExp(sig.filename_pattern, "i");
    return re.test(fileName) ? 1 : 0;
  } catch { return 0; }
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// Normalise one attachment object into { filename, base64 }. Different
// email services name the fields differently — absorb the variants.
function extractAttachment(att: Record<string, unknown>): { filename: string; base64: string } | null {
  const filename = firstString(att, [
    "filename", "file_name", "name", "fileName", "Name",
  ]);
  const base64 = firstString(att, [
    "content", "contentBytes", "contentBase64", "data", "base64", "Content",
    "file_base64",
  ]);
  if (!filename || !base64) return null;
  // Skip clearly non-Excel attachments (PDF invoices the user might also
  // get on the same email — we only want xlsx/xls).
  if (!/\.(xlsx|xlsm|xls|csv|tsv)$/i.test(filename)) return null;
  return { filename, base64 };
}

interface ProcessResult {
  ok: boolean;
  event_id?: string;
  status?: string;
  detected_carrier_id?: string | null;
  detection_method?: string | null;
  detection_confidence?: number | null;
  file_hash?: string;
  file_path?: string | null;
  duplicate?: boolean;
  message?: string;
  error?: string;
  detail?: string;
  filename: string;
}

async function processSingleFile(
  admin: ReturnType<typeof createClient>,
  carriers: Array<{ id: string; name: string; file_signature: FileSignature | null }>,
  args: { filename: string; base64: string; sender: string | null; subject: string | null; metadata: Record<string, unknown> },
): Promise<ProcessResult> {
  const { filename, base64, sender, subject, metadata } = args;

  let bytes: Uint8Array;
  try { bytes = decodeBase64(base64); }
  catch (e) { return { ok: false, error: "invalid_base64", detail: String(e), filename }; }

  const fileHash = await sha256Hex(bytes);

  const { data: priorDup } = await admin
    .from("webhook_events")
    .select("id, status, audit_id, file_name")
    .eq("file_hash", fileHash)
    .limit(1)
    .maybeSingle();
  if (priorDup) {
    return {
      ok: true,
      duplicate: true,
      event_id: priorDup.id,
      status:   priorDup.status,
      file_hash: fileHash,
      filename,
      message:  "هذا الملف مستلَم سابقاً",
    };
  }

  const period = new Date().toISOString().slice(0, 7);
  const safeName = filename.replace(/[^\w؀-ۿ.\-]+/g, "_");
  const storagePath = `${period}/${fileHash.slice(0, 12)}_${safeName}`;
  const { error: upErr } = await admin.storage
    .from("webhook-uploads")
    .upload(storagePath, bytes, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (upErr && !String(upErr.message).includes("exists")) {
    return { ok: false, error: "storage_upload_failed", detail: upErr.message, filename };
  }

  let bestCarrierId: string | null = null;
  let bestMethod: "email_from" | "filename" | null = null;
  let bestConfidence = 0;
  for (const c of carriers) {
    const sig: FileSignature = c.file_signature || {};
    if (sender) {
      const v = matchByEmail(sender, sig);
      if (v > bestConfidence) { bestConfidence = v; bestCarrierId = c.id; bestMethod = "email_from"; }
    }
    const fv = matchByFilename(filename, sig);
    if (fv > bestConfidence) { bestConfidence = fv * 0.85; bestCarrierId = c.id; bestMethod = "filename"; }
  }

  const status = bestCarrierId ? "processed" : "awaiting_assignment";

  const { data: event, error: evErr } = await admin
    .from("webhook_events")
    .insert({
      source: "webhook",
      sender,
      subject,
      file_name: filename,
      file_size: bytes.byteLength,
      file_hash: fileHash,
      file_path: storagePath,
      detected_carrier_id: bestCarrierId,
      detection_method:    bestMethod,
      detection_confidence: bestConfidence ? Number(bestConfidence.toFixed(2)) : null,
      status,
      metadata,
    })
    .select()
    .single();
  if (evErr) {
    // 23505 = unique_violation. The (carrier, file_hash) index we
    // added catches duplicates the pre-check couldn't (race window
    // when forwarders retry on timeout within the same second).
    // Convert the error into a graceful "duplicate" response so
    // the caller doesn't keep retrying.
    const msg = String(evErr.message || "");
    if (evErr.code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
      const { data: existing } = await admin
        .from("webhook_events")
        .select("id, status")
        .eq("file_hash", fileHash)
        .order("received_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      return {
        ok: true,
        duplicate: true,
        event_id:  existing?.id,
        status:    existing?.status ?? "processed",
        file_hash: fileHash,
        filename,
        message:   "هذا الملف مستلَم سابقاً (تكرار من webhook المرسِل)",
      };
    }
    return { ok: false, error: "event_insert_failed", detail: evErr.message, filename };
  }

  return {
    ok: true,
    event_id: event.id,
    status,
    detected_carrier_id: bestCarrierId,
    detection_method:    bestMethod,
    detection_confidence: bestConfidence,
    file_hash: fileHash,
    file_path: storagePath,
    filename,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json({ error: "method_not_allowed" }, 405);

  // Open endpoint — no auth required. The URL itself is the secret
  // (it's not guessable and only shared with the user's email
  // automation). Junk files surface as 'awaiting_assignment' in the
  // /webhook page and the admin can delete or classify them.
  // If WEBHOOK_SHARED_SECRET is set later, requests carrying a
  // matching X-Webhook-Secret still get the same treatment — but
  // we no longer reject calls that omit it.

  // Tolerant body parsing (v11): accept JSON, multipart/form-data, and
  // empty bodies. Many email forwarders post multipart or send an empty
  // verification ping when wiring the URL — the old code rejected both
  // with `invalid_json`, making the wiring step "fail".
  const contentType = req.headers.get("content-type") || "";
  let body: Record<string, unknown> = {};

  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      const atts: Array<Record<string, unknown>> = [];
      for (const [k, v] of form.entries()) {
        if (v instanceof File) {
          const buf = await v.arrayBuffer();
          atts.push({ filename: v.name || `${k}.bin`, content: bytesToB64(new Uint8Array(buf)) });
        } else {
          body[k] = v;
        }
      }
      if (atts.length) body.attachments = atts;
    } catch (e) {
      return json({ error: "invalid_multipart", message: (e as Error).message }, 400);
    }
  } else {
    const text = await req.text();
    if (!text.trim()) {
      // Empty body = forwarder verification ping. Ack so wiring succeeds.
      return json({ ok: true, verified: true, message: "ping acknowledged" });
    }
    try { body = JSON.parse(text); }
    catch {
      return json({
        error: "invalid_json",
        hint:  "أرسل JSON بالشكل { file_name, file_base64 } أو { attachments: [...] }، أو multipart/form-data بالمرفقات.",
        content_type: contentType,
      }, 400);
    }
  }

  // Verification ping payloads (InboxDone/Make/Zapier send a trial body
  // when wiring): ack with 200 so the wiring step doesn't fail.
  if ((body.test === true || body.ping === true || body.verify === true
       || body.hasAttachments === false)
      && !Array.isArray(body.attachments)) {
    return json({ ok: true, verified: true, message: "verification ping acknowledged" });
  }

  const sender   = firstString(body, ["sender", "from", "fromEmail"]) || null;
  const subject  = firstString(body, ["subject"]) || null;
  const metadata = (body.metadata && typeof body.metadata === "object")
    ? (body.metadata as Record<string, unknown>)
    : {
        to:       firstString(body, ["to"]) || undefined,
        date:     firstString(body, ["date"]) || undefined,
        body:     firstString(body, ["body", "content"]) || undefined,
      };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: carriers, error: cErr } = await admin
    .from("carriers")
    .select("id, name, file_signature");
  if (cErr) return json({ error: "carriers_load_failed", detail: cErr.message }, 500);
  const carriersList = (carriers || []) as Array<{ id: string; name: string; file_signature: FileSignature | null }>;

  // ── Shape A: single-file payload ──────────────────────
  const fileName = firstString(body, ["file_name", "fileName", "filename"]);
  const fileB64  = firstString(body, ["file_base64", "content", "contentBytes", "base64"]);
  if (fileName && fileB64) {
    const r = await processSingleFile(admin, carriersList, {
      filename: fileName, base64: fileB64, sender, subject, metadata,
    });
    return json(r, r.ok ? 200 : 500);
  }

  // ── Shape B: email envelope with attachments[] ────────────
  const attachments = Array.isArray(body.attachments)
    ? (body.attachments as Array<Record<string, unknown>>)
    : [];
  if (!attachments.length) {
    return json({
      error: "missing_fields",
      hint:  "أرسل إمّا { file_name, file_base64 } أو { from, attachments: [{ filename, content }] }",
    }, 400);
  }

  const results: ProcessResult[] = [];
  for (const att of attachments) {
    const norm = extractAttachment(att);
    if (!norm) continue; // not an Excel-like file, or missing fields
    const r = await processSingleFile(admin, carriersList, {
      filename: norm.filename, base64: norm.base64, sender, subject, metadata,
    });
    results.push(r);
  }

  if (!results.length) {
    return json({
      ok: false,
      error: "no_processable_attachments",
      hint:  "أحد المرفقات لازم يكون .xlsx / .xls / .csv مع محتوى Base64 بداخل الحقل content أو contentBytes.",
    }, 400);
  }

  return json({ ok: true, processed: results.length, results });
});
