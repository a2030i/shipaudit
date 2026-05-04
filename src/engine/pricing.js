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

export function calcTotal(contract, country, weight, shipDate, serviceType, origin = 'Saudi Arabia') {
  // Route-specific lookup first (e.g. "Kuwait → Saudi Arabia"), then dest-only fallback
  const routeKey = origin && origin !== 'Saudi Arabia' ? `${origin} → ${country}` : null;
  let pricingDef = (routeKey && contract?.pricing?.[routeKey]) || contract?.pricing?.[country];
  if (!pricingDef) return null;

  // Multi-type pricing: { Road: [...], Air: [...] }
  if (!Array.isArray(pricingDef) && typeof pricingDef === 'object' && pricingDef.first === undefined) {
    if (serviceType) {
      const key = Object.keys(pricingDef).find(k => k.toLowerCase() === serviceType.toLowerCase().trim());
      pricingDef = pricingDef[key] ?? pricingDef[Object.keys(pricingDef)[0]];
    } else {
      pricingDef = pricingDef[Object.keys(pricingDef)[0]];
    }
  }

  if (!pricingDef) return null;

  const delivery = calcDelivery(pricingDef, weight);
  if (delivery === null) return null;

  const date   = shipDate || '';
  const hasRSS = contract.rssStartDate ? date >= contract.rssStartDate : !!(contract.rss || contract.rssFixed);
  let rss = 0;
  if (hasRSS) {
    rss = contract.rssFixed
      ? +Number(contract.rssFixed).toFixed(4)                        // fixed SAR amount
      : +(delivery * (contract.rss ?? 0)).toFixed(4);                // percentage of delivery
  }

  // Fuel is always based on delivery only unless contract explicitly says delivery+rss
  const hasFuel = contract.fuelStartDate ? date >= contract.fuelStartDate : !!(contract.fuelPct);
  const fuelBase = contract.fuelBase === 'delivery+rss' ? delivery + rss : delivery;
  const fuel     = hasFuel ? +(fuelBase * (contract.fuelPct ?? 0)).toFixed(4) : 0;

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
