const ARAMEX_RE = /aramex|أرامكس|ارامكس/i;

export function isAramexCarrier(carrier) {
  return ARAMEX_RE.test(`${carrier?.id || ''} ${carrier?.name || ''}`);
}

export function manualPeriodFallback({ carrier, colMap = {}, confirmed = false } = {}) {
  const eligible = isAramexCarrier(carrier) && !colMap.shipDate;
  return {
    eligible,
    active: eligible && confirmed,
    precision: eligible ? 'month' : null,
    shipmentDateAvailable: !eligible,
  };
}

export function missingAuditFields(schema, colMap = {}, options = {}) {
  const fallback = manualPeriodFallback({
    carrier: options.carrier,
    colMap,
    confirmed: options.manualPeriodConfirmed,
  });
  return (schema?.required || []).filter(field => {
    if (colMap[field]) return false;
    return !(field === 'shipDate' && fallback.active);
  });
}
