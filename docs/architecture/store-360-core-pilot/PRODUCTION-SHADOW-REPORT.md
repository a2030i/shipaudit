# store_360_core — Production Shadow Report

Date: 2026-08-21  
Scope: additive read-only RPC and Store 360 adapter only.

## Safety

- Created only `public.store_360_core(text)`; no existing object or row was changed.
- Source row counts and latest source timestamps were identical before and after creation.
- Function is `STABLE SECURITY DEFINER`, uses an empty `search_path`, has a 2-second statement timeout, and contains no DML.
- `PUBLIC` and `anon` cannot execute it. `authenticated` can execute it, while section authorization is enforced inside the function.
- Exact `store_id` is the only input identity. There is no name or phone identity fallback.

## Production shadow comparison

| Measure | Result |
|---|---:|
| Latest stores compared | 1,614 |
| Exact single financial links | 966 |
| Stores with financial rows in both paths | 62 |
| Financial mismatches | 0 |
| Absolute mismatch value | SAR 0.00 |
| Identity mismatches | 0 |
| Current collection-task mismatches | 0 |
| Current sales-state mismatches | 0 |
| Ambiguous links kept hidden | 33 |
| Unresolved links kept hidden | 4 |
| Unlinked stores | 611 |

Compared financial fields: collectible due, overdue, every campaign Aging bucket, opening balance, latest-payment amount, latest-payment date, and financial-row availability.

## Permissions

- Finance user: identity/finance/collections visible; sales restricted with `data=null` and `source=null`.
- Sales user: identity/sales visible; finance/collections restricted with `data=null` and `source=null`.
- Unknown authenticated identity: rejected with `not_allowed`.
- Missing authenticated identity: rejected with `not_authenticated`.

## Performance

500 Production stores, server-side warm sample:

| Measure | RPC |
|---|---:|
| P50 | 4.37 ms |
| P75 | 4.47 ms |
| P95 | 8.85 ms |
| Max | 16.31 ms |
| Payload P50 | 2,661 bytes |
| Payload P75 | 2,746 bytes |
| Payload P95 | 3,421 bytes |

Representative `EXPLAIN (ANALYZE, BUFFERS)` for a financially linked store: 30.06 ms cold execution, 4,527 shared buffer hits, zero reads/writes/temp blocks.

Concurrency smoke: 8 concurrent readers, 200 total Core calls, zero failures. No index was added because measured P75/P95 and plans met the gate.

Current old Core path loads the full merchant snapshot plus several global finance projections. Its two principal finance RPCs alone measured P75 84.02 ms and 13.40 ms; the merchant snapshot payload was 1,033,602 bytes. The new Core uses one request and a P75 payload of 2,746 bytes.

## Freshness behavior

- The current Lamha merchant snapshot was correctly labelled `stale` instead of being presented as fresh.
- Current Zoho invoice/payment mirrors were labelled `fresh`.
- The isolated contract suite already covers failed/unavailable Zoho states; Production data was not mutated to manufacture a failure.
- Source failure keeps last-known local values and never substitutes zero.

## Cutover and rollback

- `VITE_STORE_360_CORE_READ_MODE=core` selects the new Core adapter.
- `VITE_STORE_360_CORE_READ_MODE=legacy` restores the established path.
- Any RPC error, timeout, unsupported legacy identity, or invalid Core identity envelope immediately falls back to the established path.
- Heavy invoice, shipment, communication, and timeline details remain lazy and unchanged.
- Database rollback: `drop function if exists public.store_360_core(text);`. Because the adapter contains automatic fallback, dropping/revoking the RPC restores the old read path without a UI outage.

Recommendation: **GO for Store 360 Core cutover**. This recommendation does not cover receivables or Carrier 360, which remain separate future pilots.

