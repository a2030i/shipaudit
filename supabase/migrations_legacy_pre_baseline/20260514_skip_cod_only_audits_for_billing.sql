-- COD-only audits (audit_type='cod', containing only Aramex ZDCF rows
-- where isCod=true) audit the per-shipment COD service fee against
-- contract.codFee. They share AWBs + weights with the underlying
-- shipment, but the shipment itself lives in a separate ZDOI audit.
-- These rows have nothing to bill the merchant for — the shipment's
-- weight is billed via the matching ZDOI audit.
--
-- Without this fix they sat in 'pending' on weight_billing_status
-- forever (the "X مراجعات جديدة" hero counter on /weight-billing
-- never dropped to zero, the user kept asking why pulls didn't clear
-- the queue).

UPDATE audits
SET weight_billing_status = 'skipped'
WHERE weight_billing_status = 'pending'
  AND audit_type = 'cod';
