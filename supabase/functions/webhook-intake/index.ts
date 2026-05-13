// ─── webhook-intake ─────────────────────────────────────────────────────────
// Inbound endpoint for carrier invoice files. Whoever sends to this
// endpoint (the user's email-forwarding automation, Zapier, n8n, IFTTT,
// or a manual curl) gets a stable contract:
//
//   POST /functions/v1/webhook-intake
//   Headers:
//     X-Webhook-Secret: <shared secret>   (alternative to Authorization)
//     Authorization: Bearer <anon-jwt>    (when called from an app)
//   Body (JSON):
//     {
//       "file_name":   "EX712494.xlsx",
//       "file_base64": "...",              // raw bytes, base64-encoded
//       "sender":      "billing@aramex.com",   // optional
//       "subject":     "Invoice EX712494",     // optional
//       "metadata":    { ... }             // free-form, stored as JSONB
//     }
//
// What it does:
//   1. Persists the raw file in `webhook-uploads/` storage
//   2. Tries to identify the carrier (sender domain → filename →
//      header signature) using each carrier's `file_signature` JSONB
//   3. Inserts a row in `webhook_events` with status =
//        - 'processed'           when carrier identified
//        - 'awaiting_assignment' when no match (UI can fix manually)
//        - 'failed'              when something else broke
//
// Auditing the file (running engine.auditAll, saving to `audits`) is
// intentionally NOT done here — it requires the full TypeScript audit
// engine which is fragile to port to Deno. The UI loads
// `awaiting_assignment` events and offers a one-click "audit this
// file" action.

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

// Decode base64 string to a Uint8Array (Deno-native).
function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
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
  auto_learn?: boolean;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json({ error: "method_not_allowed" }, 405);

  // Auth: either a Bearer JWT (when called from the app) or a shared
  // secret (when called from an external automation/Zapier/n8n).
  const authHeader = req.headers.get("authorization") || "";
  const webhookSecret = req.headers.get("x-webhook-secret") || "";
  const hasJwt = authHeader.startsWith("Bearer ") && authHeader.length > 20;
  const hasSecret = SHARED_SECRET && webhookSecret === SHARED_SECRET;
  if (!hasJwt && !hasSecret) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const fileName = String(body.file_name ?? "").trim();
  const fileB64  = String(body.file_base64 ?? "");
  const sender   = body.sender   ? String(body.sender)   : null;
  const subject  = body.subject  ? String(body.subject)  : null;
  const metadata = (body.metadata && typeof body.metadata === "object") ? body.metadata : {};

  if (!fileName || !fileB64) {
    return json({ error: "missing_fields", required: ["file_name", "file_base64"] }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  let bytes: Uint8Array;
  try { bytes = decodeBase64(fileB64); }
  catch (e) { return json({ error: "invalid_base64", detail: String(e) }, 400); }

  const fileHash = await sha256Hex(bytes);

  // Dedup: if we've seen this exact file before, return the prior event.
  const { data: priorDup } = await admin
    .from("webhook_events")
    .select("id, status, audit_id, file_name")
    .eq("file_hash", fileHash)
    .limit(1)
    .maybeSingle();
  if (priorDup) {
    return json({
      ok: true,
      duplicate: true,
      event_id: priorDup.id,
      status:   priorDup.status,
      audit_id: priorDup.audit_id,
      message:  "هذا الملف مستلَم سابقاً (نفس البصمة)",
    });
  }

  // Persist the raw file.
  const period = new Date().toISOString().slice(0, 7);
  const safeName = fileName.replace(/[^\w؀-ۿ.\-]+/g, "_");
  const storagePath = `${period}/${fileHash.slice(0, 12)}_${safeName}`;
  const { error: upErr } = await admin.storage
    .from("webhook-uploads")
    .upload(storagePath, bytes, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (upErr && !String(upErr.message).includes("exists")) {
    return json({ error: "storage_upload_failed", detail: upErr.message }, 500);
  }

  // Identify carrier by signature.
  const { data: carriers, error: cErr } = await admin
    .from("carriers")
    .select("id, name, file_signature");
  if (cErr) return json({ error: "carriers_load_failed", detail: cErr.message }, 500);

  let bestCarrierId: string | null = null;
  let bestMethod: "email_from" | "filename" | "columns" | null = null;
  let bestConfidence = 0;
  for (const c of carriers || []) {
    const sig: FileSignature = c.file_signature || {};
    if (sender) {
      const v = matchByEmail(sender, sig);
      if (v > bestConfidence) { bestConfidence = v; bestCarrierId = c.id; bestMethod = "email_from"; }
    }
    const fv = matchByFilename(fileName, sig);
    if (fv > bestConfidence) { bestConfidence = fv * 0.85; bestCarrierId = c.id; bestMethod = "filename"; }
    // Header matching would require parsing the xlsx in Deno; we skip
    // it here and let the UI's manual classification or the audit
    // pipeline pick it up via column patterns.
  }

  const status = bestCarrierId ? "processed" : "awaiting_assignment";

  const { data: event, error: evErr } = await admin
    .from("webhook_events")
    .insert({
      source: "webhook",
      sender,
      subject,
      file_name: fileName,
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
  if (evErr) return json({ error: "event_insert_failed", detail: evErr.message }, 500);

  return json({
    ok: true,
    event_id: event.id,
    status,
    detected_carrier_id: bestCarrierId,
    detection_method:    bestMethod,
    detection_confidence: bestConfidence,
    file_hash: fileHash,
    file_path: storagePath,
  });
});
