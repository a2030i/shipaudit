import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInternationalQuotes } from '../src/lib/internationalRates.js';

const byId = (quotes, id) => quotes.find(quote => quote.id === id);

test('matches the supplied Aramex GCC parcel rows', () => {
  const parcel = calculateInternationalQuotes({ direction: 'outbound', country: 'ae', weight: 2 });
  assert.equal(byId(parcel, 'aramex').basePrice, 25);
  assert.equal(byId(parcel, 'aramex').additionalWeightCharge, 15);
  assert.equal(byId(parcel, 'aramex').total, 40);
});

test('uses exact Aramex world rows and the published over-25 half-kilo increment', () => {
  const at25 = calculateInternationalQuotes({ direction: 'outbound', country: 'us', weight: 25 });
  const at255 = calculateInternationalQuotes({ direction: 'outbound', country: 'us', weight: 25.5 });
  assert.equal(byId(at25, 'aramex').total, 1119);
  assert.equal(byId(at255, 'aramex').basePrice, 51);
  assert.equal(byId(at255, 'aramex').additionalWeightCharge, 1090);
  assert.equal(byId(at255, 'aramex').total, 1141);

  const inboundParcel = calculateInternationalQuotes({ direction: 'inbound', country: 'in', weight: 1.5 });
  assert.equal(byId(inboundParcel, 'aramex').total, 83);
});

test('matches SMSA road and air formulas and applies the published 16 percent RSS', () => {
  const oman = calculateInternationalQuotes({ direction: 'outbound', country: 'om', weight: 3 });
  assert.equal(byId(oman, 'smsa-road').basePrice, 31);
  assert.equal(byId(oman, 'smsa-road').additionalWeightCharge, 11);
  assert.equal(byId(oman, 'smsa-road').otherChargesSar, 6.72);
  assert.equal(byId(oman, 'smsa-road').total, 48.72);

  const turkey = calculateInternationalQuotes({ direction: 'outbound', country: 'tr', weight: 2 });
  assert.equal(byId(turkey, 'smsa-air').basePrice, 35);
  assert.equal(byId(turkey, 'smsa-air').additionalWeightCharge, 42);
  assert.equal(byId(turkey, 'smsa-air').otherChargesSar, 12.32);
  assert.equal(byId(turkey, 'smsa-air').total, 89.32);
});

test('does not invent SMSA inbound services', () => {
  const inbound = calculateInternationalQuotes({ direction: 'inbound', country: 'ae', weight: 2 });
  assert.deepEqual(inbound.map(quote => quote.id), ['aramex']);
});

test('keeps fuel and VAT at zero even when callers pass unsupported percentages', () => {
  const quotes = calculateInternationalQuotes({
    direction: 'outbound', country: 'ae', weight: 2,
    aramexFuelPct: 10, smsaFuelPct: 5, vatPct: 15,
  });
  const aramex = byId(quotes, 'aramex');
  const smsaRoad = byId(quotes, 'smsa-road');

  assert.equal(aramex.lines.some(line => ['fuel', 'vat'].includes(line.key)), false);
  assert.equal(aramex.fuelCharge, 0);
  assert.equal(aramex.otherChargesSar, 0);
  assert.equal(aramex.total, 40);
  assert.equal(smsaRoad.lines.some(line => ['fuel', 'vat'].includes(line.key)), false);
  assert.equal(smsaRoad.fuelCharge, 0);
  assert.equal(smsaRoad.otherChargesSar, 4.48);
  assert.equal(smsaRoad.total, 32.48);
  assert.equal(quotes.some(quote => quote.cheapest), true);
});
