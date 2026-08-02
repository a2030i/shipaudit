// ألصق هذا السكربت في Google Sheets > Extensions > Apps Script.
// أنشئ Trigger للدالة onFormSubmit من نوع "From spreadsheet / On form submit".
// ضع WEBHOOK_URL وWEBHOOK_SECRET في Script Properties، لا داخل الورقة.
function onFormSubmit(e) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('WEBHOOK_URL');
  const secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('WEBHOOK_URL / WEBHOOK_SECRET غير مضبوطة');

  const values = e.namedValues || {};
  const first = (names) => {
    for (const name of names) {
      const value = values[name];
      if (Array.isArray(value) && value[0] != null) return String(value[0]).trim();
      if (value != null) return String(value).trim();
    }
    return '';
  };
  const sheet = e.range.getSheet();
  const eventId = `${sheet.getSheetId()}:${e.range.getRow()}:${e.values[0] || Date.now()}`;
  const payload = {
    event_id: eventId,
    submitted_at: first(['الطابع الزمني', 'Timestamp']) || new Date().toISOString(),
    name: first(['الاسم', 'Name']),
    phone: first(['رقم الجوال', 'الجوال', 'Phone']),
    email: first(['البريد الإلكتروني', 'Email']),
    city: first(['المدينة', 'City']),
    category: first(['النشاط', 'Activity']),
    expected_shipments: first(['عدد الشحنات المتوقع', 'Expected shipments']),
    campaign_name: first(['اسم الحملة', 'Campaign']) || props.getProperty('DEFAULT_CAMPAIGN_NAME') || 'حملة Google',
    utm_source: first(['utm_source']) || 'google',
    utm_medium: first(['utm_medium']) || 'paid',
    utm_campaign: first(['utm_campaign']),
    utm_content: first(['utm_content']),
    utm_term: first(['utm_term']),
    raw_named_values: values,
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const bytes = Utilities.computeHmacSha256Signature(`${timestamp}.${body}`, secret);
  const signature = bytes.map(b => (`0${(b & 255).toString(16)}`).slice(-2)).join('');
  const response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true,
    headers: { 'x-shipaudit-timestamp': timestamp, 'x-shipaudit-signature': `sha256=${signature}` },
  });
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
}
