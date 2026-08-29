# store_360_core — Staging Shadow Read Report

Date: 2026-08-21
Environment: temporary Supabase branch `store360-shadow-20260821`
Production migration: none
UI cutover: none
Production data copied: none

## Decision

**NO-GO for Production migration.**

The RPC behavior, financial equality, permissions, freshness behavior and branch performance passed. The environment-equivalence gate did not: the branch inherited only 110 parent migrations through `20260704165255`, while Production has 380 migrations through `20260821120516`. The 270 missing migrations include the current financial views, CRM objects and security hardening. Results are therefore valid for the production-shaped isolated pilot, but not sufficient evidence for a Production migration.

## Shadow result

| Gate | Result |
|---|---:|
| Stores compared | 1,500 |
| Store ID mismatches | 0 |
| `collectibleDue` mismatches | 0 |
| Aging mismatches (tolerance 0.009 SAR) | 0 |
| Last-payment mismatches | 0 |
| Collection-task mismatches | 0 |
| Sales mismatches | 0 |
| Permission/ambiguity leaks | 0 |
| Ambiguous mappings withheld | 33 / 33 |
| Unlinked stores withheld | 506 |
| Shadow error rate in comparison | 0% |
| External API calls | 0 |

The shadow adapter is feature-gated by `VITE_STORE_360_CORE_SHADOW_READ=1`, runs after the established result is complete, uses exact `store_id`, and contains RPC failure without changing or rejecting the visible result. It is disabled by default.

## Performance

Production-shaped anonymous data: 51,000 merchant snapshot rows, 1,121 contacts, 6,077 invoices, 6,072 payments, 89 collection tasks and 234 sales follow-ups.

| Measurement | Current lower-bound | Core RPC |
|---|---:|---:|
| Requests | 9–12+ depending on pagination | 1 |
| P50 DB work | 46.048 ms | 14.371 ms |
| P75 DB work | 46.450 ms | 14.512 ms |
| P95 DB work | 47.964 ms | 14.782 ms |
| Average payload | 1,189,116 bytes | 3,270 bytes |
| Maximum Core payload | — | 4,396 bytes |

The one-call `EXPLAIN (ANALYZE, BUFFERS)` recorded 26.887 ms and 12,334 shared-buffer hits after warm-up. The representative expanded financial plan recorded 43.770 ms and 20,224 shared-buffer hits. The dominant cost is expansion of `customer_ar` / `customer_collectible_lines` across the contact set; exact store and explicit-link lookups use their indexes. No new index was added because the branch P75 is far below the 1.5-second gate and the plan does not prove that a new index would remove the view-expansion cost.

Concurrent test: 8 simultaneous database workers, 20 Core calls each (160 total), zero errors. Per-worker mean database time ranged from 7.340 to 26.023 ms.

## Permissions and freshness

- Anonymous REST RPC: rejected with HTTP 401.
- Authenticated user with no relevant permission: rejected.
- Identity-only: only identity visible.
- Finance-only: finance/link/payment visible; collections and sales restricted.
- Limited collector: finance and assigned collection task visible; sales restricted.
- Sales-only: sales and identity visible; finance and collections restricted.
- Restricted sections returned `data=null` and `source=null`.
- Zoho stale: last-known data preserved, `freshnessStatus=stale`.
- Zoho failed: last-known data preserved, `freshnessStatus=failed`.
- No financial mapping: `unlinked`, no inferred amount.
- Ambiguous mapping: `ambiguous`, financial data withheld.
- Shared phone: exact Store IDs remained separate; no financial link inferred.

## App shadow validation

- The established Store 360 result remains the only visible return value.
- Shadow scheduling occurs only after the old result has been assembled.
- Shadow failures are caught and emitted to the optional metrics sink; they do not throw into the page.
- Tests: 16 Store 360/shadow tests passed; Production build passed.
- A signed-in browser shadow session was not created because public signup is intentionally disabled and no test user exists on the data-less branch. Database role/JWT-claim authorization and anonymous REST rejection were tested instead.

## Remaining blockers

1. Rebuild a temporary Supabase environment from the approved current Production baseline so it contains all 380 parent migrations (or an equivalent schema fingerprint), not the historical 110-migration branch state.
2. Provision test-only users through the administrative path for each role; do not reopen public signup.
3. Repeat the same 1,500-store shadow suite and signed-in application run on that schema-equivalent environment.
4. Re-run `EXPLAIN (ANALYZE, BUFFERS)` on production-equivalent cardinalities. Any financial difference of SAR 0.01 or more remains an automatic blocker.
