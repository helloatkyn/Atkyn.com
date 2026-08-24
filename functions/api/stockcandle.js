/* functions/api/stockcandle.js — Cloudflare Pages Function
   Proxies stock candle data: Yahoo Finance (primary) → Finnhub (fallback).
   GET /api/stockcandle?symbol=AAPL&resolution=5&from=...&to=...
*/

const RESOLUTION_MAP = {
  '5':  { range: '1d',  interval: '5m'  },
  '15': { range: '5d',  interval: '15m' },
  '60': { range: '1mo', interval: '60m' },
  'D':  { range: '3mo', interval: '1d'  },
  'W':  { range: '1y',  interval: '1wk' },
};

async function fetchYahoo(symbol, res) {
  const { range, interval } = RESOLUTION_MAP[res] || RESOLUTION_MAP['5'];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}&includePrePost=false`;

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(6000),
  });
  if (!resp.ok) throw new Error(`Yahoo ${resp.status}`);

  const json   = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No data');

  const timestamps = result.timestamp || [];
  const quote      = result.indicators?.quote?.[0] || {};

  return {
    s: timestamps.length > 0 ? 'ok' : 'no_data',
    t: timestamps,
    o: quote.open   || [],
    h: quote.high   || [],
    l: quote.low    || [],
    c: quote.close  || [],
    v: quote.volume || [],
  };
}

async function fetchFinnhub(symbol, res, from, to, apiKey) {
  const url =
    `https://finnhub.io/api/v1/stock/candle` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=${encodeURIComponent(res)}` +
    `&from=${from}&to=${to}` +
    `&token=${apiKey}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!resp.ok) throw new Error(`Finnhub ${resp.status}`);

  return await resp.json(); // already Finnhub-format {s,t,o,h,l,c,v}
}

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

  const json = (data) => new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  });

  // ── Primary: Yahoo Finance ──
  try {
    const data = await fetchYahoo(symbol, res);
    if (data.s === 'ok') return json(data);
    throw new Error('Yahoo returned no_data');
  } catch (_yahooErr) {
    // ── Fallback: Finnhub ──
    if (!context.env.FINNHUB_API_KEY) {
      return json({ s: 'no_data', error: 'No data' });
    }
    try {
      const data = await fetchFinnhub(symbol, res, from, to, context.env.FINNHUB_API_KEY);
      return json(data);
    } catch (err) {
      return json({ s: 'no_data', error: err.message });
    }
  }
}
