import { SYSTEM_PROMPT } from './systemPrompt.js';

/* ── Stock symbol extractor via Qwen ── */
async function _detectStock(query, apiKey) {
  const resp = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'qwen3.7-flash',
      messages: [
        {
          role: 'system',
          content: 'The user may be asking about a stock by ticker symbol or company name. A lone ticker like "AAPL" or "TSLA" counts as a stock query. A company name like "Apple stock" or "Tesla price" also counts. Extract and return ONLY the uppercase ticker symbol (e.g. AAPL, TSLA, MSFT, GOOGL). If no stock is involved, reply with exactly: NONE. Reply with the ticker or NONE — nothing else, no punctuation.',
        },
        { role: 'user', content: query },
      ],
      stream: false,
      max_tokens: 10,
      temperature: 0,
      enable_thinking: false,
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const raw  = data.choices?.[0]?.message?.content?.trim().toUpperCase();
  // Accept only pure alpha tickers 1-5 chars
  return (raw && raw !== 'NONE' && /^[A-Z]{1,5}$/.test(raw)) ? raw : null;
}

/* ── Finnhub fetch ── */
async function _fetchStockData(symbol, apiKey) {
  const base    = 'https://finnhub.io/api/v1';
  const headers = { 'X-Finnhub-Token': apiKey };

  const [quoteRes, profileRes, metricsRes, newsRes] = await Promise.allSettled([
    fetch(`${base}/quote?symbol=${symbol}`, { headers }),
    fetch(`${base}/stock/profile2?symbol=${symbol}`, { headers }),
    fetch(`${base}/stock/metric?symbol=${symbol}&metric=all`, { headers }),
    fetch(`${base}/company-news?symbol=${symbol}&from=${_daysAgo(7)}&to=${_today()}`, { headers }),
  ]);

  const quote   = quoteRes.status   === 'fulfilled' && quoteRes.value.ok   ? await quoteRes.value.json()   : null;
  const profile = profileRes.status === 'fulfilled' && profileRes.value.ok ? await profileRes.value.json() : null;
  const metrics = metricsRes.status === 'fulfilled' && metricsRes.value.ok ? await metricsRes.value.json() : null;
  const news    = newsRes.status    === 'fulfilled' && newsRes.value.ok    ? await newsRes.value.json()    : [];

  if (!quote || quote.c === 0) return null;

  return {
    symbol,
    name:        profile?.name        || symbol,
    exchange:    profile?.exchange    || '',
    logo:        profile?.logo        || '',
    currency:    profile?.currency    || 'USD',
    price:       quote.c,
    open:        quote.o,
    high:        quote.h,
    low:         quote.l,
    prevClose:   quote.pc,
    change:      quote.d,
    changePct:   quote.dp,
    marketCap:   profile?.marketCapitalization || null,
    pe:          metrics?.metric?.peNormalizedAnnual || null,
    week52High:  metrics?.metric?.['52WeekHigh'] || null,
    week52Low:   metrics?.metric?.['52WeekLow']  || null,
    news:        Array.isArray(news) ? news.slice(0, 3).map(n => ({
      headline: n.headline,
      url:      n.url,
      source:   n.source,
      datetime: n.datetime,
    })) : [],
  };
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}
function _daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/* ══════════════════════════════════════════
   MAIN HANDLER
   ══════════════════════════════════════════ */
export async function onRequestPost(context) {
  const { request, env } = context;

  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: 'Empty query' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 1: Intent check + stock detection — parallel
  const [intentResp, stockSymbol] = await Promise.all([
    fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen3.7-flash',
        messages: [
          { role: 'system', content: 'You decide if a web search is needed to answer the user query. Reply with only [SEARCH] or [NO_SEARCH]. Nothing else.' },
          { role: 'user', content: query },
        ],
        stream: false,
        max_tokens: 10,
        temperature: 0,
        enable_thinking: false,
      }),
    }),
    _detectStock(query, env.QWEN_API_KEY),
  ]);

  let searchResults = [];
  let searchContext = '';

  if (intentResp.ok) {
    const intentData = await intentResp.json();
    const decision   = intentData.choices?.[0]?.message?.content?.trim();

    if (decision === '[SEARCH]') {
      try {
        const searloResp = await fetch(
          `https://api.searlo.tech/api/v1/search/web?q=${encodeURIComponent(query)}&limit=6`,
          { method: 'GET', headers: { 'x-api-key': env.SEARLO_API_KEY } }
        );
        if (searloResp.ok) {
          const data  = await searloResp.json();
          const pages = data.items || [];
          searchResults = pages.slice(0, 6).map(r => ({
            title:   r.title   || '',
            url:     r.link    || '',
            snippet: r.snippet || '',
          }));
          if (searchResults.length > 0) {
            searchContext = 'Web search results:\n' +
              searchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join('\n\n');
          }
        }
      } catch (_) {}
    }
  }

  // Step 2: Kick off stock fetch + Qwen answer stream in parallel
  const stockDataPromise = (stockSymbol && env.FINNHUB_API_KEY)
    ? _fetchStockData(stockSymbol, env.FINNHUB_API_KEY).catch(() => null)
    : Promise.resolve(null);

  const qwenRespPromise = fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen3.7-flash',
      messages: [
        { role: 'system', content: searchContext ? `${SYSTEM_PROMPT}\n\n${searchContext}` : SYSTEM_PROMPT },
        ...(Array.isArray(history) ? history.slice(-100) : []),
        { role: 'user', content: query },
      ],
      stream: true,
      max_tokens: 2048,
      temperature: 0.6,
      enable_thinking: false,
    }),
  });

  // Wait for both before streaming so stock card always arrives first
  const [stockData, qwenResp] = await Promise.all([stockDataPromise, qwenRespPromise]);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      // Emit web results first
      if (searchResults.length > 0) {
        await writer.write(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }

      // Emit stock card before text — guaranteed order
      if (stockData) {
        await writer.write(enc.encode(`event: stock\ndata: ${JSON.stringify(stockData)}\n\n`));
      }

      // Stream Qwen answer
      if (!qwenResp.ok) {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: await qwenResp.text() })}\n\n`));
        await writer.close();
        return;
      }

      const reader = qwenResp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }

      await writer.close();
    } catch (err) {
      try {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
        await writer.close();
      } catch (_) {}
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
