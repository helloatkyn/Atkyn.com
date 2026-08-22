/* functions/api/stockcandle.js — Cloudflare Pages Function
   Primary: Yahoo Finance (no key, works weekends/after-hours)
   Fallback: Finnhub (FINNHUB_API_KEY, best production data)
   GET /api/stockcandle?symbol=AAPL&resolution=5&from=...&to=...
*/

const INTERVAL_MAP = { '5':'5m', '15':'15m', '60':'60m', 'D':'1d', 'W':'1wk' };

async function fetchYahoo(symbol, resolution, from, to) {
  const interval = INTERVAL_MAP[resolution] || '5m';
  const rangeSec = to - from;
  let yahooRange = '1d';
  if      (rangeSec <= 86400)       yahooRange = '1d';
  else if (rangeSec <= 5 * 86400)   yahooRange = '5d';
  else if (rangeSec <= 30 * 86400)  yahooRange = '1mo';
  else if (rangeSec <= 90 * 86400)  yahooRange = '3mo';
  else if (rangeSec <= 365 * 86400) yahooRange = '1y';
  else                              yahooRange = '2y';

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${yahooRange}&includePrePost=false`;

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!resp.ok) throw new Error(`Yahoo ${resp.status}`);

  const json   = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo: no result');

  const timestamps = result.timestamp;
  const ohlc       = result.indicators?.quote?.[0];
  if (!timestamps || !ohlc) throw new Error('Yahoo: no OHLC');

  const t = [], o = [], h = [], l = [], c = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (ts < from || ts > to) continue;
    if (ohlc.close[i] == null) continue;
    t.push(ts);
    o.push(ohlc.open[i]  ?? ohlc.close[i]);
    h.push(ohlc.high[i]  ?? ohlc.close[i]);
    l.push(ohlc.low[i]   ?? ohlc.close[i]);
    c.push(ohlc.close[i]);
  }

  if (t.length === 0) throw new Error('Yahoo: empty after filter');
  return { s: 'ok', t, o, h, l, c };
}

async function fetchFinnhub(symbol, resolution, from, to, apiKey) {
  const url =
    `https://finnhub.io/api/v1/stock/candle` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=${encodeURIComponent(resolution)}` +
    `&from=${from}&to=${to}` +
    `&token=${apiKey}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!resp.ok) throw new Error(`Finnhub ${resp.status}`);

  const data = await resp.json();
  if (data.s !== 'ok') throw new Error(`Finnhub: ${data.s}`);
  return data; // already {s,t,o,h,l,c}
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

  // ── Try Yahoo first ──────────────────────────────────────────
  try {
    const data = await fetchYahoo(symbol, res, from, to);
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });
  } catch (yahooErr) {
    // Yahoo failed — fall through to Finnhub
  }

  // ── Fallback: Finnhub ────────────────────────────────────────
  if (!context.env.FINNHUB_API_KEY) {
    return new Response(JSON.stringify({ s: 'no_data', error: 'No fallback key' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await fetchFinnhub(symbol, res, from, to, context.env.FINNHUB_API_KEY);
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });
  } catch (finnhubErr) {
    return new Response(JSON.stringify({ s: 'no_data', error: finnhubErr.message }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
}
