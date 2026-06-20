import { makeRemittanceParser } from './genericRemittance.js';
import { SMSA_AWB_KEYS, SMSA_AMT_KEYS } from './smsaRemittance.js';

// SMSA branches account (RX8668). Identical "COD Collection Report"
// workbook to the main SMSA account (RX5251) — same @smsaexpress.com
// schema — so it re-uses the shared column synonyms. Only the carrier
// id/label differ, so the parsed COD rows land under carrier_id
// 'smsa_branches' (which already exists as an audited carrier).
export const smsaBranchesRemittanceParser = makeRemittanceParser({
  id:    'smsa_branches',
  label: 'سمسا - فروع',
  awbKeys: SMSA_AWB_KEYS,
  amtKeys: SMSA_AMT_KEYS,
});
