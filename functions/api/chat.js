import { SYSTEM_PROMPT } from './systemPrompt.js';

/* ── Stock symbol detector ── */
const _STOCK_RE = /\b([A-Z]{1,5})\s+stock\b|\bstock\s+(?:of\s+|price\s+(?:of\s+)?)?([A-Z]{1,5})\b|\bprice\s+of\s+([A-Z]{1,5})\b|\b(AAPL|MSFT|GOOGL|GOOG|AMZN|TSLA|META|NVDA|NFLX|AMD|INTC|ORCL|IBM|CSCO|QCOM|ADBE|CRM|PYPL|UBER|LYFT|SNAP|TWTR|SPOT|SQ|SHOP|ZM|DOCU|PLTR|RBLX|COIN|HOOD|SOFI|RIVN|LCID|NIO|BABA|JD|PDD|TCEHY|BIDU|BYND|DKNG|PENN|MGM|LVS|WYNN|MRNA|PFE|JNJ|ABBV|MRK|LLY|BMY|GILD|AMGN|BIIB|REGN|VRTX|ISRG|MDT|ABT|DHR|TMO|UNH|CVS|WBA|HUM|CI|ANTM|CNC|MOH|JPM|BAC|WFC|GS|MS|C|USB|PNC|TFC|COF|AXP|V|MA|BRK\.B|BRK\.A|XOM|CVX|COP|SLB|HAL|BKR|MPC|VLO|PSX|NEE|DUK|SO|D|AEP|EXC|SRE|PEG|ED|WM|RSG|COST|WMT|TGT|HD|LOW|BBY|AMZN|DG|DLTR|KR|SYY|MCD|SBUX|YUM|CMG|DPZ|QSR|BA|LMT|RTX|NOC|GD|L3H|HII|TDG|SPR|HEI|CAT|DE|HON|MMM|GE|EMR|ITW|PH|ROK|DOV|XYL|AMT|CCI|PLD|SPG|EQR|AVB|MAA|UDR|CPT|ESS|AIV|NLY|AGNC|TWO|IVR|MFA)\b/i;

function _detectStock(query) {
  const upper = query.toUpperCase();

  // Direct ticker patterns: "AAPL", "AAPL stock", "stock price of AAPL"
  const m = upper.match(
    /\b(AAPL|MSFT|GOOGL|GOOG|AMZN|TSLA|META|NVDA|NFLX|AMD|INTC|ORCL|IBM|CSCO|QCOM|ADBE|CRM|PYPL|UBER|LYFT|SNAP|SPOT|SQ|SHOP|ZM|DOCU|PLTR|RBLX|COIN|HOOD|SOFI|RIVN|LCID|NIO|BABA|JD|PDD|MRNA|PFE|JNJ|ABBV|MRK|LLY|BMY|GILD|AMGN|BIIB|REGN|VRTX|ISRG|MDT|ABT|DHR|TMO|UNH|CVS|HUM|JPM|BAC|WFC|GS|MS|USB|PNC|COF|AXP|V|MA|XOM|CVX|COP|SLB|HAL|NEE|DUK|WMT|TGT|HD|LOW|COST|MCD|SBUX|YUM|CMG|BA|LMT|RTX|NOC|GD|CAT|DE|HON|MMM|GE|EMT|AMT|CCI|PLD|SPG)\b/
  );
  if (m) return m[1];

  // "X stock" or "stock of X" patterns
  const stockOf = upper.match(/\b([A-Z]{1,5})\s+STOCK\b/);
  if (stockOf) return stockOf[1];

  const ofStock = upper.match(/STOCK\s+(?:OF\s+|PRICE\s+(?:OF\s+)?)?([A-Z]{1,5})\b/);
  if (ofStock) return ofStock[1];

  return null;
}

/* ── Finnhub fetch ── */
async function _fetchStockData(symbol, apiKey) {
  const base = 'https://finnhub.io/api/v1';
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

  // Step 1: Stock detect karo
  const stockSymbol = _detectStock(query);

  // Step 2: Web search intent check (Qwen)
  const intentResp = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
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
  });

  let searchResults = [];
  let searchContext = '';

  if (intentResp.ok) {
    const intentData = await intentResp.json();
    const decision = intentData.choices?.[0]?.message?.content?.trim();

    if (decision === '[SEARCH]') {
      try {
        const searloResp = await fetch(
          `https://api.searlo.tech/api/v1/search/web?q=${encodeURIComponent(query)}&limit=6`,
          {
            method: 'GET',
            headers: { 'x-api-key': env.SEARLO_API_KEY },
          }
        );
        if (searloResp.ok) {
          const data = await searloResp.json();
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

  // Step 3: Stream response
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      // Emit web results
      if (searchResults.length > 0) {
        await writer.write(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }

      // Emit stock card
      if (stockSymbol && env.FINNHUB_API_KEY) {
        try {
          const stockData = await _fetchStockData(stockSymbol, env.FINNHUB_API_KEY);
          if (stockData) {
            await writer.write(enc.encode(`event: stock\ndata: ${JSON.stringify(stockData)}\n\n`));
          }
        } catch (_) {}
      }

      // Qwen final answer
      const qwenResp = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
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
