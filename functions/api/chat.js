import { SYSTEM_PROMPT } from './systemPrompt.js';

// ── Constants ──────────────────────────────────────────────
const MAX_RESULTS            = 5;
const MAX_PAGE_TEXT_LEN      = 2500;
const MAX_TITLE_LEN          = 120;
const MAX_URL_LEN            = 300;
const MAX_SNIPPET_LEN        = 900;
const PAGE_TIMEOUT_MS        = 4000;
const MAX_TOKENS_INTENT      = 20;
const MAX_TOKENS_ANSWER      = 350;
const HISTORY_LIMIT          = 100;
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

// Single classifier: intent + stock detection in one AI call.
// Returns exactly one token: [SEARCH]  [NO_SEARCH]  [STOCK:TICKER]
const INTENT_SYSTEM = `Classify the user query into exactly one token. Reply with ONLY the token, nothing else.

[STOCK:TICKER] — user wants price, chart, or market data of a stock/index. Set TICKER to the correct symbol (e.g. AAPL, TSLA, RELIANCE.NS, TCS.NS, ^NSEI, ^BSESN, ^GSPC, ^DJI, ^IXIC).

[SEARCH] — needs live web data: news, weather, sports scores, exchange rates, current events, current valuations/funding, recent product launches, anything time-sensitive.
Also return [SEARCH] for queries in any language (Hindi, Hinglish, Urdu, etc.) that ask to search, look up, or find information.

[NO_SEARCH] — math, definitions, stable facts, creative writing, translation, coding help.`;

const ANSWER_INSTRUCTION = `\n\nAnswer in 1–3 plain sentences. Use exact numbers from LIVE STOCK DATA if present. Never fabricate prices or valuations.\n\nFORMATTING (follow silently, never mention to user):\n- Plain text only. No asterisks, no bold, no italic, no markdown of any kind.\n- Never write *word* or **word** or ***word***. Never mix bold and italic.\n- No stray or unmatched asterisks. No bullet points. No headers.`;

// ── Parse classifier response ────────────────────────────────
function parseIntent(raw) {
  const t = (raw || '').trim();
  const m = t.match(/^\[STOCK:([^\]]+)\]$/);
  if (m) return { type: 'stock', ticker: m[1].trim() };
  if (t === '[SEARCH]') return { type: 'search' };
  return { type: 'none' };
}

// ── Finnhub Fetch ───────────────────────────────────────────
async function fetchStockData(ticker, apiKey) {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 5 * 86400; // 5-day window covers weekends + holidays

    const [quoteResp, profileResp, candleResp] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
      fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=5&from=${from}&to=${now}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
    ]);

    const quote   = quoteResp.ok   ? await quoteResp.json().catch(() => null)   : null;
    const profile = profileResp.ok ? await profileResp.json().catch(() => null) : null;
    const candle  = candleResp.ok  ? await candleResp.json().catch(() => null)  : null;

    // Need a valid price (use prevClose as fallback for after-hours/weekend)
    const price = quote?.c || quote?.pc;
    if (!quote || !price) return null;

    // Build series — filter to most recent trading day only
    let series = [];
    if (candle && candle.s === 'ok' && Array.isArray(candle.t) && candle.t.length > 0) {
      const allCandles = candle.t.map((t, i) => ({
        t, o: candle.o[i], h: candle.h[i], l: candle.l[i], c: candle.c[i],
      }));
      const lastTs   = allCandles[allCandles.length - 1].t;
      const lastDate = new Date(lastTs * 1000);
      const lastDay  = `${lastDate.getUTCFullYear()}-${lastDate.getUTCMonth()}-${lastDate.getUTCDate()}`;
      series = allCandles.filter(({ t }) => {
        const d = new Date(t * 1000);
        return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` === lastDay;
      });
      if (series.length === 0) series = allCandles;
    }

    const prevClose = quote.pc || 0;
    const change    = +(price - prevClose).toFixed(2);
    const changePct = prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0;

    return {
      ticker,
      name:      profile?.name     || ticker,
      exchange:  profile?.exchange || '',
      logo:      profile?.logo     || '',
      currency:  profile?.currency || 'USD',
      price,
      open:      quote.o  || null,
      high:      quote.h  || null,
      low:       quote.l  || null,
      prevClose,
      change,
      changePct,
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
    const score  = scoreWindow(window, terms);
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

async function mistralFetch(apiKey, body) {
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
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

  if (!env.MISTRAL_API_KEY) {
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

  // ── Step 1: Classify intent via Groq Qwen 27B ────────────
  let intent = { type: 'none' };
  let stockDataPromise = Promise.resolve(null);
  if (env.GROQ_API_KEY) {
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
        reasoning_format: 'hidden',
      });
      if (intentResp.ok) {
        const d = await intentResp.json().catch(() => null);
        intent = parseIntent(d?.choices?.[0]?.message?.content);
      }
    } catch { /* classifier failed → intent stays none */ }
  }

  if (intent.type === 'stock' && env.FINNHUB_API_KEY) {
    stockDataPromise = fetchStockData(intent.ticker, env.FINNHUB_API_KEY);
  }

  // ── Step 2: SearXNG (only for [SEARCH]) ──────────────────
  let searchResults = [];
  let searchContext = '';

  if (intent.type === 'search' && env.SEARXNG_URL) {
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
        const raw  = Array.isArray(data?.results) ? data.results.slice(0, MAX_RESULTS) : [];

        const seenUrls = new Set();
        const deduped  = raw.filter(r => {
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
    } catch { /* SearXNG failed → continue without */ }
  }

  // ── Step 3: Await stock data ──────────────────────────────
  const stockData = await stockDataPromise;

  // ── Step 4: Stream final answer ───────────────────────────
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  const safeWrite = async (chunk) => {
    try { await writer.write(chunk); } catch { /* writer closed */ }
  };

  (async () => {
    try {
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

      // Build stock context so AI uses real numbers, not training data
      let stockContext = '';
      if (stockData) {
        const sd   = stockData;
        const sign = sd.change >= 0 ? '+' : '';
        const sym  = sd.currency === 'USD' ? '$' : '';
        stockContext =
          `\n\nLIVE STOCK DATA (use these exact numbers):\n` +
          `${sd.name} (${sd.ticker}): ${sym}${sd.price.toFixed(2)} ` +
          `(${sign}${sd.change.toFixed(2)}, ${sign}${sd.changePct.toFixed(2)}%)\n` +
          `Open: ${sd.open?.toFixed(2) ?? '—'} | High: ${sd.high?.toFixed(2) ?? '—'} | ` +
          `Low: ${sd.low?.toFixed(2) ?? '—'} | Prev Close: ${sd.prevClose?.toFixed(2) ?? '—'}`;
      }

      const systemContent = [SYSTEM_PROMPT, ANSWER_INSTRUCTION, stockContext, searchContext]
        .filter(Boolean).join('\n\n');

      const answerResp = await mistralFetch(env.MISTRAL_API_KEY, {
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: systemContent },
          ...(Array.isArray(history) ? history.slice(-HISTORY_LIMIT) : []),
          { role: 'user', content: query },
        ],
        stream: true,
        max_tokens: MAX_TOKENS_ANSWER,
        temperature: 0.3,
      });

      if (!answerResp.ok) {
        await safeWrite(enc.encode(
          `data: ${JSON.stringify({ error: 'AI response failed' })}\n\n`
        ));
        await writer.close();
        return;
      }

      const reader = answerResp.body.getReader();
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
  
