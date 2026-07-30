// مطابقة مستقلة بين أرقام VAT Summary في زوهو وما تعيد بوابة زاتكا
// احتسابه تلقائياً من مبلغ الخانة.
//
// لا نعيد تصنيف الفواتير ولا نفترض أن كل المبيعات/المشتريات 15%:
// نراجع فقط الخانتين القياسيتين المؤكدتين في النموذج السعودي الحالي:
//   1 = المبيعات المحلية الخاضعة للنسبة الأساسية 15%
//   7 = المشتريات المحلية الخاضعة للنسبة الأساسية 15%
// وما عدا ذلك يبقى كما أرسله زوهو ويظهر للمحاسب دون تعديل صامت.

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const num = (value) => Number(value) || 0;

const STANDARD_RATE_BY_BOX = new Map([
  ['1', 0.15],
  ['7', 0.15],
]);

const TOTAL_BOXES = new Set(['6', '12']);

function reconcileSide(rows, zohoTotalTax) {
  let correction = 0;
  const checkedBoxes = [];

  const enriched = (rows || []).map((row) => {
    const boxNo = String(row.boxNo ?? '');
    const rate = STANDARD_RATE_BY_BOX.get(boxNo);
    if (rate == null || TOTAL_BOXES.has(boxNo)) {
      return { ...row, filingTax: num(row.tax), taxVariance: 0, taxRate: null };
    }

    // زاتكا تحسب ضريبة الخانة من المبلغ بعد أثر التعديل.
    const filingTax = round2((num(row.amount) + num(row.adjustment)) * rate);
    const taxVariance = round2(filingTax - num(row.tax));
    correction = round2(correction + taxVariance);
    checkedBoxes.push(boxNo);
    return { ...row, filingTax, taxVariance, taxRate: rate };
  });

  const filingTotalTax = round2(num(zohoTotalTax) + correction);
  return { rows: enriched, filingTotalTax, correction, checkedBoxes };
}

export function reconcileVatReturn({ output = [], input = [], net = [], totals = {} }) {
  const out = reconcileSide(output, totals.outputTax);
  const inp = reconcileSide(input, totals.inputTax);
  const zohoNetDue = totals.netDue == null
    ? round2(num(totals.outputTax) - num(totals.inputTax))
    : num(totals.netDue);
  const filingNetDue = round2(out.filingTotalTax - inp.filingTotalTax);
  const netVariance = round2(filingNetDue - zohoNetDue);

  const outputRows = out.rows.map((row) => (
    String(row.boxNo) === '6'
      ? { ...row, filingTax: out.filingTotalTax, taxVariance: out.correction }
      : row
  ));
  const inputRows = inp.rows.map((row) => (
    String(row.boxNo) === '12'
      ? { ...row, filingTax: inp.filingTotalTax, taxVariance: inp.correction }
      : row
  ));
  const netRows = (net || []).map((row) => (
    String(row.boxNo) === '13'
      ? { ...row, filingTax: filingNetDue, taxVariance: netVariance }
      : { ...row, filingTax: num(row.tax), taxVariance: 0 }
  ));

  return {
    output: outputRows,
    input: inputRows,
    net: netRows,
    checkedBoxes: [...out.checkedBoxes, ...inp.checkedBoxes],
    zoho: {
      outputTax: num(totals.outputTax),
      inputTax: num(totals.inputTax),
      netDue: zohoNetDue,
    },
    filing: {
      outputTax: out.filingTotalTax,
      inputTax: inp.filingTotalTax,
      netDue: filingNetDue,
    },
    variance: {
      outputTax: out.correction,
      inputTax: inp.correction,
      netDue: netVariance,
    },
    hasMismatch: Math.abs(netVariance) > 0.01
      || Math.abs(out.correction) > 0.01
      || Math.abs(inp.correction) > 0.01,
  };
}
