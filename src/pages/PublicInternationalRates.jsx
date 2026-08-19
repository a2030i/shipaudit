import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Info, Sparkles } from 'lucide-react';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import {
  calculateChargeableWeight,
  calculateInternationalQuotes,
  INTERNATIONAL_COUNTRIES,
} from '../lib/internationalRates.js';
import './PublicInternationalRates.css';

const INITIAL_FORM = {
  country: '',
  weight: 0.5,
  length: 25,
  width: 10,
  height: 10,
};

const money = value => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function CarrierWordmark({ id }) {
  if (id === 'aramex') return <span className="ir-wordmark aramex">أرامكس</span>;
  return <span className="ir-wordmark smsa">سمسا</span>;
}

function QuoteRow({ quote }) {
  return (
    <article className={`ir-quote ${quote.cheapest ? 'best' : ''}`}>
      <div className="ir-quote-summary">
        <div className="ir-carrier">
          <CarrierWordmark id={quote.id} />
          <span>{quote.service}</span>
        </div>
        <div className="ir-quote-breakdown">
          <table className="ir-cost-table">
            <thead>
              <tr>
                <th>الجزء</th>
                <th>سعر الشحن</th>
                <th>الوقود</th>
                <th>RSS</th>
                <th>إجمالي الجزء</th>
              </tr>
            </thead>
            <tbody>
              {quote.costBreakdown.map(row => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{money(row.shipping)} ر.س</td>
                  <td>{money(row.fuel)} ر.س</td>
                  <td>{money(row.rss)} ر.س</td>
                  <td>{money(row.total)} ر.س</td>
                </tr>
              ))}
              <tr className="ir-cost-total">
                <th scope="row">المجموع النهائي</th>
                <td>{money(quote.basePrice + quote.additionalWeightCharge)} ر.س</td>
                <td>{money(quote.fuelCharge)} ر.س</td>
                <td>{money(quote.otherChargesSar)} ر.س</td>
                <td>{money(quote.total)} ر.س</td>
              </tr>
            </tbody>
          </table>
        </div>
        {quote.cheapest ? <span className="ir-best-label"><Sparkles size={15} /> الأوفر</span> : null}
      </div>
    </article>
  );
}

export default function PublicInternationalRates() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(null);

  const country = useMemo(
    () => INTERNATIONAL_COUNTRIES.find(item => item.code === submitted?.country),
    [submitted?.country],
  );
  const quotes = useMemo(() => (submitted ? calculateInternationalQuotes(submitted) : []), [submitted]);
  const formWeights = useMemo(() => calculateChargeableWeight(form), [form]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'حاسبة الشحن الدولي | لمحة';
    return () => { document.title = previousTitle; };
  }, []);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = event => {
    event.preventDefault();
    if (!form.country) return;
    setSubmitted({
      ...form,
      weight: Math.max(0.01, Number(form.weight) || 0.5),
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

          <label className="ir-label" htmlFor="ir-country">الوجهة</label>
          <div className="ir-select-wrap">
            <select id="ir-country" aria-label="الوجهة" value={form.country} onChange={event => update('country', event.target.value)} required>
              <option value="" disabled>اختر الوجهة</option>
              {INTERNATIONAL_COUNTRIES.map(item => (
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

          <fieldset className="ir-dimensions">
            <legend>أبعاد الشحنة (سم)</legend>
            {[
              { key: 'length', label: 'الطول' },
              { key: 'width', label: 'العرض' },
              { key: 'height', label: 'الارتفاع' },
            ].map(dimension => (
              <label key={dimension.key} htmlFor={`ir-${dimension.key}`}>
                <span>{dimension.label}</span>
                <input
                  id={`ir-${dimension.key}`}
                  type="number"
                  min="0.1"
                  step="0.1"
                  inputMode="decimal"
                  value={form[dimension.key]}
                  onChange={event => update(dimension.key, event.target.value)}
                  placeholder="0"
                  required
                />
              </label>
            ))}
          </fieldset>

          <div className="ir-weight-summary" aria-live="polite">
            <div><span>الوزن الحجمي</span><strong>{money(formWeights.volumetricWeight)} كجم</strong></div>
            <div><span>الوزن المعتمد</span><strong>{money(formWeights.chargeableWeight)} كجم</strong></div>
            <small>الطول × العرض × الارتفاع ÷ 5000، ويُعتمد الأعلى بين الحجمي والفعلي.</small>
          </div>

          <button className="ir-submit" type="submit">احسب السعر</button>
        </form>

        <section className="ir-results" aria-live="polite">
          {submitted ? (
            <>
              <div className="ir-results-head">
                <div>
                  <h2>نتائج أفضل الأسعار</h2>
                  <p>{country?.name} · طرد مدفوع · {money(quotes[0]?.chargeableWeight || submitted.weight)} كجم معتمد</p>
                </div>
                <span>من السعودية</span>
              </div>

              <div className="ir-quotes">
                {quotes.length ? quotes.map(quote => <QuoteRow key={quote.id} quote={quote} />) : (
                  <div className="ir-empty"><Info size={22} /> لا يوجد سعر منشور لهذه الحالة في المرفقات.</div>
                )}
              </div>
            </>
          ) : (
            <div className="ir-empty"><Info size={22} /> اختر الوجهة ثم اضغط «احسب السعر» لعرض النتائج.</div>
          )}

        </section>
      </section>

      <footer className="ir-footer">
        <strong>لمحة — أسعار أوضح، قرار أسرع</strong>
        <span>هذه حاسبة تقديرية وليست عرض سعر ملزمًا.</span>
      </footer>
    </main>
  );
}
