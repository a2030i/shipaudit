# store_360_core — Final Pilot Contract

Status: validated as an additive Production read path. No existing table, service,
business calculation, or data was altered. See `PRODUCTION-SHADOW-REPORT.md`.

## 1. Input

```sql
store_360_core(p_store_id text) returns jsonb
```

- `p_store_id` is required, trimmed, non-empty, and at most 64 characters.
- The latest merchant snapshot is queried by exact `merchants.store_id = p_store_id`.
- Store lookup never falls back to store name or phone.
- Financial linkage is accepted only through an explicit `customer_merchant_links.store_id` association.
- A missing or non-unique financial association is returned as `unlinked`, `unresolved`, or `ambiguous`; the function never guesses.

## 2. Output

```json
{
  "contractVersion": 1,
  "storeId": "847",
  "generatedAt": "timestamptz",
  "sections": {
    "identity": {},
    "financialLink": {},
    "finance": {},
    "lastPayment": {},
    "collections": {},
    "sales": {}
  }
}
```

Every section has this envelope:

```json
{
  "visibility": "visible | restricted",
  "status": "available | empty | unlinked | unresolved | ambiguous | needs_review | restricted",
  "data": {},
  "source": {
    "source": "source identifier",
    "dataAsOf": "timestamptz | null",
    "lastSuccessfulSyncAt": "timestamptz | null",
    "availabilityStatus": "available | unavailable",
    "freshnessStatus": "fresh | delayed | stale | failed | unavailable",
    "errorCode": "text | null"
  }
}
```

Restricted sections always return `data = null` and `source = null`. They must not reveal names, identifiers, amounts, timestamps, counts, or source state.

### Identity

Grain: one exact `store_id` from the latest `merchants` snapshot.

Fields: store ID, display name, phone, visual status, integration type, billing type, shipment count, last shipment date, wallet balance, platform creation date, last top-up date.

### Financial link

Grain: explicit store-to-financial-account resolution.

- `resolved`: exactly one mapped customer name and exactly one current `customer_ar` contact.
- `unlinked`: no mapping.
- `unresolved`: mapping exists but no current financial account resolves.
- `ambiguous`: more than one mapping or financial account resolves.

No financial figures are emitted for ambiguous/unresolved links.

### Finance

Fields:

- `collectibleDue`: `customer_ar.collectible_due` unchanged.
- `overdue`: sum of collectible lines whose source status is overdue, plus opening-balance lines, matching current behavior.
- `oldestAgeDays` and open-invoice count from `customer_collectible_lines`.
- Aging: due today, 1–15, 16–30, 31–60, 61–90, +90, and opening balance.
- `bucketsTotal`: sum of the lines assigned to those buckets.
- `unallocatedDifference`: `collectibleDue - bucketsTotal`.
- `reconciledTotal`: `bucketsTotal + unallocatedDifference`.
- `reconciliationStatus`: `matched` only when the absolute difference is at most SAR 0.01; otherwise `needs_review`.

`unallocatedDifference` is not an invented aging bucket. It makes a current source inconsistency explicit instead of hiding it as zero or assigning it to a false age band.

### Last payment

The pilot preserves the current application behavior exactly: latest `zoho_payments.date` for the explicitly linked customer name, and the sum of payment rows on that date. It does not recalculate payment history.

### Collections

The most recently updated open `collection_tasks` row for the explicitly linked customer. Non-admin users see it only when assigned to them, unless they have `collections.view_all`.

### Sales

Current sales follow-up data is keyed by contact phone in `retargeting_followups`. The section is therefore labelled as a contact-point association and is never used to resolve store identity, financial identity, or ownership. It must not be presented as verified store identity. Store lookup still uses `store_id` only.

The Core does not return invoice details, shipment rows, support records, communication history, or timeline events. Those remain lazy detail queries opened by the relevant view.

## 3. Section permissions

| Section | Minimum permission | Additional scope |
|---|---|---|
| Identity | any of `merchants.view`, `receivables.view`, `sales.view`, `crm.view`, `support.view` | none |
| Financial link | `receivables.view` | none |
| Finance | `receivables.view` | none |
| Last payment | `receivables.view` | none |
| Collections | `collections.view` | assigned task only; `collections.view_all` or admin sees all |
| Sales | one of `sales.view`, `crm.view` | own/unassigned only; `crm.view_all` or admin sees all |

The function is `SECURITY DEFINER` only to enforce section-aware output consistently across underlying RLS surfaces. It requires `auth.uid()`, fixes `search_path` to empty, revokes execute from `PUBLIC` and `anon`, and grants execute only to `authenticated`. A caller with no permitted section is rejected.

## 4. Sources and freshness

| Section/field | Current source of truth | `dataAsOf` | Fresh | Delayed | Stale/failed behavior |
|---|---|---|---|---|---|
| Identity and aggregate shipment fields | latest local `merchants` snapshot | snapshot `uploaded_at` | <=18h | >18h to 24h | >24h stale; retain last known row |
| Financial link | `customer_merchant_links.store_id` | `linked_at` | local current projection | n/a | ambiguous/unresolved is explicit |
| Collectible due | `customer_ar.collectible_due` | invoice sync time | <=45m | >45m to 90m | >90m stale; failed sync retains last known value |
| Aging/overdue | `customer_collectible_lines` | invoice sync time | <=45m | >45m to 90m | same; never convert failure to zero |
| Last payment | current latest-date query on `zoho_payments` | payment sync time | <=45m | >45m to 90m | same; never synthesize a payment |
| Collection task/promise | `collection_tasks.updated_at` | task `updated_at` | local current | n/a | empty means no visible open task, not source failure |
| Sales/follow-up | `retargeting_followups.updated_at` plus merchant snapshot | greatest relevant timestamp | <=18h | >18h to 24h | stale contact association remains labelled |

Every returned field inherits its section source metadata. `fieldSources` lists the exact table/view field used where a section combines more than one local source.

## 5. Financial invariants

1. `finance.collectibleDue = customer_ar.collectible_due` to SAR 0.01.
2. Every named Aging bucket equals the matching rows in `customer_collectible_lines` to SAR 0.01.
3. `aging.bucketsTotal` equals the sum of the named buckets.
4. `aging.reconciledTotal = collectibleDue`.
5. Any gap between `customer_ar` and collectible lines is explicit in `unallocatedDifference` and changes the finance section to `needs_review`.
6. Last payment preserves the existing latest-date record selection and same-day sum.
7. An unavailable/failed source cannot turn a last-known non-zero amount into zero.

## 6. Query and update design

- Request shape: one local RPC call for Core.
- Update strategy: read-through over existing local tables/views; no new stored financial truth and no external request.
- Heavy details remain lazy.
- No new index is included in the prototype. The isolated plan meets the target with the production-equivalent indexes already represented. Index changes require a branch plan against real cardinalities first.
- The complete review-only SQL draft is [store_360_core_isolated.sql](./store_360_core_isolated.sql).
- The repeatable isolated harness is [run-isolated.mjs](./run-isolated.mjs).

## 7. Shadow and rollout contract

Application feature states:

- `off`: old path only.
- `shadow`: old path remains user-visible; Core runs in parallel and logs ID-only classifications/differences.
- `on`: Core is user-visible; lazy details still use their existing paths.

Automatic fallback to `off` is required for:

- any financial mismatch above SAR 0.01;
- a permission leak or authorization failure;
- RPC error/timeout;
- missing required section envelope;
- freshness failure incorrectly returned as zero.

The adapter is implemented with immediate legacy fallback. The Production cutover
defaults to `core` after a zero-mismatch Production shadow gate; setting
`VITE_STORE_360_CORE_READ_MODE=legacy` restores the established path.

## 8. Architecture guard

After an approved cutover, `store_360_core(store_id)` becomes the only official Store 360 Core entry point. The page must not reintroduce separate Core calls for merchant identity, financial totals, last payment, current collection task, or sales follow-up. Invoice rows, shipment rows, communication history, and timeline remain lazy per view.
