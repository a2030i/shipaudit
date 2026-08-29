# store_360_core — Isolated Test Report

Date: 2026-08-21
Engine: PGlite PostgreSQL-WASM 0.3.14
Production touched: no
UI changed: no
Migration created/applied: no

## Dataset

- 1,500 stores across 34 snapshots: 51,000 merchant rows.
- 1,121 financial contacts.
- 6,077 invoices and 6,072 payments.
- 89 collection tasks, 234 sales follow-ups, 2,955 lifecycle events.
- 33 stores deliberately contain more than one explicit financial link.
- Two stores deliberately share one phone number.

## Results

| Gate | Result |
|---|---:|
| Core calls per page | 1 |
| Current code-derived initial calls | 12+ plus pagination |
| Measured old lower-bound calls | 6 |
| Core latency P50 / P75 / P95 | 17.727 / 17.967 / 18.594 ms |
| Old six-query lower bound P50 / P75 / P95 | 43.152 / 43.933 / 46.299 ms |
| Function EXPLAIN execution | 35.391 ms, warm cache |
| Representative combined SQL EXPLAIN | 77.796 ms, warm cache |
| Shadow sample | 1,500 stores |
| Exact old/new financial matches | 1,467 |
| Financial mismatches | 0 |
| Ambiguous links safely withheld | 33 |
| Financial invariant sample | 867 linked stores with positive collectible due |
| Financial invariant mismatches | 0 |
| External API calls | 0 |

The function exceeds neither the local execution budget nor the end-to-end P75 target of 1.5 seconds. Network and Supabase gateway latency were intentionally not claimed by this isolated test.

## Query plan findings

- Exact latest-store lookup used the existing-equivalent `(snapshot_id, store_id)` unique index.
- Latest snapshot lookup used the existing-equivalent uploaded-at/snapshot index.
- Explicit financial linkage used the existing-equivalent `customer_merchant_links(store_id)` index.
- Invoice access used the existing customer ID and customer-name indexes through bitmap scans.
- The representative direct SQL expanded the current `customer_ar`/`customer_collectible_lines` views across the synthetic contact set (1,121 invoice aggregates and 1,031 line allocations). This is the main plan cost, but the one-store RPC remained well under the target.
- No index was added. A new index is not justified by this isolated plan; a pre-production branch must repeat `EXPLAIN (ANALYZE, BUFFERS)` on real cardinalities before cutover.

## Permissions

- Authenticated/no-permission caller: rejected.
- Unauthenticated caller: rejected.
- Store name, phone, and empty input were rejected; only exact store ID resolved.
- `anon` and `PUBLIC` execute: denied.
- Identity-only user: sales, finance, payment, collection, and financial-link data/source metadata absent.
- Finance-only user: finance/link/payment visible; collection and sales restricted.
- Collector: assigned task visible; another collector's task hidden.
- Sales-only user: sales/identity visible; finance/link/payment/collection restricted.
- Cross-domain `view_all` permissions were kept separate; collection scope cannot broaden sales scope and vice versa.
- Restricted-section PII/amount/source leakage test: passed.

## Freshness

- Fresh Zoho sync: `fresh`.
- Three-hour-old successful sync: `stale`.
- Failed sync with local data: `availabilityStatus=available`, `freshnessStatus=failed`.
- Missing sync timestamp plus failed source: `availabilityStatus=unavailable`, `freshnessStatus=failed`.
- Last-known non-zero amount remained unchanged during failed-source simulation.
- Last-known non-zero amount also remained labelled and non-zero in the unavailable-source simulation.

## Required edge cases

- No financial link: explicit `unlinked`, no guessed amount.
- Linked store with receivables: returned canonical amount.
- Linked store without receivables: `empty`, not source failure.
- Current collection promise: returned from the existing task row.
- Multiple merchant snapshots: latest exact store record selected.
- Shared phone: each store identity remained distinct; no financial association was inferred.
- Source stale/unavailable: last known data preserved and labelled.

## Recommendation

**GO for a Supabase staging/branch implementation and shadow-read validation.**

**NO-GO for Production migration or UI cutover at this point.** The next gate must run the same RPC/permission/EXPLAIN/shadow suite on a healthy isolated Supabase branch with real schema definitions and production-like anonymized cardinalities. The 33 ambiguous-link cases must remain explicitly withheld or be reviewed; they must never be auto-selected.
