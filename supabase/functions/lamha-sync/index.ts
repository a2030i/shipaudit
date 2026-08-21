// Retired diagnostic endpoint.
//
// The original probe accepted a caller-controlled Lamha path and returned the
// upstream response. Operational Lamha reads/writes now use the scoped
// lamha-store-status and lamha-financial-guard functions instead.

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

Deno.serve(() => new Response(JSON.stringify({
  ok: false,
  retired: true,
  error: 'endpoint_retired',
}), { status: 410, headers }));
