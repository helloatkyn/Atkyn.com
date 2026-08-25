/* functions/api/stockcandle.js — Cloudflare Pages Function
   Proxies stock candle data: Yahoo Finance (primary) → Finnhub (fallback).
   GET /api/stockcandle?symbol=AAPL&resolution=5&from=...&to=...
   [PRODUCTION READY: Edge Caching, Strict Validation, Graceful Degradation]
*/

const RESOLUTION_MAP = {
  '5':  { range: '1d',  interval: '5m'  },
  '15': { range: '5d',  interval: '15m' },
  '60': { range: '1mo', interval: '60m' },
  'D':  { range: '3mo', interval: '1d'  },
  'W':  { range: '1y',  interval: '1wk' },
};

// 1. STRICT VALIDATION & SANITIZATION
function sanitizeSymbol(symbol) {
  if (!symbol) return '';
  // Allow only uppercase letters, numbers, and dots (for exchanges like RELIANCE.NS)
  return symbol.toUpperCase().replace(/[^A-Z0-9.]/g, '');
}

async function fetchYahoo(symbol, res) {
  const { range, interval } = RESOLUTION_MAP[res] || RESOLUTION_MAP['5'];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}&includePrePost=false`;

  const resp = await fetch(url, {
    headers: { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(4000), // Reduced to 4s for faster fallback
  });
  
  if (!resp.ok) throw new Error(`Yahoo HTTP ${resp.status}`);

  const json = await resp.json();
  const result = json?.chart?.result?.[0];
  
  if (!result || !Array.isArray(result.timestamp) || result.timestamp.length === 0) {
    throw new Error('Yahoo returned empty or malformed data');
  }

  const quote = result.indicators?.quote?.[0] || {};

  return {
    s: 'ok',
    t: result.timestamp,
    o: quote.open || [],
    h: quote.high || [],
    l: quote.low || [],
    c: quote.close || [],
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

  const resp = await fetch(url, { 
    signal: AbortSignal.timeout(4000) 
  });
  
  if (!resp.ok) throw new Error(`Finnhub HTTP ${resp.status}`);

  const data = await resp.json();
  
  // Finnhub returns { s: 'ok', t: [...], c: [...] } or { s: 'no_data' }
  if (data.s !== 'ok' || !Array.isArray(data.t) || data.t.length === 0) {
    throw new Error('Finnhub returned no_data');
  }

  return {
    s: 'ok',
    t: data.t,
    o: data.o || [],
    h: data.h || [],
    l: data.l || [],
    c: data.c || [],
    v: data.v || [],
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  
  const rawSymbol = url.searchParams.get('symbol') || '';
  const res = url.searchParams.get('resolution') || '5';
  const from = parseInt(url.searchParams.get('from') || '0', 10);
  const to = parseInt(url.searchParams.get('to') || '0', 10);

  const symbol = sanitizeSymbol(rawSymbol);

  // Validation Guard
  if (!symbol || !from || !to || from >= to) {
    return new Response(JSON.stringify({ s: 'error', error: 'Invalid or missing parameters' }), {
      status: 400, 
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*' 
      },
    });
  }

  // 2. CLOUDFLARE EDGE CACHING (Massive perf + cost saver)
  const cacheKey = new Request(`https://stockcandle.cache/${symbol}-${res}-${from}-${to}`, { 
    method: 'GET',
    headers: context.request.headers 
  });
  const cache = caches.default;
  
  try {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  } catch (cacheErr) {
    console.warn('[StockCandle] Cache match failed:', cacheErr.message);
  }

  const jsonResponse = (data, status = 200) => {
    const res = new Response(JSON.stringify(data), {
      status,
      headers: { 
        'Content-Type': 'application/json', 
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
        'Access-Control-Allow-Origin': '*'
      },
    });
    
    // Only cache successful responses
    if (status === 200 && data.s === 'ok') {
      context.waitUntil(cache.put(cacheKey, res.clone()));
    }
    return res;
  };

  // ── Primary: Yahoo Finance ──
  try {
    const data = await fetchYahoo(symbol, res);
    return jsonResponse(data);
  } catch (yahooErr) {
    console.warn(`[StockCandle] Yahoo failed for ${symbol} (${res}):`, yahooErr.message);
    
    // ── Fallback: Finnhub ──
    const apiKey = context.env?.FINNHUB_API_KEY;
    if (!apiKey) {
      console.error('[StockCandle] Finnhub API key missing in env');
      return jsonResponse({ s: 'no_data', error: 'Provider unavailable' });
    }

    try {
      const data = await fetchFinnhub(symbol, res, from, to, apiKey);
      console.log(`[StockCandle] Finnhub fallback successful for ${symbol}`);
      return jsonResponse(data);
    } catch (finnhubErr) {
      console.error(`[StockCandle] Finnhub also failed for ${symbol}:`, finnhubErr.message);
      // 3. GRACEFUL DEGRADATION: Return clean 'no_data' so frontend synthetic chart can trigger
      return jsonResponse({ s: 'no_data', error: 'Data unavailable from all providers' });
    }
  }
}
