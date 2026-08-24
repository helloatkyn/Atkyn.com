/* functions/api/stockcandle.js — Cloudflare Pages Function
   Proxies Yahoo Finance v8 chart API for OHLCV candle data.
   GET /api/stockcandle?symbol=AAPL&resolution=5&from=...&to=...
*/

const RESOLUTION_MAP = {
  '5':  { range: '1d',  interval: '5m'  },
  '15': { range: '5d',  interval: '15m' },
  '60': { range: '1mo', interval: '60m' },
  'D':  { range: '3mo', interval: '1d'  },
  'W':  { range: '1y',  interval: '1wk' },
};

export async function onRequestGet(context) {
  const url    = new URL(context.request.url);
  const symbol = url.searchParams.get('symbol')     || '';
  const res    = url.searchParams.get('resolution') || '5';

  if (!symbol) {
    return new Response(JSON.stringify({ s: 'error', error: 'Missing symbol' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { range, interval } = RESOLUTION_MAP[res] || RESOLUTION_MAP['5'];

  try {
    const yahooUrl =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?range=${range}&interval=${interval}&includePrePost=false`;

    const resp = await fetch(yahooUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });

    if (!resp.ok) throw new Error(`Yahoo ${resp.status}`);

    const json   = await resp.json();
    const result = json?.chart?.result?.[0];

    if (!result) throw new Error('No data');

    const timestamps = result.timestamp || [];
    const quote      = result.indicators?.quote?.[0] || {};

    // Convert to Finnhub-compatible format so frontend needs zero changes
    const data = {
      s: timestamps.length > 0 ? 'ok' : 'no_data',
      t: timestamps,
      o: quote.open  || [],
      h: quote.high  || [],
      l: quote.low   || [],
      c: quote.close || [],
      v: quote.volume|| [],
    };

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
