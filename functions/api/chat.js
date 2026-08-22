import { SYSTEM_PROMPT } from './systemPrompt.js';

// ── Constants ──────────────────────────────────────────────
const MAX_RESULTS       = 5;
const MAX_PAGE_TEXT_LEN = 2500;
const MAX_TITLE_LEN     = 120;
const MAX_URL_LEN       = 300;
const MAX_SNIPPET_LEN   = 900;
const PAGE_TIMEOUT_MS   = 4000;
const MAX_TOKENS_INTENT = 10;
const MAX_TOKENS_ANSWER = 350;
const HISTORY_LIMIT     = 100;
const THIN_SNIPPET_THRESHOLD = 300;

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','this','that',
  'these','those','it','its','i','you','he','she','we','they','what','which',
  'who','how','when','where','why','not','no','so','if','as','by','from',
  'about','up','out','into','than','then','just','also','more','other',
  'some','any','all','each','both','few','most','only','own','same','such',
]);

const INTENT_SYSTEM = `You decide if a web search is needed to answer the user query.
Reply with ONLY [SEARCH] or [NO_SEARCH]. Nothing else.

Return [SEARCH] for:
- current / latest / today's / recent information
- news, events, announcements
- current prices: stocks, crypto, gold, silver, oil, commodities
- market cap, valuation, funding
- exchange rates, forex
- weather conditions or forecasts
- current software/app/product versions
- product pricing or availability
- current officials, leaders, or executives
- current laws, regulations, policies
- sports scores, results, standings, rankings
- anything that materially changes over time

Return [NO_SEARCH] for:
- math, logic, calculations
- translation or rewriting
- summarization of user-provided content
- creative writing or brainstorming
- stable general knowledge or history
- explanations of concepts, science, definitions`;

const ANSWER_INSTRUCTION = `

OUTPUT RULES (hard limit: 150 tokens):
- Complete your answer naturally before reaching the limit.
- Answer the user's actual question first, directly.
- Simple questions: 1–3 sentences max.
- Complex/factual questions: essential verified facts only, no padding.
- If search results are available, use the most important verified data.
- If current data is unavailable, say so clearly — never fabricate prices, versions, or live stats.
- Never start a sentence or list you cannot finish within the remaining budget.
- Never fill tokens just because the limit is 150.`;

// ── Stock Detection ─────────────────────────────────────────
// Common ticker → company name map (extend as needed)
const TICKER_MAP = {
  AAPL:'Apple Inc.', MSFT:'Microsoft Corp.', GOOGL:'Alphabet Inc.', GOOG:'Alphabet Inc.',
  AMZN:'Amazon.com Inc.', META:'Meta Platforms', TSLA:'Tesla Inc.', NVDA:'NVIDIA Corp.',
  NFLX:'Netflix Inc.', AMD:'Advanced Micro Devices', INTC:'Intel Corp.', ORCL:'Oracle Corp.',
  IBM:'IBM Corp.', UBER:'Uber Technologies', LYFT:'Lyft Inc.', SNAP:'Snap Inc.',
  TWTR:'Twitter Inc.', SPOT:'Spotify Technology', SHOP:'Shopify Inc.', SQ:'Block Inc.',
  PYPL:'PayPal Holdings', V:'Visa Inc.', MA:'Mastercard Inc.', JPM:'JPMorgan Chase',
  GS:'Goldman Sachs', BAC:'Bank of America', WMT:'Walmart Inc.', COST:'Costco Wholesale',
  DIS:'Walt Disney Co.', NFLX:'Netflix Inc.', BA:'Boeing Co.', GE:'GE Aerospace',
  // Indian stocks (NSE)
  RELIANCE:'Reliance Industries', TCS:'Tata Consultancy', INFY:'Infosys Ltd.',
  WIPRO:'Wipro Ltd.', HDFCBANK:'HDFC Bank', ICICIBANK:'ICICI Bank',
  SBIN:'State Bank of India', TATAMOTORS:'Tata Motors', BAJFINANCE:'Bajaj Finance',
  // Indices
  SPY:'S&P 500 ETF', QQQ:'Nasdaq 100 ETF', DIA:'Dow Jones ETF',
};

// Patterns that suggest a stock query
const STOCK_QUERY_RE = /\b(stock|share\s*price|share price|market\s*cap|ticker|equity|nse|bse|nasdaq|nyse|sensex|nifty)\b/i;

// Company name → ticker (lowercase keys, longer first for matching)
const COMPANY_NAME_MAP = {
  'apple': 'AAPL', 'microsoft': 'MSFT', 'google': 'GOOGL', 'alphabet': 'GOOGL',
  'amazon': 'AMZN', 'meta': 'META', 'facebook': 'META', 'tesla': 'TSLA',
  'nvidia': 'NVDA', 'netflix': 'NFLX', 'amd': 'AMD', 'intel': 'INTC',
  'oracle': 'ORCL', 'ibm': 'IBM', 'uber': 'UBER', 'lyft': 'LYFT',
  'snap': 'SNAP', 'snapchat': 'SNAP', 'spotify': 'SPOT', 'shopify': 'SHOP',
  'paypal': 'PYPL', 'visa': 'V', 'mastercard': 'MA', 'jpmorgan': 'JPM',
  'goldman sachs': 'GS', 'goldman': 'GS', 'bank of america': 'BAC',
  'walmart': 'WMT', 'costco': 'COST', 'disney': 'DIS', 'boeing': 'BA',
  'tata consultancy': 'TCS', 'tata motors': 'TATAMOTORS',
  'bajaj finance': 'BAJFINANCE', 'hdfc bank': 'HDFCBANK', 'hdfc': 'HDFCBANK',
  'icici bank': 'ICICIBANK', 'icici': 'ICICIBANK',
  'state bank': 'SBIN', 'reliance': 'RELIANCE',
  'infosys': 'INFY', 'wipro': 'WIPRO', 'tcs': 'TCS',
};

/**
 * Try to extract a stock ticker from a query.
 * Returns { ticker, name } or null.
 */
function detectStockQuery(query) {
  const q   = query.trim();
  const qLo = q.toLowerCase();

  // Direct index queries
  if (/\b(sensex|bse\s*sensex)\b/i.test(q)) return { ticker: '^BSESN', name: 'BSE SENSEX' };
  if (/\b(nifty\s*50|nifty)\b/i.test(q))    return { ticker: '^NSEI',  name: 'NIFTY 50' };
  if (/\b(dow\s*jones|djia)\b/i.test(q))     return { ticker: '^DJI',   name: 'Dow Jones' };
  if (/\b(s&p\s*500|sp500)\b/i.test(q))      return { ticker: '^GSPC',  name: 'S&P 500' };
  if (/\b(nasdaq\s*composite)\b/i.test(q))   return { ticker: '^IXIC',  name: 'NASDAQ' };

  const hasStockKeyword = STOCK_QUERY_RE.test(q);

  // 1. Company name match (longer names first to avoid partial hits)
  const sortedNames = Object.keys(COMPANY_NAME_MAP).sort((a, b) => b.length - a.length);
  for (const name of sortedNames) {
    if (qLo.includes(name)) {
      const ticker = COMPANY_NAME_MAP[name];
      return { ticker, name: TICKER_MAP[ticker] || ticker };
    }
  }

  // 2. Exact ticker match in uppercase query
  const upperQ = q.toUpperCase();
  for (const [ticker, name] of Object.entries(TICKER_MAP)) {
    const re = new RegExp(`\\b${ticker}\\b`);
    if (re.test(upperQ)) return { ticker, name };
  }

  // 3. Stock keyword + bare uppercase word as ticker
  if (hasStockKeyword) {
    const m = upperQ.match(/\b([A-Z]{2,5})\b/);
    if (m) return { ticker: m[1], name: m[1] };
  }

  return null;
}

// ── Finnhub Fetch ───────────────────────────────────────────
async function fetchStockData(ticker, apiKey) {
  try {
    const [quoteResp, profileResp, candleResp] = await Promise.all([
      // Current quote
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
      // Company profile
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
      // 1D candles: 5-minute resolution, last 24h
      fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=5&from=${Math.floor(Date.now()/1000) - 86400}&to=${Math.floor(Date.now()/1000)}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
    ]);

    const quote   = quoteResp.ok   ? await quoteResp.json().catch(() => null)   : null;
    const profile = profileResp.ok ? await profileResp.json().catch(() => null) : null;
    const candle  = candleResp.ok  ? await candleResp.json().catch(() => null)  : null;

    // quote must have a valid price
    if (!quote || typeof quote.c !== 'number' || quote.c === 0) return null;

    // Build candle series [{t, c}] for chart
    let series = [];
    if (candle && candle.s === 'ok' && Array.isArray(candle.t)) {
      series = candle.t.map((t, i) => ({ t, o: candle.o[i], h: candle.h[i], l: candle.l[i], c: candle.c[i] }));
    }

    return {
      ticker,
      name:     profile?.name     || ticker,
      exchange: profile?.exchange || '',
      logo:     profile?.logo     || '',
      currency: profile?.currency || 'USD',
      // Quote fields
      price:    quote.c,
      open:     quote.o,
      high:     quote.h,
      low:      quote.l,
      prevClose:quote.pc,
      change:   +(quote.c - quote.pc).toFixed(2),
      changePct:+(((quote.c - quote.pc) / quote.pc) * 100).toFixed(2),
      // Chart data
      series,
    };
  } catch {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────
function trunc(str, len) {
  if (!str || typeof str !== 'string') return '';
  return str.length > len ? str.slice(0, len) : str;
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function queryTerms(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function scoreWindow(windowText, terms) {
  const lower = windowText.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score++;
  }
  return score;
}

function extractRelevantPassage(cleanedText, query) {
  const terms = queryTerms(query);
  if (!terms.length) return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);

  const sentences = cleanedText
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  if (!sentences.length) return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);

  const WINDOW_SIZE = 5;
  const STEP = 2;
  let bestScore = -1;
  let bestStart = 0;

  for (let i = 0; i < sentences.length; i += STEP) {
    const window = sentences.slice(i, i + WINDOW_SIZE).join(' ');
    const score = scoreWindow(window, terms);
    if (score > bestScore) { bestScore = score; bestStart = i; }
  }

  if (bestScore === 0) return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);

  let passage = '';
  let idx = Math.max(0, bestStart - 1);
  while (idx < sentences.length && passage.length < MAX_PAGE_TEXT_LEN) {
    const next = (passage ? passage + ' ' : '') + sentences[idx];
    if (next.length > MAX_PAGE_TEXT_LEN) break;
    passage = next;
    idx++;
  }

  return passage || cleanedText.slice(0, MAX_PAGE_TEXT_LEN);
}

async function fetchPageText(url, query) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!resp.ok) return '';
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return '';

    const html = await resp.text();
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return '';
    return extractRelevantPassage(clean, query);
  } catch {
    return '';
  }
}

function buildSearchContext(results) {
  if (!results.length) return '';
  return 'Web search results:\n' +
    results.map((r, i) =>
      `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
    ).join('\n\n');
}

async function groqFetch(apiKey, body) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  return resp;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Main Handler ─────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GROQ_API_KEY) {
    return jsonError('Server misconfiguration', 500);
  }

  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch {
    return jsonError('Invalid request body', 400);
  }

  if (!query?.trim()) {
    return jsonError('Empty query', 400);
  }

  // ── Step 1: Stock detection (runs in parallel with intent) ─
  const stockInfo = detectStockQuery(query);
  const stockDataPromise = (stockInfo && env.FINNHUB_API_KEY)
    ? fetchStockData(stockInfo.ticker, env.FINNHUB_API_KEY)
    : Promise.resolve(null);

  // ── Step 2: Intent classification ───────────────────────
  let needsSearch = false;
  try {
    const intentResp = await groqFetch(env.GROQ_API_KEY, {
      model: 'qwen/qwen3.6-27b',
      messages: [
        { role: 'system', content: INTENT_SYSTEM },
        { role: 'user', content: query },
      ],
      stream: false,
      max_tokens: MAX_TOKENS_INTENT,
      temperature: 0,
      reasoning_effort: 'none',
    });

    if (intentResp.ok) {
      const intentData = await intentResp.json().catch(() => null);
      const decision = intentData?.choices?.[0]?.message?.content?.trim();
      needsSearch = decision === '[SEARCH]';
    }
  } catch {
    // classifier failed → skip search conservatively
  }

  // ── Step 3: SearXNG (if needed) ─────────────────────────
  let searchResults = [];
  let searchContext = '';

  if (needsSearch) {
    if (!env.SEARXNG_URL) {
      // No SearXNG configured — skip gracefully
    } else {
      try {
        const searxResp = await fetch(
          `${env.SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`,
          {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(6000),
          }
        );

        if (searxResp.ok) {
          const data = await searxResp.json().catch(() => null);
          const raw = Array.isArray(data?.results) ? data.results.slice(0, MAX_RESULTS) : [];

          const seenUrls = new Set();
          const deduped = raw.filter(r => {
            const url = r?.url;
            if (!url || seenUrls.has(url)) return false;
            seenUrls.add(url);
            return true;
          });

          searchResults = await Promise.all(
            deduped.map(async (r, i) => {
              const rawUrl   = trunc(r.url     || '', MAX_URL_LEN);
              const rawTitle = trunc(r.title   || '', MAX_TITLE_LEN);
              let   snippet  = trunc(r.content || '', MAX_SNIPPET_LEN);

              if (snippet.length < THIN_SNIPPET_THRESHOLD && i < 3 && isValidUrl(rawUrl)) {
                const pageText = await fetchPageText(rawUrl, query);
                if (pageText) snippet = trunc(pageText, MAX_PAGE_TEXT_LEN);
              }

              return { title: rawTitle, url: rawUrl, snippet };
            })
          );

          searchContext = buildSearchContext(searchResults);
        }
      } catch {
        // SearXNG failed → continue without search data
      }
    }
  }

  // ── Step 4: Await stock data ─────────────────────────────
  const stockData = await stockDataPromise;

  // ── Step 5: Stream final answer ──────────────────────────
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  const safeWrite = async (chunk) => {
    try { await writer.write(chunk); } catch { /* writer closed */ }
  };

  (async () => {
    try {
      // Emit stock data first (before web results)
      if (stockData) {
        await safeWrite(enc.encode(
          `event: stock\ndata: ${JSON.stringify(stockData)}\n\n`
        ));
      }

      if (searchResults.length > 0) {
        await safeWrite(enc.encode(
          `event: results\ndata: ${JSON.stringify(searchResults)}\n\n`
        ));
      }

      const systemContent = searchContext
        ? `${SYSTEM_PROMPT}${ANSWER_INSTRUCTION}\n\n${searchContext}`
        : `${SYSTEM_PROMPT}${ANSWER_INSTRUCTION}`;

      const groqResp = await groqFetch(env.GROQ_API_KEY, {
        model: 'qwen/qwen3.6-27b',
        messages: [
          { role: 'system', content: systemContent },
          ...(Array.isArray(history) ? history.slice(-HISTORY_LIMIT) : []),
          { role: 'user', content: query },
        ],
        stream: true,
        max_tokens: MAX_TOKENS_ANSWER,
        temperature: 0.3,
        reasoning_effort: 'none',
      });

      if (!groqResp.ok) {
        await safeWrite(enc.encode(
          `data: ${JSON.stringify({ error: 'AI response failed' })}\n\n`
        ));
        await writer.close();
        return;
      }

      const reader = groqResp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await safeWrite(value);
      }

      await writer.close();
    } catch {
      await safeWrite(enc.encode(
        `data: ${JSON.stringify({ error: 'Internal error' })}\n\n`
      ));
      try { await writer.close(); } catch { /* already closed */ }
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
                
