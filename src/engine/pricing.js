/**
 * Flexible tiered pricing engine.
 * Supports:
 *   - Legacy: { first, step, firstKg }
 *   - Tiered array (additive): [{ upTo, price }, { upTo, pricePerUnit, unitKg }, ...]
 *     upTo: null = unlimited last tier
 *   - Lookup table: { mode: 'lookup', brackets: [{ upTo, price }, ...], excess: { perUnit, unitKg } }
 *     Used by carriers that publish a flat per-bucket rate (e.g. Aramex international).
 *     Weight rounds UP to the smallest bracket whose `upTo` >= weight; that bracket's
 *     price is returned. If weight exceeds the last bracket, `excess` extends the table.
 */
export function calcDelivery(pricingDef, weight) {
  if (!pricingDef || weight <= 0) return null;

  // ── Legacy simple format ──────────────────────────────────────────────────
  if (!Array.isArray(pricingDef) && pricingDef.first !== undefined) {
    const { first, step, firstKg = 0.5 } = pricingDef;
    if (weight <= firstKg) return first;
    return first + Math.ceil((weight - firstKg) / 0.5) * step;
  }

  // ── Lookup table (per-bucket flat rate) ───────────────────────────────────
  if (!Array.isArray(pricingDef) && pricingDef.mode === 'lookup' && Array.isArray(pricingDef.brackets)) {
    const sorted = [...pricingDef.brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    const bucket = sorted.find(b => weight <= (b.upTo ?? Infinity));
    if (bucket) return +Number(bucket.price).toFixed(4);
    // Beyond last bracket → use excess rate from the last bracket's edge
    const last = sorted[sorted.length - 1];
    if (!last || !pricingDef.excess) return null;
    const lastUpTo = last.upTo ?? 0;
    const unitKg   = pricingDef.excess.unitKg   ?? 0.5;
    const perUnit  = pricingDef.excess.perUnit  ?? 0;
    const units    = Math.ceil((weight - lastUpTo) / unitKg);
    return +(Number(last.price) + units * perUnit).toFixed(4);
  }

  // ── Tiered array format (additive) ────────────────────────────────────────
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
  // (Lookup-mode pricing is also a non-array object, so guard against it explicitly.)
  if (!Array.isArray(pricingDef)
      && typeof pricingDef === 'object'
      && pricingDef.first === undefined
      && pricingDef.mode !== 'lookup') {
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

  // Per-destination fuel/RSS overrides take precedence over contract defaults.
  // Used when, e.g., domestic and international shipments share one contract
  // but apply different fuel-surcharge percentages.
  let fuelPctEff = pricingDef.fuelPct ?? contract.fuelPct ?? 0;

  // Per-date fuel rate history. Entries represent earlier periods with a
  // different rate, each capped by `upTo` (inclusive). The default `fuelPct`
  // applies to dates after the latest entry.
  //   fuelHistory: [{ upTo: '2026-03-02', pct: 0.235 }, ...]
  const fuelHist = pricingDef.fuelHistory ?? contract.fuelHistory;
  if (Array.isArray(fuelHist) && fuelHist.length && shipDate) {
    const sorted = [...fuelHist].sort((a, b) => (a.upTo || '').localeCompare(b.upTo || ''));
    const match = sorted.find(h => h.upTo && shipDate <= h.upTo);
    if (match) fuelPctEff = match.pct;
  }

  const rssPctEff  = pricingDef.rss     ?? contract.rss     ?? 0;
  const rssFixedEff = pricingDef.rssFixed ?? contract.rssFixed;

  const date   = shipDate || '';
  const hasRSS = contract.rssStartDate ? date >= contract.rssStartDate : !!(rssPctEff || rssFixedEff);
  let rss = 0;
  if (hasRSS) {
    rss = rssFixedEff
      ? +Number(rssFixedEff).toFixed(4)
      : +(delivery * rssPctEff).toFixed(4);
  }

  // Fuel is always based on delivery only unless contract explicitly says delivery+rss
  const hasFuel = contract.fuelStartDate ? date >= contract.fuelStartDate : !!fuelPctEff;
  const fuelBase = contract.fuelBase === 'delivery+rss' ? delivery + rss : delivery;
  const fuel     = hasFuel ? +(fuelBase * fuelPctEff).toFixed(4) : 0;

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
