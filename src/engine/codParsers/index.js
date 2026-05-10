// Registry for COD-settlement parsers. Internal (outgoing) is universal;
// each carrier has its own incoming parser because remittance files vary.
//
// Adding a new carrier:
//   1. Create `<name>Remittance.js` exporting an object with the same
//      shape as aramexRemittanceParser ({ id, label, parse(allRows) }).
//   2. Import + register it in REMITTANCE_PARSERS below.
//   3. The carrier picker in /cod-settlements picks it up automatically.
//
// Parser contract:
//   parse(allRows: any[][]) → [{ awb: string, amount: number }]
//   Throws Error with an Arabic message if the file shape doesn't match.

import { internalSettlementParser } from './internalSettlement.js';
import { aramexRemittanceParser }   from './aramexRemittance.js';

export const INTERNAL_PARSER = internalSettlementParser;

export const REMITTANCE_PARSERS = {
  aramex: aramexRemittanceParser,
  // smsa: smsaRemittanceParser,   // future
  // dhl:  dhlRemittanceParser,    // future
};

// Convenience: the list of carriers we currently support for incoming
// reconciliation, ordered for display.
export function listSupportedCarriers() {
  return Object.values(REMITTANCE_PARSERS).map(p => ({ id: p.id, label: p.label }));
}
