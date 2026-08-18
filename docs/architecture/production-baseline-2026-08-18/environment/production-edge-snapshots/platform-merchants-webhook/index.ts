// platform-merchants-webhook
// يستقبل لقطة كاملة من متاجر المنصة. verify_jwt=false مقصود لأن المرسل نظام
// خارجي؛ الحماية الفعلية HMAC-SHA256 على النص الخام + نافذة زمنية + idempotency.
import { createClient } from 'npm:@supabase/supabase-js@2.104.1';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_ROWS = 5000;
const REQUIRED_FIELDS = [
  'store_id', 'store_name', 'phone', 'status', 'billing_type', 'integration_type',
  'shipment_count', 'last_shipment_at', 'created_at_platform', 'last_topup_at',
  'wallet_balance', 'profile_status', 'vat_registered', 'zatca_completed',
  'verification_status',
] as const;

type MerchantInput = Record<string, unknown>;

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function expectedSignature(secret: string, timestamp: string, rawBody: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
}

async function sha256(rawBody: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody)));
}

function parseDate(value: unknown, field: string, rowNumber?: number) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`invalid_${field}${rowNumber ? `_row_${rowNumber}` : ''}`);
  }
  return new Date(value).toISOString();
}

function normalizeMerchant(input: MerchantInput, index: number) {
  const rowNumber = index + 1;
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      throw new Error(`missing_${field}_row_${rowNumber}`);
    }
  }

  const storeId = String(input.store_id ?? '').trim();
  const storeName = String(input.store_name ?? '').trim();
  const phone = String(input.phone ?? '').replace(/\D/g, '');
  const status = String(input.status ?? '').trim();
  const billingType = String(input.billing_type ?? '').trim();
  const shipmentCount = Number(input.shipment_count);
  const walletBalance = Number(input.wallet_balance);

  if (!storeId || storeId.length > 100) throw new Error(`invalid_store_id_row_${rowNumber}`);
  if (!storeName || storeName.length > 250) throw new Error(`invalid_store_name_row_${rowNumber}`);
  if (phone.length < 8 || phone.length > 15) throw new Error(`invalid_phone_row_${rowNumber}`);
  if (!['نشط', 'غير نشط'].includes(status)) throw new Error(`invalid_status_row_${rowNumber}`);
  if (!['دفع مسبق', 'دفع لاحق'].includes(billingType)) throw new Error(`invalid_billing_type_row_${rowNumber}`);
  if (!Number.isInteger(shipmentCount) || shipmentCount < 0 || shipmentCount > 100000000) {
    throw new Error(`invalid_shipment_count_row_${rowNumber}`);
  }
  if (!Number.isFinite(walletBalance) || Math.abs(walletBalance) > 1000000000) {
    throw new Error(`invalid_wallet_balance_row_${rowNumber}`);
  }
  if (typeof input.vat_registered !== 'boolean') throw new Error(`invalid_vat_registered_row_${rowNumber}`);
  if (typeof input.zatca_completed !== 'boolean') throw new Error(`invalid_zatca_completed_row_${rowNumber}`);

  const optionalText = (value: unknown, field: string) => {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > 120) {
      throw new Error(`invalid_${field}_row_${rowNumber}`);
    }
    return value.trim();
  };

  return {
    store_id: storeId,
    store_name: storeName,
    phone,
    status,
    billing_type: billingType,
    integration_type: optionalText(input.integration_type, 'integration_type'),
    shipment_count: shipmentCount,
    last_shipment_at: parseDate(input.last_shipment_at, 'last_shipment_at', rowNumber),
    created_at_platform: parseDate(input.created_at_platform, 'created_at_platform', rowNumber),
    last_topup_at: parseDate(input.last_topup_at, 'last_topup_at', rowNumber),
    wallet_balance: Math.round(walletBalance * 100) / 100,
    profile_status: optionalText(input.profile_status, 'profile_status'),
    vat_registered: input.vat_registered,
    zatca_completed: input.zatca_completed,
    verification_status: optionalText(input.verification_status, 'verification_status'),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    return response(200, { ok: true, service: 'platform-merchants-webhook', schema_version: 1 });
  }
  if (req.method !== 'POST') return response(405, { ok: false, code: 'method_not_allowed' });

  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return response(413, { ok: false, code: 'payload_too_large' });

  const rawBody = await req.text();
  if (!rawBody || new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return response(413, { ok: false, code: 'payload_too_large' });
  }

  const secret = Deno.env.get('PLATFORM_MERCHANTS_WEBHOOK_SECRET')?.trim();
  if (!secret) {
    console.error('PLATFORM_MERCHANTS_WEBHOOK_SECRET is not configured');
    return response(503, { ok: false, code: 'service_not_configured' });
  }

  const timestamp = req.headers.get('x-lamha-timestamp')?.trim() || '';
  const signatureHeader = req.headers.get('x-lamha-signature')?.trim() || '';
  const signature = signatureHeader.toLowerCase().startsWith('sha256=')
    ? signatureHeader.slice(7).toLowerCase()
    : signatureHeader.toLowerCase();
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)
      || Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > MAX_CLOCK_SKEW_SECONDS) {
    return response(401, { ok: false, code: 'stale_or_invalid_timestamp' });
  }

  const expected = await expectedSignature(secret, timestamp, rawBody);
  if (!/^[0-9a-f]{64}$/.test(signature) || !constantTimeEqual(signature, expected)) {
    return response(403, { ok: false, code: 'invalid_signature' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return response(400, { ok: false, code: 'invalid_json' });
  }

  const idempotencyKey = req.headers.get('idempotency-key')?.trim() || '';
  const eventId = String(payload.event_id ?? '').trim();
  if (!idempotencyKey || idempotencyKey !== eventId || eventId.length < 8 || eventId.length > 160) {
    return response(400, { ok: false, code: 'invalid_idempotency_key' });
  }
  if (payload.event !== 'merchant.snapshot.v1' || payload.schema_version !== 1 || payload.mode !== 'full') {
    return response(400, { ok: false, code: 'unsupported_contract' });
  }

  let snapshotAt: string;
  let merchants: ReturnType<typeof normalizeMerchant>[];
  try {
    const parsedSnapshotAt = parseDate(payload.snapshot_at, 'snapshot_at');
    if (!parsedSnapshotAt) throw new Error('invalid_snapshot_at');
    snapshotAt = parsedSnapshotAt;
    if (!Array.isArray(payload.merchants) || payload.merchants.length < 1 || payload.merchants.length > MAX_ROWS) {
      throw new Error('invalid_merchants_count');
    }
    if (Number(payload.expected_count) !== payload.merchants.length) {
      throw new Error('expected_count_mismatch');
    }
    merchants = payload.merchants.map((row, index) => normalizeMerchant(row as MerchantInput, index));
    if (new Set(merchants.map(row => row.store_id)).size !== merchants.length) {
      throw new Error('duplicate_store_id');
    }
  } catch (error) {
    return response(422, { ok: false, code: String((error as Error).message || 'invalid_payload') });
  }

  const digest = await sha256(rawBody);
  if (payload.dry_run === true) {
    return response(200, {
      ok: true,
      status: 'validated',
      event_id: eventId,
      row_count: merchants.length,
      payload_hash: digest,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Supabase service credentials are unavailable');
    return response(503, { ok: false, code: 'service_not_configured' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc('ingest_platform_merchant_snapshot', {
    p_event_id: eventId,
    p_snapshot_at: snapshotAt,
    p_payload_hash: digest,
    p_rows: merchants,
    p_source: String(payload.source || 'platform_webhook').slice(0, 80),
  });

  if (error) {
    const message = String(error.message || 'ingest_failed');
    console.error('platform snapshot ingest failed:', message);
    if (message.includes('idempotency_conflict')) {
      return response(409, { ok: false, code: 'idempotency_conflict' });
    }
    if (message.includes('suspicious_row_count_change')) {
      return response(422, { ok: false, code: 'suspicious_row_count_change' });
    }
    return response(500, { ok: false, code: 'ingest_failed' });
  }

  // مزامنة تاقات هاتف إثراء لاحق غير قاتل؛ نجاح اللقطة لا يتراجع إذا تعذرت.
  await admin.rpc('trigger_tag_sync').then(() => undefined, () => undefined);
  return response(data?.status === 'duplicate' ? 200 : 201, { ok: true, ...data });
});


