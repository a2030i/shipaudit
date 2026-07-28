// Retired discovery probe. Disabled.
Deno.serve(() => new Response('gone', { status: 410 }));
