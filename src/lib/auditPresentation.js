import { evaluateApprovalGate } from './coreService.js';

const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

function proofMetadata(audit) {
  return audit?.control
    ?? audit?.summary?.control
    ?? audit?.colMap?.__control
    ?? audit?.col_map?.__control
    ?? null;
}

/**
 * One display contract for a carrier-invoice review.
 *
 * `diff` is the persisted output of the existing audit engine
 * (`summary.totalDiff` at save time). `driftPreTax` is a separate approval
 * tolerance signal and must never replace the invoice variance shown to the
 * operator or used to prefill a claim.
 */
export function auditPresentation(audit, { reviewStatus } = {}) {
  const summary = audit?.summary || {};
  const control = proofMetadata(audit);
  const rawStatus = reviewStatus ?? audit?.reviewStatus ?? audit?.review_status ?? 'pending';
  const isDraft = Boolean(audit?.isDraft);
  const fileName = audit?.fileName ?? audit?.file_name;
  const contractLabel = audit?.contractLabel ?? audit?.contract_label;
  const verified = isDraft
    ? Number(control?.version) >= 3 && control?.valid === true
    : audit?.verificationStatus === 'verified'
      || (Number(control?.version) >= 3
        && control?.valid === true
        && Boolean(fileName)
        && Boolean(contractLabel)
        && Boolean(control?.sourceHash)
        && Boolean(control?.sourcePath));

  const variance = finite(audit?.diff ?? summary.totalDiff);
  const storedShipmentCount = finite(audit?.rowCount ?? audit?.row_count ?? summary.total);
  const accessibleShipmentCount = finite(audit?.accessibleRowCount ?? storedShipmentCount);
  const issueCount = finite(
    audit?.issueCount
      ?? audit?.issue_count
      ?? audit?.mismatchCount
      ?? audit?.mismatch_count
      ?? summary.mismatch,
  );
  const effectiveStatus = verified ? rawStatus : 'legacy_unverified';
  const gate = evaluateApprovalGate(audit);

  return {
    variance,
    claimAmount: Math.max(0, variance),
    totalBilled: finite(audit?.totalBilled ?? audit?.total_billed ?? summary.totalBilled),
    totalExpected: finite(audit?.totalExpected ?? audit?.total_expected ?? summary.totalExpected),
    shipmentCount: accessibleShipmentCount,
    storedShipmentCount,
    issueCount,
    verified,
    rawStatus,
    reviewStatus: effectiveStatus,
    canApprove: verified && gate.canApprove,
    financiallyEligible: verified && rawStatus === 'approved',
    approvalGate: gate,
  };
}

export const AUDIT_REVIEW_LABELS = {
  approved: ['معتمدة', 'var(--green)'],
  rejected: ['مرفوضة', 'var(--red)'],
  pending: ['تحتاج مراجعة', 'var(--gold)'],
  draft: ['مسودة', 'var(--muted)'],
  legacy_unverified: ['تاريخية غير موثقة', 'var(--gold)'],
};
