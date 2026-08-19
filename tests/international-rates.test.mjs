import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateChargeableWeight,
  calculateInternationalQuotes,
} from '../src/lib/internationalRates.js';

const byId = (quotes, id) => quotes.find(quote => quote.id === id);

test('matches the supplied Aramex GCC parcel rows', () => {
  const parcel = calculateInternationalQuotes({ direction: 'outbound', country: 'ae', weight: 2 });
  const aramex = byId(parcel, 'aramex');
  assert.equal(aramex.basePrice, 25);
  assert.equal(aramex.additionalWeightCharge, 15);
  assert.equal(aramex.otherChargesSar, 7.5);
  assert.equal(aramex.fuelCharge, 15.6);
  assert.equal(aramex.total, 63.1);
  assert.deepEqual(aramex.costBreakdown, [
    { key: 'base', label: 'السعر الأساسي', shipping: 25, fuel: 9.75, rss: 7.5, total: 42.25 },
    { key: 'additional', label: 'الوزن الإضافي', shipping: 15, fuel: 5.85, rss: 0, total: 20.85 },
  ]);
});

test('uses exact Aramex world rows and the published over-25 half-kilo increment', () => {
  const at25 = calculateInternationalQuotes({ direction: 'outbound', country: 'us', weight: 25 });
  const at255 = calculateInternationalQuotes({ direction: 'outbound', country: 'us', weight: 25.5 });
  assert.equal(byId(at25, 'aramex').total, 1562.91);
  assert.equal(byId(at255, 'aramex').basePrice, 51);
  assert.equal(byId(at255, 'aramex').additionalWeightCharge, 1090);
  assert.equal(byId(at255, 'aramex').total, 1593.49);
});

test('matches SMSA road and air formulas with 16 percent RSS and 31 percent August fuel', () => {
  const oman = calculateInternationalQuotes({ direction: 'outbound', country: 'om', weight: 3 });
  assert.equal(byId(oman, 'smsa-road').basePrice, 31);
  assert.equal(byId(oman, 'smsa-road').additionalWeightCharge, 11);
  assert.equal(byId(oman, 'smsa-road').otherChargesSar, 6.72);
  assert.equal(byId(oman, 'smsa-road').fuelCharge, 13.02);
  assert.equal(byId(oman, 'smsa-road').total, 61.74);
  assert.deepEqual(byId(oman, 'smsa-road').costBreakdown, [
    { key: 'base', label: 'السعر الأساسي', shipping: 31, fuel: 9.61, rss: 4.96, total: 45.57 },
    { key: 'additional', label: 'الوزن الإضافي', shipping: 11, fuel: 3.41, rss: 1.76, total: 16.17 },
  ]);

  const turkey = calculateInternationalQuotes({ direction: 'outbound', country: 'tr', weight: 2 });
  assert.equal(byId(turkey, 'smsa-air').basePrice, 35);
  assert.equal(byId(turkey, 'smsa-air').additionalWeightCharge, 42);
  assert.equal(byId(turkey, 'smsa-air').otherChargesSar, 12.32);
  assert.equal(byId(turkey, 'smsa-air').fuelCharge, 23.87);
  assert.equal(byId(turkey, 'smsa-air').total, 113.19);
});

test('shows only SMSA road for GCC destinations and air for other SMSA destinations', () => {
  for (const country of ['ae', 'kw', 'bh', 'qa', 'om']) {
    const quotes = calculateInternationalQuotes({ direction: 'outbound', country, weight: 0.5 });
    assert.equal(quotes.some(quote => quote.id === 'smsa-road'), true);
    assert.equal(quotes.some(quote => quote.id === 'smsa-air'), false);
  }

  const egypt = calculateInternationalQuotes({ direction: 'outbound', country: 'eg', weight: 0.5 });
  assert.equal(egypt.some(quote => quote.id === 'smsa-road'), false);
  assert.equal(egypt.some(quote => quote.id === 'smsa-air'), true);
});

test('rejects import-to-Saudi requests because the calculator is outbound only', () => {
  assert.deepEqual(calculateInternationalQuotes({ direction: 'inbound', country: 'ae', weight: 2 }), []);
});

test('uses the higher of actual and volumetric weight with a 5000 divisor', () => {
  const defaults = calculateChargeableWeight({ weight: 0.5 });
  assert.equal(defaults.volumetricWeight, 0.5);
  assert.equal(defaults.chargeableWeight, 0.5);

  const volumetric = calculateChargeableWeight({ weight: 2, length: 40, width: 30, height: 20 });
  assert.equal(volumetric.volumetricWeight, 4.8);
  assert.equal(volumetric.chargeableWeight, 4.8);

  const quotes = calculateInternationalQuotes({ country: 'ae', weight: 2, length: 40, width: 30, height: 20 });
  assert.equal(byId(quotes, 'aramex').total, 103.41);
  assert.equal(byId(quotes, 'smsa-road').total, 76.44);
  assert.equal(byId(quotes, 'aramex').chargeableWeight, 4.8);

  const actual = calculateInternationalQuotes({ country: 'ae', weight: 8, length: 20, width: 20, height: 20 });
  assert.equal(byId(actual, 'aramex').total, 145.11);
  assert.equal(byId(actual, 'aramex').chargeableWeight, 8);
});

test('uses fixed carrier fuel rules and ignores unsupported caller percentages and VAT', () => {
  const quotes = calculateInternationalQuotes({
    direction: 'outbound', country: 'ae', weight: 2,
    aramexFuelPct: 10, smsaFuelPct: 5, vatPct: 15,
  });
  const aramex = byId(quotes, 'aramex');
  const smsaRoad = byId(quotes, 'smsa-road');

  assert.equal(aramex.lines.some(line => line.key === 'vat'), false);
  assert.equal(aramex.lines.some(line => line.key === 'fuel'), true);
  assert.equal(aramex.fuelCharge, 15.6);
  assert.equal(aramex.otherChargesSar, 7.5);
  assert.equal(aramex.total, 63.1);
  assert.equal(smsaRoad.lines.some(line => line.key === 'vat'), false);
  assert.equal(smsaRoad.lines.some(line => line.key === 'fuel'), true);
  assert.equal(smsaRoad.fuelCharge, 8.68);
  assert.equal(smsaRoad.otherChargesSar, 4.48);
  assert.equal(smsaRoad.total, 41.16);
  assert.equal(quotes.some(quote => quote.cheapest), true);
});
