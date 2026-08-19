// Carrier workspace tab bar — the shared chrome that stitches the five
// carrier-scoped screens (profile / audits / COD / statements / ledger)
// into ONE perceived workspace. Each page renders this bar at its top
// when it knows which carrier it's scoped to; clicking a tab navigates
// to the sibling page pre-filtered to the same carrier. No page is
// re-mounted or embedded — pure navigation chrome, zero data coupling.

import { useNavigate } from 'react-router-dom';

const TABS = [
  { key: 'overview',   label: 'نظرة عامة',  to: (id) => `/carrier?id=${id}&view=overview` },
  { key: 'audits',     label: 'الفواتير والمراجعة', to: (id) => `/carrier?id=${id}&view=invoices` },
  { key: 'cod',        label: 'COD', to: (id) => `/carrier?id=${id}&view=account&panel=cod` },
  { key: 'statements', label: 'الكشوف', to: (id) => `/carrier?id=${id}&view=account&panel=statements` },
  { key: 'ledger',     label: 'الحساب والمدفوعات', to: (id) => `/carrier?id=${id}&view=account&panel=ledger` },
];

export default function CarrierTabs({ carrierId, carrierName, active }) {
  const navigate = useNavigate();
  if (!carrierId) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
      padding: '6px 8px', marginBottom: 18,
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12,
    }}>
      {carrierName && (
        <span style={{
          fontSize: 12.5, fontWeight: 700, color: 'var(--text)',
          padding: '5px 12px', whiteSpace: 'nowrap',
          borderInlineEnd: '1px solid var(--border)', marginInlineEnd: 4,
        }}>
          {carrierName}
        </span>
      )}
      {TABS.map(t => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => !isActive && navigate(t.to(carrierId))}
            style={{
              border: 'none', cursor: isActive ? 'default' : 'pointer',
              padding: '6px 13px', borderRadius: 9, fontSize: 12.5,
              fontFamily: 'var(--font-sans)', fontWeight: isActive ? 700 : 500,
              background: isActive ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
