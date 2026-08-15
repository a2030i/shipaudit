export const INVOICE_CAMPAIGN_BUCKETS = Object.freeze([
  Object.freeze({ key: 'inv1_15', label: '1–15 يوم', color: 'var(--green)' }),
  Object.freeze({ key: 'inv16_30', label: '16–30 يوم', color: 'color-mix(in srgb, var(--green) 55%, var(--gold))' }),
  Object.freeze({ key: 'inv31_60', label: '31–60 يوم', color: 'var(--gold)' }),
  Object.freeze({ key: 'inv61_90', label: '61–90 يوم', color: 'color-mix(in srgb, var(--gold) 50%, var(--red))' }),
  Object.freeze({ key: 'inv90p', label: 'أكثر من 90 يوم', color: 'var(--red)' }),
]);

export const OPENING_CAMPAIGN_BUCKET = Object.freeze({
  key: 'opening',
  label: 'رصيد افتتاحي غير مدفوع',
  color: 'var(--accent3)',
});

export const CUSTOMER_CAMPAIGN_BUCKETS = Object.freeze([
  ...INVOICE_CAMPAIGN_BUCKETS,
  OPENING_CAMPAIGN_BUCKET,
]);

export function campaignBucketAmount(customer, key) {
  return Math.max(0, Number(customer?.[key]) || 0);
}

export function selectedCampaignAmount(customer, selectedKeys) {
  if (!selectedKeys?.size) return Math.max(0, Number(customer?.owed) || 0);
  let total = 0;
  for (const key of selectedKeys) total += campaignBucketAmount(customer, key);
  return +total.toFixed(2);
}

export function campaignBucketLabel(selectedKeys) {
  if (!selectedKeys?.size) return '';
  return CUSTOMER_CAMPAIGN_BUCKETS
    .filter(bucket => selectedKeys.has(bucket.key))
    .map(bucket => bucket.label)
    .join(' + ');
}
