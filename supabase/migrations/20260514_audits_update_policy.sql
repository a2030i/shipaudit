-- audits.update policy was missing entirely. The table had SELECT,
-- INSERT, and DELETE policies but no UPDATE, so every flow that
-- relied on UPDATE silently failed:
--   • approveAudit / rejectAudit / reopenAudit
--   • weight-billing export's flip from pending → exported
--   • markExportBilled (which also updates audits via weight billing)
--
-- The user noticed after pulling weight billing: the export Excel was
-- generated, weight_billing_exports got a row, but the audits stayed
-- at status='pending' and kept showing in the "9 مراجعات جديدة"
-- counter.

DROP POLICY IF EXISTS audits_update ON audits;
CREATE POLICY audits_update ON audits
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Backfill: the user already pulled weight billing for 7 audits
-- before this fix. The export row exists, so the audits' billing
-- status should match. Flip them now.
UPDATE audits
SET weight_billing_status = 'exported'
WHERE id IN (
  SELECT unnest(audit_ids)
  FROM weight_billing_exports
  WHERE status = 'exported'
);
