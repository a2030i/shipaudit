import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInternationalQuotes } from '../src/lib/internationalRates.js';

const byId = (quotes, id) => quotes.find(quote => quote.id === id);

test('matches the supplied Aramex GCC parcel and document rows', () => {
  const parcel = calculateInternationalQuotes({ direction: 'outbound', country: 'ae', shipmentType: 'parcel', weight: 2 });
  assert.equal(byId(parcel, 'aramex').base, 40);

  const document = calculateInternationalQuotes({ direction: 'outbound', country: 'ae', shipmentType: 'document', weight: 1 });
  assert.equal(byId(document, 'aramex').base, 29);
  assert.equal(document.some(quote => quote.id.startsWith('smsa')), false);
});

test('uses exact Aramex world rows and the published over-25 half-kilo increment', () => {
  const at25 = calculateInternationalQuotes({ direction: 'outbound', country: 'us', shipmentType: 'parcel', weight: 25 });
  const at255 = calculateInternationalQuotes({ direction: 'outbound', country: 'us', shipmentType: 'parcel', weight: 25.5 });
  assert.equal(byId(at25, 'aramex').base, 1119);
  assert.equal(byId(at255, 'aramex').base, 1141);

  const inboundDocument = calculateInternationalQuotes({ direction: 'inbound', country: 'in', shipmentType: 'document', weight: 1.5 });
  assert.equal(byId(inboundDocument, 'aramex').base, 82);
});

test('matches SMSA road and air formulas and applies the published 16 percent RSS', () => {
  const oman = calculateInternationalQuotes({ direction: 'outbound', country: 'om', shipmentType: 'parcel', weight: 3 });
  assert.equal(byId(oman, 'smsa-road').base, 42);
  assert.equal(byId(oman, 'smsa-road').total, 48.72);

  const turkey = calculateInternationalQuotes({ direction: 'outbound', country: 'tr', shipmentType: 'parcel', weight: 2 });
  assert.equal(byId(turkey, 'smsa-air').base, 77);
  assert.equal(byId(turkey, 'smsa-air').total, 89.32);
});

test('does not invent SMSA inbound or document services', () => {
  const inbound = calculateInternationalQuotes({ direction: 'inbound', country: 'ae', shipmentType: 'parcel', weight: 2 });
  assert.deepEqual(inbound.map(quote => quote.id), ['aramex']);

  const turkeyDocument = calculateInternationalQuotes({ direction: 'outbound', country: 'tr', shipmentType: 'document', weight: 0.5 });
  assert.deepEqual(turkeyDocument, []);
});

test('adds COD, optional fuel and VAT as separate auditable amounts', () => {
  const quotes = calculateInternationalQuotes({
    direction: 'outbound', country: 'ae', shipmentType: 'parcel', weight: 2,
    codUsd: 99, aramexFuelPct: 10, smsaFuelPct: 5, vatPct: 15,
  });
  const aramex = byId(quotes, 'aramex');
  const smsaRoad = byId(quotes, 'smsa-road');

  assert.equal(aramex.usdLines.find(line => line.key === 'cod-usd').amount, 6);
  assert.equal(aramex.foreignTotalUsd, 6);
  assert.equal(aramex.lines.find(line => line.key === 'fuel').amount, 4);
  assert.equal(aramex.total, 50.6);
  assert.equal(smsaRoad.lines.find(line => line.key === 'cod').amount, 6);
  assert.equal(smsaRoad.total, 45.86);
  assert.equal(quotes.some(quote => quote.cheapest), false);
});

test('leaves attachment boundary gaps unresolved instead of guessing', () => {
  const aramexBoundary = calculateInternationalQuotes({
    direction: 'outbound', country: 'ae', shipmentType: 'parcel', weight: 2, codUsd: 100,
  }).find(quote => quote.id === 'aramex');
  assert.equal(aramexBoundary.foreignTotalUsd, 0);
  assert.match(aramexBoundary.warnings.join(' '), /غير مغطاة صراحة/);

  const smsaBoundary = calculateInternationalQuotes({
    direction: 'outbound', country: 'ae', shipmentType: 'parcel', weight: 2, codUsd: 1000,
  }).find(quote => quote.id === 'smsa-road');
  assert.equal(smsaBoundary.foreignTotalUsd, 0);
  assert.match(smsaBoundary.warnings.join(' '), /غير محددة/);

  const smsaAbove = calculateInternationalQuotes({
    direction: 'outbound', country: 'ae', shipmentType: 'parcel', weight: 2, codUsd: 1100,
  }).find(quote => quote.id === 'smsa-road');
  assert.equal(smsaAbove.foreignTotalUsd, 11);
});
