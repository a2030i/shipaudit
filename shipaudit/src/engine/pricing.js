/**
 * Flexible tiered pricing engine.
 * Supports:
 *   - Legacy: { first, step, firstKg }
 *   - Tiered array: [{ upTo, price }, { upTo, pricePerUnit, unitKg }, ...]
 *     upTo: null = unlimited last tier
 */
export function calcDelivery(pricingDef, weight) {
  if (!pricingDef || weight <= 0) return null;

  // ── Legacy simple format ──────────────────────────────────────────────────
  if (!Array.isArray(pricingDef) && pricingDef.first !== undefined) {
    const { first, step, firstKg = 0.5 } = pricingDef;
    if (weight <= firstKg) return first;
    return first + Math.ceil((weight - firstKg) / 0.5) * step;
  }

  // ── Tiered array format ───────────────────────────────────────────────────
  if (Array.isArray(pricingDef)) {
    let cost = 0;
    let remaining = weight;
    let prevUpTo = 0;

    for (const tier of pricingDef) {
      const tierMax  = tier.upTo ?? Infinity;
      const tierSize = tierMax - prevUpTo;
      const inTier   = Math.min(remaining, tierSize);
      if (inTier <= 0) break;

      if (tier.price !== undefined) {
        // Flat price for the base range
        cost += tier.price;
      } else if (tier.pricePerUnit !== undefined) {
        const unitKg = tier.unitKg ?? 0.5;
        const units  = Math.ceil(inTier / unitKg);
        cost += units * tier.pricePerUnit;
      }

      remaining -= inTier;
      prevUpTo   = tierMax;
      if (remaining <= 0) break;
    }
    return +cost.toFixed(4);
  }

  return null;
}

export function calcTotal(contract, country, weight, shipDate) {
  const pricingDef = contract?.pricing?.[country];
  if (!pricingDef) return null;

  const delivery = calcDelivery(pricingDef, weight);
  if (delivery === null) return null;

  const date    = shipDate || '';
  const hasRSS  = contract.rssStartDate ? date >= contract.rssStartDate : !!contract.rss;
  const rss     = hasRSS ? +(delivery * (contract.rss ?? 0)).toFixed(4) : 0;

  const fuelBase = contract.fuelBase === 'delivery' ? delivery : delivery + rss;
  const fuel     = +(fuelBase * (contract.fuelPct ?? 0)).toFixed(4);

  return {
    delivery,
    rss,
    fuel,
    total: +(delivery + rss + fuel).toFixed(4),
  };
}

/** Preview price for a weight — useful for showing a quick table */
export function previewPricing(pricingDef, weights = [0.5, 1, 2, 5, 10]) {
  return weights.map(w => ({ weight: w, price: calcDelivery(pricingDef, w) }));
}
