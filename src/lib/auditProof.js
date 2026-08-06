// One source of truth for audits that may feed financial or merchant-billing
// workflows. Historical rows remain readable, but are not operational proof.
export function getAuditControl(audit) {
  return audit?.control
    ?? audit?.summary?.control
    ?? audit?.colMap?.__control
    ?? audit?.col_map?.__control
    ?? null;
}

export function hasVerifiedAuditProof(audit) {
  const control = getAuditControl(audit);
  return hasAuditProofMetadata(audit) && control?.valid === true;
}

export function hasAuditProofMetadata(audit) {
  const control = getAuditControl(audit);
  const sourceFile = String(control?.fileName || audit?.fileName || audit?.file_name || '').trim();
  return Number(control?.version) >= 3
    && Boolean(sourceFile)
    && Array.isArray(control?.contractLabels)
    && control.contractLabels.length > 0;
}
