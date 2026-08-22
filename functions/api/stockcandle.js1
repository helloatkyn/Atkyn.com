/* functions/api/stockcandle.js — Cloudflare Pages Function
   Proxies Finnhub candle API so FINNHUB_API_KEY stays server-side.
   GET /api/stockcandle?symbol=AAPL&resolution=5&from=...&to=...
*/

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const symbol     = url.searchParams.get('symbol')     || '';
  const resolution = url.searchParams.get('resolution') || '5';
  const from       = url.searchParams.get('from')       || '';
  const to         = url.searchParams.get('to')         || '';

  if (!symbol || !from || !to) {
    return new Response(JSON.stringify({ error: 'Missing params' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.FINNHUB_API_KEY) {
    return new Response(JSON.stringify({ error: 'Misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const finnhubUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${env.FINNHUB_API_KEY}`;
    const resp = await fetch(finnhubUrl, { signal: AbortSignal.timeout(6000) });
    const data = await resp.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch {
    return new Response(JSON.stringify({ s: 'error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
