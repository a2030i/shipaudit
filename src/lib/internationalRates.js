export const INTERNATIONAL_COUNTRIES = [
  { code: 'ae', name: 'الإمارات العربية المتحدة', zone: 'gcc', flag: '🇦🇪', smsa: true, smsaRoad: true },
  { code: 'bh', name: 'البحرين', zone: 'gcc', flag: '🇧🇭', smsa: true, smsaRoad: true },
  { code: 'kw', name: 'الكويت', zone: 'gcc', flag: '🇰🇼', smsa: true, smsaRoad: true },
  { code: 'om', name: 'عُمان', zone: 'gcc', flag: '🇴🇲', smsa: true, smsaRoad: true },
  { code: 'qa', name: 'قطر', zone: 'gcc', flag: '🇶🇦', smsa: true, smsaRoad: true },
  { code: 'eg', name: 'مصر', zone: 'gcc', flag: '🇪🇬', smsa: true },
  { code: 'jo', name: 'الأردن', zone: 'gcc', flag: '🇯🇴', smsa: true },
  { code: 'tr', name: 'تركيا', zone: 'smsa_only', flag: '🇹🇷', smsa: true },
  { code: 'us', name: 'الولايات المتحدة', zone: 'west', flag: '🇺🇸' },
  { code: 'uk', name: 'المملكة المتحدة', zone: 'west', flag: '🇬🇧' },
  { code: 'de', name: 'ألمانيا', zone: 'west', flag: '🇩🇪' },
  { code: 'fr', name: 'فرنسا', zone: 'west', flag: '🇫🇷' },
  { code: 'it', name: 'إيطاليا', zone: 'west', flag: '🇮🇹' },
  { code: 'es', name: 'إسبانيا', zone: 'west', flag: '🇪🇸' },
  { code: 'nl', name: 'هولندا', zone: 'west', flag: '🇳🇱' },
  { code: 'cn', name: 'الصين', zone: 'asia', flag: '🇨🇳' },
  { code: 'hk', name: 'هونغ كونغ', zone: 'asia', flag: '🇭🇰' },
  { code: 'in', name: 'الهند', zone: 'asia', flag: '🇮🇳' },
  { code: 'pk', name: 'باكستان', zone: 'asia', flag: '🇵🇰' },
  { code: 'kr', name: 'كوريا الجنوبية', zone: 'asia', flag: '🇰🇷' },
  { code: 'tw', name: 'تايوان', zone: 'asia', flag: '🇹🇼' },
  { code: 'bd', name: 'بنغلاديش', zone: 'asia', flag: '🇧🇩' },
  { code: 'ph', name: 'الفلبين', zone: 'asia', flag: '🇵🇭' },
];

const RATE_WEIGHTS = [0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,9.5,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25];

const TABLES = {
  outbound_west: {
    countries: ['us','uk','de','fr','it','es','nl'], extra: [22,8,19,17,19,19,17],
    document: [[48,39,35,72,48,35,49],[70,47,53,89,66,54,66],[92,54,72,106,84,74,83],[113,61,90,123,103,94,100]],
    parcel: [[51,40,36,73,49,36,50],[73,48,54,90,67,55,67],[95,55,73,107,85,75,84],[116,62,91,124,104,95,101],[138,69,110,141,122,115,118],[160,77,128,158,140,134,135],[182,84,147,176,158,154,152],[204,91,165,193,177,174,169],[225,99,184,210,195,194,186],[247,106,202,227,213,213,204],[269,113,221,244,232,233,221],[291,121,239,261,250,253,238],[313,128,258,278,268,273,255],[334,135,276,295,286,292,272],[356,143,295,312,305,312,289],[378,150,313,329,323,332,306],[400,157,332,346,341,351,323],[421,165,351,363,360,371,340],[443,172,369,380,378,391,357],[465,186,388,397,396,411,374],[509,194,425,431,433,450,408],[552,208,462,466,469,490,442],[596,223,499,500,506,529,477],[639,238,536,534,542,569,511],[683,252,573,568,579,608,545],[727,267,610,602,615,648,579],[770,282,647,636,652,687,613],[814,296,684,670,689,727,647],[857,311,721,704,725,766,681],[901,325,758,739,762,806,715],[944,340,795,773,798,845,750],[988,355,832,807,835,885,784],[1032,369,869,841,871,924,818],[1075,384,906,875,908,964,852],[1119,399,943,909,945,1003,886]],
  },
  outbound_gcc: {
    countries: ['ae','kw','bh','om','qa','eg','jo'], extra: [5,7,6,7,9,8,7],
    document: [[24,30,23,25,26,25,26],[29,34,28,31,35,32,31],[34,38,32,37,43,39,37],[39,42,37,43,51,46,42]],
    parcel: [[25,31,24,26,27,26,27],[30,35,29,32,36,33,32],[35,39,33,38,44,40,38],[40,43,38,44,52,47,43],[45,47,42,49,60,54,49],[50,51,46,55,69,61,54],[55,55,51,61,77,68,60],[60,59,55,67,85,75,65],[64,63,60,73,94,82,71],[69,67,64,78,102,89,76],[74,71,69,84,110,96,82],[79,75,73,90,118,103,87],[84,79,78,96,127,110,93],[89,83,82,102,135,117,98],[94,87,87,108,143,124,104],[99,91,91,113,152,131,109],[104,95,96,119,160,138,115],[109,99,100,125,168,145,120],[114,103,104,131,176,152,126],[118,107,109,137,185,159,131],[128,115,118,148,201,173,142],[133,123,127,160,218,187,153],[138,131,136,172,234,201,164],[143,139,145,183,251,215,175],[148,146,154,195,268,229,186],[153,154,162,207,284,243,197],[158,162,171,218,301,257,208],[168,170,180,230,317,271,219],[178,182,189,241,334,285,230],[188,194,198,253,350,299,242],[198,206,207,265,367,313,253],[208,218,216,276,384,327,264],[218,230,225,288,400,341,275],[228,242,234,300,417,355,286],[238,254,243,311,433,369,297]],
  },
  outbound_asia: {
    countries: ['cn','hk','in','pk','kr','tw','bd','ph'], extra: [20,15,15,11,18,16,11,14],
    document: [[65,44,33,27,47,37,33,43],[84,58,47,38,64,53,43,56],[104,73,62,49,81,68,54,70],[123,87,76,60,98,84,64,83]],
    parcel: [[66,45,34,28,48,38,34,44],[85,59,48,39,65,54,44,57],[105,74,63,50,82,69,55,71],[124,88,77,61,99,85,65,84],[144,102,91,72,116,101,76,98],[163,117,106,83,133,117,86,111],[183,131,120,94,150,133,97,124],[202,146,135,105,167,149,107,138],[222,160,149,116,184,165,117,151],[241,174,163,127,201,180,128,165],[261,189,178,138,218,196,138,178],[280,203,192,149,235,212,149,191],[300,217,206,160,252,228,159,205],[319,232,221,171,269,244,170,218],[339,246,235,182,286,260,180,232],[358,261,250,193,303,275,191,245],[378,275,264,204,321,291,201,258],[397,289,278,215,338,307,212,272],[417,304,293,225,355,323,222,285],[436,318,307,236,372,339,233,299],[475,347,336,258,406,371,254,325],[514,376,365,280,440,402,275,352],[553,404,393,302,474,434,296,379],[592,433,422,324,508,466,317,406],[631,462,451,346,542,497,338,433],[670,491,480,368,576,529,359,459],[709,519,508,390,611,561,380,486],[748,548,537,412,645,592,400,513],[787,577,566,434,679,624,421,540],[826,606,595,456,713,656,442,567],[865,634,624,478,747,687,463,594],[904,663,652,500,781,719,484,620],[943,692,681,522,815,751,505,647],[982,721,710,544,849,782,526,674],[1021,750,739,566,884,814,547,701]],
  },
};

const SMSA_AIR = {
  ae: [29,10], bh: [29,10], eg: [29,11], kw: [29,10],
  om: [35,14], qa: [35,14], jo: [35,14], tr: [35,14],
};

const SMSA_ROAD = {
  ae: [28,8], bh: [28,8], kw: [28,8], om: [31,11], qa: [28,8],
};

const ARAMEX_RSS_FIXED = 7.5;
const ARAMEX_FUEL_RATE = 0.39;
const SMSA_FUEL_RATE = 0.31;

const roundMoney = value => Math.round((Number(value) + 1e-9) * 100) / 100;
const positive = value => Math.max(0, Number(value) || 0);

export function calculateChargeableWeight(input) {
  const {
    weight = 0.5, length = 25, width = 10, height = 10,
  } = input || {};
  const actualWeight = Math.max(0.01, positive(weight) || 0.5);
  const dimensions = [length, width, height].map(positive);
  const hasCompleteDimensions = dimensions.every(value => value > 0);
  const volumetricWeight = hasCompleteDimensions
    ? (dimensions[0] * dimensions[1] * dimensions[2]) / 5000
    : 0;

  return {
    actualWeight,
    volumetricWeight,
    chargeableWeight: Math.max(actualWeight, volumetricWeight),
    hasCompleteDimensions,
  };
}

function aramexBase({ country, weight }) {
  const countryInfo = INTERNATIONAL_COUNTRIES.find(item => item.code === country);
  if (!countryInfo || countryInfo.zone === 'smsa_only') return null;
  const table = TABLES[`outbound_${countryInfo.zone}`];
  const countryIndex = table?.countries.indexOf(country) ?? -1;
  if (!table || countryIndex < 0) return null;

  const actualWeight = Math.max(0.01, positive(weight));
  let billedWeight;
  if (actualWeight <= 10) billedWeight = Math.ceil(actualWeight * 2) / 2;
  else if (actualWeight <= 25) billedWeight = Math.ceil(actualWeight);
  else billedWeight = Math.ceil(actualWeight * 2) / 2;

  if (billedWeight <= 25) {
    const rowIndex = RATE_WEIGHTS.indexOf(billedWeight);
    const basePrice = table.parcel[0][countryIndex];
    const shippingRate = table.parcel[rowIndex][countryIndex];
    return { basePrice, additionalWeightCharge: shippingRate - basePrice, shippingRate, billedWeight, rateKind: 'parcel' };
  }

  const extraHalfKg = Math.ceil((billedWeight - 25) * 2);
  const basePrice = table.parcel[0][countryIndex];
  const shippingRate = table.parcel[table.parcel.length - 1][countryIndex] + (extraHalfKg * table.extra[countryIndex]);
  return {
    basePrice,
    additionalWeightCharge: shippingRate - basePrice,
    shippingRate,
    billedWeight,
    rateKind: 'parcel',
  };
}

function smsaBase(country, weight, service) {
  const tariff = service === 'road' ? SMSA_ROAD[country] : SMSA_AIR[country];
  if (!tariff) return null;
  const actualWeight = Math.max(0.01, positive(weight));
  if (service === 'road') {
    const additionalKg = Math.max(0, Math.ceil(actualWeight - 2));
    const additionalWeightCharge = additionalKg * tariff[1];
    return {
      basePrice: tariff[0], additionalWeightCharge, shippingRate: tariff[0] + additionalWeightCharge,
      billedWeight: Math.max(2, Math.ceil(actualWeight)), rateKind: 'parcel',
    };
  }
  const additionalHalfKg = Math.max(0, Math.ceil((actualWeight - 0.5) * 2));
  const additionalWeightCharge = additionalHalfKg * tariff[1];
  return {
    basePrice: tariff[0], additionalWeightCharge, shippingRate: tariff[0] + additionalWeightCharge,
    billedWeight: Math.max(0.5, Math.ceil(actualWeight * 2) / 2), rateKind: 'parcel',
  };
}

function finishCostBreakdown(rows = []) {
  return rows.map(row => ({
    ...row,
    shipping: roundMoney(row.shipping),
    fuel: roundMoney(row.fuel),
    rss: roundMoney(row.rss),
    total: roundMoney(row.shipping + row.fuel + row.rss),
  }));
}

function finishQuote(quote) {
  const subtotal = quote.lines.reduce((sum, line) => sum + line.amount, 0);
  const roundedLines = quote.lines.map(line => ({ ...line, amount: roundMoney(line.amount) }));
  const fuelCharge = roundedLines
    .filter(line => line.key === 'fuel')
    .reduce((sum, line) => sum + line.amount, 0);
  const otherChargesSar = roundedLines
    .filter(line => !['base', 'additional-weight', 'fuel'].includes(line.key))
    .reduce((sum, line) => sum + line.amount, 0);
  return {
    ...quote,
    basePrice: roundMoney(quote.basePrice),
    additionalWeightCharge: roundMoney(quote.additionalWeightCharge),
    fuelCharge: roundMoney(fuelCharge),
    otherChargesSar: roundMoney(otherChargesSar),
    costBreakdown: finishCostBreakdown(quote.costBreakdown),
    lines: roundedLines,
    total: roundMoney(subtotal),
  };
}

export function calculateInternationalQuotes(input) {
  const {
    direction = 'outbound', country = 'ae',
  } = input || {};
  if (direction !== 'outbound') return [];
  const countryInfo = INTERNATIONAL_COUNTRIES.find(item => item.code === country);
  if (!countryInfo) return [];
  const weightMetrics = calculateChargeableWeight(input);
  const weight = weightMetrics.chargeableWeight;
  const quotes = [];

  const aramexRate = aramexBase({ country, weight });
  if (aramexRate) {
    const lines = [{ key: 'base', label: 'السعر الأساسي', amount: aramexRate.basePrice }];
    if (aramexRate.additionalWeightCharge) lines.push({ key: 'additional-weight', label: 'الوزن الإضافي', amount: aramexRate.additionalWeightCharge });
    lines.push({ key: 'rss', label: 'رسوم RSS الثابتة', amount: ARAMEX_RSS_FIXED });
    const aramexShippingRate = aramexRate.basePrice + aramexRate.additionalWeightCharge;
    lines.push({
      key: 'fuel',
      label: 'رسوم الوقود (39%)',
      amount: aramexShippingRate * ARAMEX_FUEL_RATE,
    });
    quotes.push(finishQuote({
      id: 'aramex', carrier: 'أرامكس', service: 'Express Worldwide',
      basePrice: aramexRate.basePrice, additionalWeightCharge: aramexRate.additionalWeightCharge,
      costBreakdown: [
        {
          key: 'base', label: 'السعر الأساسي', shipping: aramexRate.basePrice,
          fuel: aramexRate.basePrice * ARAMEX_FUEL_RATE, rss: ARAMEX_RSS_FIXED,
        },
        {
          key: 'additional', label: 'الوزن الإضافي', shipping: aramexRate.additionalWeightCharge,
          fuel: aramexRate.additionalWeightCharge * ARAMEX_FUEL_RATE, rss: 0,
        },
      ],
      billedWeight: aramexRate.billedWeight, ...weightMetrics, lines,
    }));
  }

  if (countryInfo.smsa) {
    const smsaServices = SMSA_ROAD[country] ? ['road'] : ['air'];
    for (const service of smsaServices) {
      const smsaRate = smsaBase(country, weight, service);
      if (!smsaRate) continue;
      const lines = [{ key: 'base', label: 'السعر الأساسي', amount: smsaRate.basePrice }];
      if (smsaRate.additionalWeightCharge) lines.push({ key: 'additional-weight', label: 'الوزن الإضافي', amount: smsaRate.additionalWeightCharge });
      const rss = smsaRate.shippingRate * 0.16;
      lines.push({ key: 'rss', label: 'رسوم المخاطر والأمن RSS (16%)', amount: rss });
      lines.push({ key: 'fuel', label: 'رسوم الوقود (31% — أغسطس)', amount: smsaRate.shippingRate * SMSA_FUEL_RATE });
      quotes.push(finishQuote({
        id: `smsa-${service}`, carrier: 'سمسا', service: service === 'road' ? 'Ecommerce Road' : 'Ecommerce Air',
        basePrice: smsaRate.basePrice, additionalWeightCharge: smsaRate.additionalWeightCharge,
        costBreakdown: [
          {
            key: 'base', label: 'السعر الأساسي', shipping: smsaRate.basePrice,
            fuel: smsaRate.basePrice * SMSA_FUEL_RATE, rss: smsaRate.basePrice * 0.16,
          },
          {
            key: 'additional', label: 'الوزن الإضافي', shipping: smsaRate.additionalWeightCharge,
            fuel: smsaRate.additionalWeightCharge * SMSA_FUEL_RATE,
            rss: smsaRate.additionalWeightCharge * 0.16,
          },
        ],
        billedWeight: smsaRate.billedWeight, ...weightMetrics, lines,
      }));
    }
  }

  return quotes.sort((a, b) => a.total - b.total).map((quote, index) => ({ ...quote, cheapest: index === 0 && quotes.length > 1, comparable: true }));
}
