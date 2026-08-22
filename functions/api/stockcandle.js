/* functions/api/stockcandle.js — Cloudflare Pages Function
   Proxies Finnhub candle API so FINNHUB_API_KEY stays server-side.
   GET /api/stockcandle?symbol=AAPL&resolution=5&from=...&to=...
*/

export async function onRequestGet(context) {
  const url    = new URL(context.request.url);
  const symbol = url.searchParams.get('symbol')     || '';
  const res    = url.searchParams.get('resolution') || '5';
  const from   = parseInt(url.searchParams.get('from') || '0', 10);
  const to     = parseInt(url.searchParams.get('to')   || '0', 10);

  if (!symbol || !from || !to) {
    return new Response(JSON.stringify({ s: 'error', error: 'Missing params' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!context.env.FINNHUB_API_KEY) {
    return new Response(JSON.stringify({ s: 'no_data', error: 'Misconfigured' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const finnhubUrl =
      `https://finnhub.io/api/v1/stock/candle` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&resolution=${encodeURIComponent(res)}` +
      `&from=${from}&to=${to}` +
      `&token=${context.env.FINNHUB_API_KEY}`;

    const resp = await fetch(finnhubUrl, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) throw new Error(`Finnhub ${resp.status}`);

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ s: 'no_data', error: err.message }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
}
