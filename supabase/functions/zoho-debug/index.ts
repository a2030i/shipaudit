// zoho-debug — معطّل. كان فاحصاً مؤقتاً لاكتشاف حقل زاتكا (einvoice_details.status)،
// انتهت مهمته. يردّ 410 دائماً.
Deno.serve(() => new Response('gone', { status: 410 }));
