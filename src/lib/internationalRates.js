export const INTERNATIONAL_RATE_SOURCE_DATES = 'أرامكس: 2026 · سمسا: السنة غير ظاهرة في المرفق';

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
  inbound_west: {
    countries: ['us','uk','de','fr','it','es','nl'], extra: [16,15,14,16,15,17,14],
    document: [[86,89,75,81,145,80,81],[102,103,89,97,160,97,94],[117,118,103,113,174,115,107],[133,133,117,129,189,132,120]],
    parcel: [[87,90,76,82,146,81,82],[103,104,90,98,161,98,95],[118,119,104,114,175,116,108],[134,134,118,130,190,133,121],[149,149,132,146,205,151,135],[165,164,147,162,220,168,148],[180,179,161,178,234,186,161],[196,194,175,194,249,203,174],[211,208,189,210,264,221,188],[227,223,204,225,278,238,201],[242,238,218,241,293,256,214],[257,253,232,257,308,273,228],[273,268,246,273,323,290,241],[288,283,260,289,337,308,254],[304,297,275,305,352,325,267],[319,312,289,321,367,343,281],[335,327,303,337,381,360,294],[350,342,317,353,396,378,307],[366,357,332,369,411,395,320],[381,372,346,385,426,413,334],[412,401,374,417,455,448,360],[443,431,403,449,484,483,387],[474,461,431,480,514,517,413],[505,491,459,512,543,552,440],[536,520,488,544,573,587,467],[567,550,516,576,602,622,493],[598,580,545,608,632,657,520],[629,609,573,640,661,692,546],[660,639,602,672,690,727,573],[691,669,630,703,720,762,599],[722,698,659,735,749,797,626],[753,728,687,767,779,832,652],[784,758,715,799,808,867,679],[815,788,744,831,838,902,705],[846,817,772,863,867,936,732]],
  },
  outbound_gcc: {
    countries: ['ae','kw','bh','om','qa','eg','jo'], extra: [5,7,6,7,9,8,7],
    document: [[24,30,23,25,26,25,26],[29,34,28,31,35,32,31],[34,38,32,37,43,39,37],[39,42,37,43,51,46,42]],
    parcel: [[25,31,24,26,27,26,27],[30,35,29,32,36,33,32],[35,39,33,38,44,40,38],[40,43,38,44,52,47,43],[45,47,42,49,60,54,49],[50,51,46,55,69,61,54],[55,55,51,61,77,68,60],[60,59,55,67,85,75,65],[64,63,60,73,94,82,71],[69,67,64,78,102,89,76],[74,71,69,84,110,96,82],[79,75,73,90,118,103,87],[84,79,78,96,127,110,93],[89,83,82,102,135,117,98],[94,87,87,108,143,124,104],[99,91,91,113,152,131,109],[104,95,96,119,160,138,115],[109,99,100,125,168,145,120],[114,103,104,131,176,152,126],[118,107,109,137,185,159,131],[128,115,118,148,201,173,142],[133,123,127,160,218,187,153],[138,131,136,172,234,201,164],[143,139,145,183,251,215,175],[148,146,154,195,268,229,186],[153,154,162,207,284,243,197],[158,162,171,218,301,257,208],[168,170,180,230,317,271,219],[178,182,189,241,334,285,230],[188,194,198,253,350,299,242],[198,206,207,265,367,313,253],[208,218,216,276,384,327,264],[218,230,225,288,400,341,275],[228,242,234,300,417,355,286],[238,254,243,311,433,369,297]],
  },
  inbound_gcc: {
    countries: ['ae','kw','bh','om','qa','eg','jo'], extra: [6,24,6,7,20,9,7],
    document: [[46,65,46,50,60,49,48],[52,89,52,55,80,57,54],[56,113,58,62,99,65,61],[61,138,63,69,118,74,68]],
    parcel: [[47,66,47,49,61,50,49],[53,90,53,56,81,58,57],[59,114,59,63,100,66,65],[64,139,64,70,119,75,73],[70,163,70,77,139,83,81],[75,187,75,83,158,91,89],[81,211,81,90,178,100,97],[87,236,87,97,197,108,105],[92,260,92,104,217,116,113],[98,284,98,111,236,124,121],[104,308,104,118,255,133,130],[109,333,109,125,275,141,138],[115,357,115,132,294,149,146],[120,381,120,139,314,158,154],[126,405,126,146,333,166,162],[132,430,132,153,353,174,170],[137,454,137,160,372,182,178],[143,478,143,167,392,191,186],[149,502,149,174,411,199,194],[154,527,154,181,430,207,202],[165,575,165,195,469,224,219],[177,624,177,209,508,240,235],[188,672,188,223,547,257,251],[199,721,199,237,586,273,267],[210,769,210,251,625,290,283],[222,818,222,265,664,307,300],[233,866,233,279,703,323,316],[244,915,244,293,741,340,332],[255,963,255,307,780,356,348],[267,1012,267,321,819,373,364],[278,1060,278,335,858,389,381],[289,1109,289,349,897,406,397],[300,1157,300,362,936,423,413],[312,1206,312,376,975,439,429],[323,1254,323,390,1014,456,445]],
  },
  outbound_asia: {
    countries: ['cn','hk','in','pk','kr','tw','bd','ph'], extra: [20,15,15,11,18,16,11,14],
    document: [[65,44,33,27,47,37,33,43],[84,58,47,38,64,53,43,56],[104,73,62,49,81,68,54,70],[123,87,76,60,98,84,64,83]],
    parcel: [[66,45,34,28,48,38,34,44],[85,59,48,39,65,54,44,57],[105,74,63,50,82,69,55,71],[124,88,77,61,99,85,65,84],[144,102,91,72,116,101,76,98],[163,117,106,83,133,117,86,111],[183,131,120,94,150,133,97,124],[202,146,135,105,167,149,107,138],[222,160,149,116,184,165,117,151],[241,174,163,127,201,180,128,165],[261,189,178,138,218,196,138,178],[280,203,192,149,235,212,149,191],[300,217,206,160,252,228,159,205],[319,232,221,171,269,244,170,218],[339,246,235,182,286,260,180,232],[358,261,250,193,303,275,191,245],[378,275,264,204,321,291,201,258],[397,289,278,215,338,307,212,272],[417,304,293,225,355,323,222,285],[436,318,307,236,372,339,233,299],[475,347,336,258,406,371,254,325],[514,376,365,280,440,402,275,352],[553,404,393,302,474,434,296,379],[592,433,422,324,508,466,317,406],[631,462,451,346,542,497,338,433],[670,491,480,368,576,529,359,459],[709,519,508,390,611,561,380,486],[748,548,537,412,645,592,400,513],[787,577,566,434,679,624,421,540],[826,606,595,456,713,656,442,567],[865,634,624,478,747,687,463,594],[904,663,652,500,781,719,484,620],[943,692,681,522,815,751,505,647],[982,721,710,544,849,782,526,674],[1021,750,739,566,884,814,547,701]],
  },
  inbound_asia: {
    countries: ['cn','hk','in','pk','kr','tw','bd','ph'], extra: [28,24,14,19,28,25,13,12],
    document: [[80,74,54,69,93,87,53,76],[108,98,68,88,120,112,66,88],[136,122,82,107,148,137,79,101],[163,146,96,126,175,162,92,113]],
    parcel: [[81,75,55,70,94,88,54,77],[109,99,69,89,121,113,67,89],[137,123,83,108,149,138,80,102],[164,147,97,127,176,163,93,114],[192,171,111,146,204,188,106,126],[220,195,125,165,231,213,118,139],[248,219,138,184,259,238,131,151],[276,243,152,203,286,263,144,164],[303,267,166,222,314,288,157,176],[331,291,180,241,341,313,169,188],[359,315,194,260,368,338,182,201],[387,339,207,279,396,363,195,213],[415,363,221,298,423,389,208,225],[442,387,235,317,451,414,221,238],[470,410,249,336,478,439,233,250],[498,434,263,354,506,464,246,263],[526,458,276,373,533,489,259,275],[554,482,290,392,561,514,272,287],[582,506,304,411,588,539,284,300],[609,530,318,430,615,564,297,312],[665,578,346,468,670,614,323,337],[721,626,373,506,725,664,348,362],[776,674,401,544,780,714,374,386],[832,722,428,582,835,765,400,411],[887,770,456,620,890,815,425,436],[943,817,484,658,945,865,451,461],[999,865,511,695,1000,915,476,485],[1054,913,539,733,1055,965,502,510],[1110,961,567,771,1110,1015,527,535],[1166,1009,594,809,1164,1065,553,560],[1221,1057,622,847,1219,1115,578,584],[1277,1105,649,885,1274,1166,604,609],[1332,1153,677,923,1329,1216,630,634],[1388,1201,705,961,1384,1266,655,659],[1444,1248,732,999,1439,1316,681,683]],
  },
};

const SMSA_AIR = {
  ae: [29,10], bh: [29,10], eg: [29,11], kw: [29,10],
  om: [35,14], qa: [35,14], jo: [35,14], tr: [35,14],
};

const SMSA_ROAD = {
  ae: [28,8], bh: [28,8], kw: [28,8], om: [31,11], qa: [28,8],
};

const roundMoney = value => Math.round((Number(value) + 1e-9) * 100) / 100;
const positive = value => Math.max(0, Number(value) || 0);

function aramexBase({ direction, country, shipmentType, weight }) {
  const countryInfo = INTERNATIONAL_COUNTRIES.find(item => item.code === country);
  if (!countryInfo || countryInfo.zone === 'smsa_only') return null;
  const table = TABLES[`${direction}_${countryInfo.zone}`];
  const countryIndex = table?.countries.indexOf(country) ?? -1;
  if (!table || countryIndex < 0) return null;

  const actualWeight = Math.max(0.01, positive(weight));
  if (shipmentType === 'document' && actualWeight <= 2) {
    const billedWeight = Math.ceil(actualWeight * 2) / 2;
    const rowIndex = [0.5, 1, 1.5, 2].indexOf(billedWeight);
    return { base: table.document[rowIndex][countryIndex], billedWeight, rateKind: 'document' };
  }

  let billedWeight;
  if (actualWeight <= 10) billedWeight = Math.ceil(actualWeight * 2) / 2;
  else if (actualWeight <= 25) billedWeight = Math.ceil(actualWeight);
  else billedWeight = Math.ceil(actualWeight * 2) / 2;

  if (billedWeight <= 25) {
    const rowIndex = RATE_WEIGHTS.indexOf(billedWeight);
    return { base: table.parcel[rowIndex][countryIndex], billedWeight, rateKind: 'parcel' };
  }

  const extraHalfKg = Math.ceil((billedWeight - 25) * 2);
  return {
    base: table.parcel[table.parcel.length - 1][countryIndex] + (extraHalfKg * table.extra[countryIndex]),
    billedWeight,
    rateKind: 'parcel',
  };
}

function aramexCodFee(codUsd) {
  const value = positive(codUsd);
  if (!value) return { usd: 0, warning: '' };
  if (value < 100) return { usd: 6, warning: '' };
  if (value >= 101 && value <= 200) return { usd: 9, warning: '' };
  if (value >= 201 && value <= 300) return { usd: 12, warning: '' };
  if (value >= 301 && value <= 400) return { usd: 15, warning: '' };
  if (value >= 401 && value <= 500) return { usd: 18, warning: '' };
  return { usd: 0, warning: 'قيمة التحصيل هذه غير مغطاة صراحةً في شرائح أرامكس المرفقة.' };
}

function smsaBase(country, weight, service) {
  const tariff = service === 'road' ? SMSA_ROAD[country] : SMSA_AIR[country];
  if (!tariff) return null;
  const actualWeight = Math.max(0.01, positive(weight));
  if (service === 'road') {
    const additionalKg = Math.max(0, Math.ceil(actualWeight - 2));
    return { base: tariff[0] + (additionalKg * tariff[1]), billedWeight: Math.max(2, Math.ceil(actualWeight)), rateKind: 'parcel' };
  }
  const additionalHalfKg = Math.max(0, Math.ceil((actualWeight - 0.5) * 2));
  return { base: tariff[0] + (additionalHalfKg * tariff[1]), billedWeight: Math.max(0.5, Math.ceil(actualWeight * 2) / 2), rateKind: 'parcel' };
}

function smsaCodFee(country, codUsd) {
  const value = positive(codUsd);
  if (!value) return { sar: 0, usd: 0, warning: '' };
  if (value < 1000) return { sar: country === 'tr' ? 8 : 6, usd: 0, warning: '' };
  if (value > 1000) return { sar: 0, usd: value * 0.01, warning: '' };
  return { sar: 0, usd: 0, warning: 'قيمة 1,000 دولار نفسها غير محددة في جدول سمسا المرفق.' };
}

function finishQuote(quote, vatPct) {
  const subtotal = quote.lines.reduce((sum, line) => sum + line.amount, 0);
  const vat = subtotal * (positive(vatPct) / 100);
  const lines = vat > 0 ? [...quote.lines, { key: 'vat', label: `ضريبة (${positive(vatPct)}%)`, amount: vat }] : quote.lines;
  const usdLines = (quote.usdLines || []).map(line => ({ ...line, amount: roundMoney(line.amount) }));
  return {
    ...quote,
    lines: lines.map(line => ({ ...line, amount: roundMoney(line.amount) })),
    usdLines,
    foreignTotalUsd: roundMoney(usdLines.reduce((sum, line) => sum + line.amount, 0)),
    additions: roundMoney(subtotal - quote.base + vat),
    total: roundMoney(subtotal + vat),
  };
}

export function calculateInternationalQuotes(input) {
  const {
    direction = 'outbound', country = 'ae', shipmentType = 'parcel', weight = 0.5,
    codUsd = 0, dutiable = false, dangerousGoods = false,
    aramexFuelPct = 0, smsaFuelPct = 0, vatPct = 0,
  } = input || {};
  const countryInfo = INTERNATIONAL_COUNTRIES.find(item => item.code === country);
  if (!countryInfo) return [];
  const quotes = [];

  const aramexRate = aramexBase({ direction, country, shipmentType, weight });
  if (aramexRate) {
    const cod = aramexCodFee(codUsd);
    const lines = [{ key: 'base', label: 'السعر الأساسي', amount: aramexRate.base }];
    const usdLines = [];
    const fuel = aramexRate.base * (positive(aramexFuelPct) / 100);
    if (fuel) lines.push({ key: 'fuel', label: `وقود أرامكس (${positive(aramexFuelPct)}%)`, amount: fuel });
    if (cod.usd) usdLines.push({ key: 'cod-usd', label: 'خدمة التحصيل الدولي', amount: cod.usd });
    if (dutiable) lines.push({ key: 'clearance', label: 'رسوم تخليص مذكورة بالعقد', amount: 90 });
    if (dangerousGoods) lines.push({ key: 'dgr', label: 'رسوم المواد الخطرة', amount: countryInfo.zone === 'gcc' ? 4 : 37 });
    quotes.push(finishQuote({
      id: 'aramex', carrier: 'أرامكس', service: 'Express Worldwide', base: aramexRate.base,
      billedWeight: aramexRate.billedWeight, lines, usdLines,
      warnings: [cod.warning, positive(aramexFuelPct) ? '' : 'نسبة وقود أرامكس غير منشورة؛ لم تُضف تلقائيًا.', dutiable ? 'المستند يذكر أيضًا 100 ريال في سطر غير موضح؛ أكد الرسوم مع مدير الحساب.' : ''].filter(Boolean),
    }, vatPct));
  }

  if (direction === 'outbound' && countryInfo.smsa && shipmentType === 'parcel') {
    for (const service of ['road', 'air']) {
      const smsaRate = smsaBase(country, weight, service);
      if (!smsaRate) continue;
      const lines = [{ key: 'base', label: 'السعر الأساسي', amount: smsaRate.base }];
      const rss = smsaRate.base * 0.16;
      lines.push({ key: 'rss', label: 'رسوم المخاطر والأمن RSS (16%)', amount: rss });
      const fuel = smsaRate.base * (positive(smsaFuelPct) / 100);
      if (fuel) lines.push({ key: 'fuel', label: `وقود سمسا (${positive(smsaFuelPct)}%)`, amount: fuel });
      const cod = smsaCodFee(country, codUsd);
      const usdLines = [];
      if (cod.sar) lines.push({ key: 'cod', label: 'خدمة التحصيل', amount: cod.sar });
      if (cod.usd) usdLines.push({ key: 'cod-usd', label: 'خدمة التحصيل (1%)', amount: cod.usd });
      quotes.push(finishQuote({
        id: `smsa-${service}`, carrier: 'سمسا', service: service === 'road' ? 'Ecommerce Road' : 'Ecommerce Air',
        base: smsaRate.base, billedWeight: smsaRate.billedWeight, lines, usdLines,
        warnings: [cod.warning, positive(smsaFuelPct) ? '' : 'نسبة وقود سمسا غير منشورة؛ لم تُضف تلقائيًا.', dangerousGoods ? 'عرض سمسا المرسل لا يحدد رسوم المواد الخطرة.' : '', dutiable ? 'عرض سمسا المرسل لا يحدد رسوم التخليص الجمركي.' : ''].filter(Boolean),
      }, vatPct));
    }
  }

  const hasMixedCurrencies = quotes.some(quote => quote.foreignTotalUsd > 0);
  if (hasMixedCurrencies) return quotes.map(quote => ({ ...quote, cheapest: false, comparable: false }));
  return quotes.sort((a, b) => a.total - b.total).map((quote, index) => ({ ...quote, cheapest: index === 0 && quotes.length > 1, comparable: true }));
}
