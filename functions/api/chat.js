import { SYSTEM_PROMPT } from './systemPrompt.js';

// ── Constants ──────────────────────────────────────────────
const MAX_RESULTS            = 5;
const MAX_PAGE_TEXT_LEN      = 2500;
const MAX_TITLE_LEN          = 120;
const MAX_URL_LEN            = 300;
const MAX_SNIPPET_LEN        = 900;
const PAGE_TIMEOUT_MS        = 4000;
const MAX_TOKENS_ANSWER      = 350;
const HISTORY_LIMIT          = 10;
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

// ── Tool Definitions ───────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stock_data',
      description: 'Fetch real-time trading data (price, change, open, high, low, prev close, intraday chart) for a publicly traded stock or market index. Use when the user's intended request is current market/trading information and the target security can be identified with high confidence. Understand natural, abbreviated, multilingual, and conversational phrasing — do not require the words "price" or "stock" to appear. Do NOT use for: market cap, earnings, revenue, P/E, dividends, news, crypto, forex, commodities. Never guess a ticker.',
      parameters: {
        type: 'object',
        properties: {
          ticker: {
            type: 'string',
            description: 'Primary exchange ticker in uppercase, no exchange suffix. Examples: AAPL, TSLA, MSFT, GOOGL, NVDA, RELIANCE, TCS, ^NSEI, ^BSESN, SPY, ^DJI. Never fabricate.',
          },
        },
        required: ['ticker'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the live web when answering requires current, recent, changing, or externally verifiable information. Use whenever the answer cannot be reliably obtained from conversation context or get_stock_data. Generate a concise query preserving the user's intent, entities, location, and timeframe. Do not use for stable knowledge, mathematics, coding, rewriting, translation, or ordinary conversation.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Concise search query that preserves the user's actual intent.',
          },
        },
        required: ['query'],
      },
    },
  },
];

const ANSWER_INSTRUCTION = `Answer in 1–3 plain sentences. Use exact numbers from tool results when present. Never fabricate prices, data, or facts.

FORMATTING (follow silently, never mention to user):
- Plain text only. No asterisks, no bold, no italic, no markdown of any kind.
- No bullet points. No headers. No stray symbols.`;

// ── Helpers ────────────────────────────────────────────────
function trunc(str, len) {
  if (!str || typeof str !== 'string') return '';
  return str.length > len ? str.slice(0, len) : str;
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
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
  for (const term of terms) { if (lower.includes(term)) score++; }
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
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return '';

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
  } catch { return ''; }
}

function buildSearchContext(results) {
  if (!results.length) return '';
  return 'Web search results:\n' +
    results.map((r, i) =>
      `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
    ).join('\n\n');
}

// ── Finnhub Fetch ──────────────────────────────────────────
async function fetchStockData(ticker, apiKey) {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 5 * 86400;

    const [quoteResp, profileResp, candleResp] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
      fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=5&from=${from}&to=${now}&token=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }),
    ]);

    const quote   = quoteResp.ok   ? await quoteResp.json().catch(() => null) : null;
    const profile = profileResp.ok ? await profileResp.json().catch(() => null) : null;
    const candle  = candleResp.ok  ? await candleResp.json().catch(() => null) : null;

    const price = quote?.c || quote?.pc;
    if (!quote || !price) return null;

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
  } catch { return null; }
}

// ── SearXNG Fetch ──────────────────────────────────────────
async function fetchSearchResults(query, searxngUrl) {
  try {
    const resp = await fetch(
      `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) }
    );
    if (!resp.ok) return [];

    const data = await resp.json().catch(() => null);
    const raw  = Array.isArray(data?.results) ? data.results.slice(0, MAX_RESULTS) : [];

    const seenUrls = new Set();
    const deduped  = raw.filter(r => {
      const url = r?.url;
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });

    return await Promise.all(
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
  } catch { return []; }
}

// ── Mistral API ────────────────────────────────────────────
async function mistralFetch(apiKey, body) {
  return fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Main Handler ───────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.MISTRAL_API_KEY) return jsonError('Server misconfiguration', 500);

  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch { return jsonError('Invalid request body', 400); }

  if (!query?.trim()) return jsonError('Empty query', 400);

  const systemContent = `${SYSTEM_PROMPT}\n\n${ANSWER_INSTRUCTION}`;
  const messages = [
    { role: 'system', content: systemContent },
    ...(Array.isArray(history) ? history.slice(-HISTORY_LIMIT) : []),
    { role: 'user', content: query },
  ];

  // ── Step 1: Call 1 — Mistral with tools (non-streaming) ────
  // Model decides: tool call OR direct answer
  let toolCall        = null;
  let directAnswer    = null;  // msg.content when no tool chosen
  let firstAssistMsg  = null;  // full assistant message for conversation continuity

  try {
    const call1Resp = await mistralFetch(env.MISTRAL_API_KEY, {
      model: 'mistral-large-latest',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      stream: false,
      max_tokens: MAX_TOKENS_ANSWER,
      temperature: 0.3,
    });

    if (call1Resp.ok) {
      const d   = await call1Resp.json().catch(() => null);
      const msg = d?.choices?.[0]?.message;
      firstAssistMsg = msg;
      if (msg?.tool_calls?.length) {
        toolCall = msg.tool_calls[0];
      } else if (msg?.content) {
        directAnswer = msg.content;  // No tool needed — use this directly
      }
    }
  } catch { /* call 1 failed → fall through, directAnswer stays null */ }

  // ── Step 2: Execute tool (only if model chose one) ────────
  let stockData         = null;
  let searchResults     = [];
  let toolResultContent = '';

  if (toolCall) {
    const fnName = toolCall.function?.name;
    let fnArgs = {};
    try { fnArgs = JSON.parse(toolCall.function?.arguments || '{}'); } catch { /* ignore */ }

    if (fnName === 'get_stock_data' && fnArgs.ticker && env.FINNHUB_API_KEY) {
      stockData = await fetchStockData(fnArgs.ticker, env.FINNHUB_API_KEY);
      if (stockData) {
        const sd   = stockData;
        const sign = sd.change >= 0 ? '+' : '';
        const sym  = sd.currency === 'USD' ? '$' : '';
        toolResultContent =
          `LIVE STOCK DATA:\n` +
          `${sd.name} (${sd.ticker}): ${sym}${sd.price.toFixed(2)} ` +
          `(${sign}${sd.change.toFixed(2)}, ${sign}${sd.changePct.toFixed(2)}%)\n` +
          `Open: ${sd.open?.toFixed(2) ?? '—'} | High: ${sd.high?.toFixed(2) ?? '—'} | ` +
          `Low: ${sd.low?.toFixed(2) ?? '—'} | Prev Close: ${sd.prevClose?.toFixed(2) ?? '—'}`;
      } else {
        // Finnhub failed — pre-execute web_search fallback so Call 2 gets real data
        // This keeps failure case at 2 model calls total (not 3)
        if (env.SEARXNG_URL) {
          const fallbackQuery = `${fnArgs.ticker} stock price today`;
          searchResults = await fetchSearchResults(fallbackQuery, env.SEARXNG_URL);
          const searchCtx = buildSearchContext(searchResults);
          toolResultContent =
            `ERROR: Real-time data unavailable for "${fnArgs.ticker}" (unsupported exchange or API error).\n\n` +
            (searchCtx || 'No web fallback data found either.');
        } else {
          toolResultContent = `ERROR: Real-time data unavailable for "${fnArgs.ticker}".`;
        }
      }

    } else if (fnName === 'web_search' && fnArgs.query && env.SEARXNG_URL) {
      searchResults = await fetchSearchResults(fnArgs.query, env.SEARXNG_URL);
      toolResultContent = buildSearchContext(searchResults) || 'No search results found.';
    }
  }

  // ── Step 3: Stream answer ─────────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  const safeWrite = async (chunk) => {
    try { await writer.write(chunk); } catch { /* writer closed */ }
  };

  (async () => {
    try {
      // Send SSE events for UI
      if (stockData) {
        await safeWrite(enc.encode(`event: stock\ndata: ${JSON.stringify(stockData)}\n\n`));
      }
      if (searchResults.length > 0) {
        await safeWrite(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }

      // ── No tool chosen: stream directAnswer from Call 1 ──
      if (!toolCall && directAnswer) {
        const text = enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: directAnswer } }] })}\n\n`);
        await safeWrite(text);
        await safeWrite(enc.encode('data: [DONE]\n\n'));
        await writer.close();
        return;
      }

      // ── Tool was called: Call 2 — final answer (streaming) ─
      const finalMessages = [
        ...messages,
        { role: 'assistant', content: firstAssistMsg?.content ?? null, tool_calls: [toolCall] },
        { role: 'tool', tool_call_id: toolCall.id, content: toolResultContent },
      ];

      const answerResp = await mistralFetch(env.MISTRAL_API_KEY, {
        model: 'mistral-large-latest',
        messages: finalMessages,
        stream: true,
        max_tokens: MAX_TOKENS_ANSWER,
        temperature: 0.3,
      });

      if (!answerResp.ok) {
        await safeWrite(enc.encode(`data: ${JSON.stringify({ error: 'AI response failed' })}\n\n`));
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
      await safeWrite(enc.encode(`data: ${JSON.stringify({ error: 'Internal error' })}\n\n`));
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
          
