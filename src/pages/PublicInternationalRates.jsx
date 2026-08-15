import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ChevronDown, Info, PackageCheck,
  Plane, Route, ShieldCheck, Sparkles,
} from 'lucide-react';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import {
  calculateInternationalQuotes,
  INTERNATIONAL_COUNTRIES,
  INTERNATIONAL_RATE_SOURCE_DATES,
} from '../lib/internationalRates.js';
import './PublicInternationalRates.css';

const INITIAL_FORM = {
  direction: 'outbound',
  country: 'ae',
  weight: 0.5,
  aramexFuelPct: 0,
  smsaFuelPct: 0,
  vatPct: 0,
};

const money = value => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function Segment({ value, onChange, options, ariaLabel }) {
  return (
    <div className="ir-segment" role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CarrierWordmark({ id }) {
  if (id === 'aramex') return <span className="ir-wordmark aramex">أرامكس</span>;
  return <span className="ir-wordmark smsa">سمسا</span>;
}

function QuoteRow({ quote, quoteKey }) {
  const metrics = [
    { label: 'السعر الأساسي', value: `${money(quote.basePrice)} ر.س` },
    { label: 'الوزن الإضافي', value: `${money(quote.additionalWeightCharge)} ر.س` },
    { label: 'رسوم الوقود', value: quote.fuelCharge ? `${money(quote.fuelCharge)} ر.س` : 'غير محددة' },
    { label: 'رسوم أخرى', value: `${money(quote.otherChargesSar)} ر.س` },
  ];
  return (
    <details className={`ir-quote ${quote.cheapest ? 'best' : ''}`} defaultOpen={quote.cheapest} key={`${quoteKey}-${quote.id}`}>
      <summary>
        <div className="ir-carrier">
          <CarrierWordmark id={quote.id} />
          <span>{quote.service}</span>
        </div>
        <div className="ir-quote-breakdown">
          {metrics.map(metric => (
            <div className="ir-quote-metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
          <div className="ir-quote-total">
            <span>المجموع</span>
            <strong>{money(quote.total)} ر.س</strong>
          </div>
        </div>
        {quote.cheapest ? <span className="ir-best-label"><Sparkles size={15} /> الأوفر</span> : null}
        <ChevronDown className="ir-chevron" size={21} aria-hidden="true" />
      </summary>
      <div className="ir-quote-details">
        <div className="ir-lines">
          {quote.lines.map(line => (
            <div key={line.key}>
              <span>{line.label}</span>
              <strong>{money(line.amount)} ر.س</strong>
            </div>
          ))}
          <div className="ir-billed-weight">
            <span>الوزن المحتسب</span>
            <strong>{quote.billedWeight} كجم</strong>
          </div>
        </div>
        {quote.warnings.length ? (
          <div className="ir-warnings">
            {quote.warnings.map(warning => <p key={warning}><AlertTriangle size={15} />{warning}</p>)}
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default function PublicInternationalRates() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(INITIAL_FORM);

  const country = useMemo(
    () => INTERNATIONAL_COUNTRIES.find(item => item.code === submitted.country),
    [submitted.country],
  );
  const availableCountries = useMemo(
    () => INTERNATIONAL_COUNTRIES.filter(item => form.direction === 'outbound' || item.zone !== 'smsa_only'),
    [form.direction],
  );
  const quotes = useMemo(() => calculateInternationalQuotes(submitted), [submitted]);
  const hasFuelInput = Number(submitted.aramexFuelPct) > 0 || Number(submitted.smsaFuelPct) > 0;
  const quoteKey = `${submitted.direction}-${submitted.country}-${submitted.weight}-${submitted.aramexFuelPct}-${submitted.smsaFuelPct}-${submitted.vatPct}`;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'حاسبة الشحن الدولي | لمحة';
    return () => { document.title = previousTitle; };
  }, []);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setDirection = direction => {
    setForm(current => ({
      ...current,
      direction,
      country: direction === 'inbound' && current.country === 'tr' ? 'ae' : current.country,
    }));
  };
  const submit = event => {
    event.preventDefault();
    setSubmitted({
      ...form,
      weight: Math.max(0.01, Number(form.weight) || 0.5),
      aramexFuelPct: Math.max(0, Number(form.aramexFuelPct) || 0),
      smsaFuelPct: Math.max(0, Number(form.smsaFuelPct) || 0),
      vatPct: Math.max(0, Number(form.vatPct) || 0),
    });
  };

  return (
    <main className="international-rates-page" dir="rtl">
      <header className="ir-header">
        <LamhaLogo height={38} />
        <a href="/" className="ir-home-link"><ArrowLeft size={18} /> العودة للرئيسية</a>
      </header>

      <section className="ir-intro">
        <h1>احسب تكلفة شحنتك الدولية</h1>
        <p>قارن أسعار أرامكس وسمسا حسب الجداول المرفقة.</p>
        <span>حاسبة عامة — لا يلزم تسجيل الدخول</span>
      </section>

      <section className="ir-workspace" aria-label="حاسبة أسعار الشحن الدولي">
        <form className="ir-form" onSubmit={submit}>
          <h2>بيانات الشحنة</h2>

          <label className="ir-label">الاتجاه</label>
          <Segment
            value={form.direction}
            onChange={setDirection}
            ariaLabel="اتجاه الشحنة"
            options={[
              { value: 'outbound', label: 'تصدير من السعودية', icon: <Plane size={18} /> },
              { value: 'inbound', label: 'استيراد إلى السعودية', icon: <PackageCheck size={18} /> },
            ]}
          />

          <label className="ir-label" htmlFor="ir-country">الدولة</label>
          <div className="ir-select-wrap">
            <select id="ir-country" value={form.country} onChange={event => update('country', event.target.value)}>
              {availableCountries.map(item => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" />
          </div>

          <div className="ir-weight-field">
            <label>
              <span>الوزن الفعلي (كجم)</span>
              <input type="number" min="0.01" step="0.01" value={form.weight} onChange={event => update('weight', event.target.value)} required />
            </label>
          </div>

          <details className="ir-assumptions">
            <summary><ShieldCheck size={17} /> افتراضات الوقود والضريبة <ChevronDown size={17} /></summary>
            <p>اترك النسبة صفرًا إذا لم يزوّدك مدير الحساب بها.</p>
            <div className="ir-three-fields">
              <label><span>وقود أرامكس %</span><input type="number" min="0" step="0.1" value={form.aramexFuelPct} onChange={event => update('aramexFuelPct', event.target.value)} /></label>
              <label><span>وقود سمسا %</span><input type="number" min="0" step="0.1" value={form.smsaFuelPct} onChange={event => update('smsaFuelPct', event.target.value)} /></label>
              <label><span>الضريبة %</span><input type="number" min="0" step="0.1" value={form.vatPct} onChange={event => update('vatPct', event.target.value)} /></label>
            </div>
          </details>

          <button className="ir-submit" type="submit">احسب السعر</button>
        </form>

        <section className="ir-results" aria-live="polite">
          <div className="ir-results-head">
            <div>
              <h2>نتائج أفضل الأسعار</h2>
              <p>{country?.name} · طرد مدفوع · {submitted.weight} كجم</p>
            </div>
            <span>{submitted.direction === 'outbound' ? 'من السعودية' : 'إلى السعودية'}</span>
          </div>

          <div className="ir-quotes">
            {quotes.length ? quotes.map(quote => <QuoteRow key={quote.id} quote={quote} quoteKey={quoteKey} />) : (
              <div className="ir-empty"><Info size={22} /> لا يوجد سعر منشور لهذه الحالة في المرفقات.</div>
            )}
          </div>

          <div className="ir-info-rail">
            <Info size={18} />
            <span>{hasFuelInput
                ? 'رسوم الوقود محتسبة فقط من النسبة التي أدخلتها.'
                : 'رسوم الوقود موضحة كغير محددة لأن نسبتها غير موجودة في المرفقات.'}</span>
            <span>{INTERNATIONAL_RATE_SOURCE_DATES}</span>
          </div>
        </section>
      </section>

      <section className="ir-detail-band">
        <div className="ir-comparison">
          <h2>تفاصيل المقارنة</h2>
          <div className="ir-table-scroll">
            <table>
              <thead><tr><th>الناقل</th><th>الخدمة</th><th>السعر الأساسي</th><th>الوزن الإضافي</th><th>رسوم الوقود</th><th>رسوم أخرى</th><th>المجموع</th></tr></thead>
              <tbody>
                {quotes.map(quote => (
                  <tr key={quote.id}>
                    <td><CarrierWordmark id={quote.id} /></td>
                    <td>{quote.service}</td>
                    <td>{money(quote.basePrice)} ر.س</td>
                    <td>{money(quote.additionalWeightCharge)} ر.س</td>
                    <td>{quote.fuelCharge ? `${money(quote.fuelCharge)} ر.س` : 'غير محددة'}</td>
                    <td>{money(quote.otherChargesSar)} ر.س</td>
                    <td className={quote.cheapest ? 'lowest' : ''}>{money(quote.total)} ر.س</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="ir-method">
          <h2>كيف نحسب السعر؟</h2>
          <ol>
            <li><span>1</span><p>نأخذ السعر الأساسي والوزن الإضافي مباشرةً من جداول المرفقات.</p></li>
            <li><span>2</span><p>نعرض الوقود مستقلًا، ونجمع بقية الرسوم المنشورة تحت «رسوم أخرى».</p></li>
            <li><span>3</span><p>نضيف فقط نسب الوقود والضريبة التي أدخلتها.</p></li>
          </ol>
        </aside>
      </section>

      <section className="ir-source-note">
        <Route size={20} />
        <div>
          <strong>ما الذي تغطيه الحاسبة؟</strong>
          <p>الحاسبة مخصصة للطرد المدفوع فقط. كل الأرقام مأخوذة من ملف أرامكس وصورة أسعار سمسا المرفقين، ولا تقرأ العقود أو الأسعار المسجلة في النظام.</p>
        </div>
      </section>

      <footer className="ir-footer">
        <strong>لمحة — أسعار أوضح، قرار أسرع</strong>
        <span>هذه حاسبة تقديرية وليست عرض سعر ملزمًا.</span>
      </footer>
    </main>
  );
}
