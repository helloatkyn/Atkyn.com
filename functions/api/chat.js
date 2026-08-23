import { SYSTEM_PROMPT } from './systemPrompt.js';

// ── Constants ──────────────────────────────────────────────
const MAX_RESULTS            = 5;
const MAX_PAGE_TEXT_LEN      = 2500;
const MAX_TITLE_LEN          = 120;
const MAX_URL_LEN            = 300;
const MAX_SNIPPET_LEN        = 900;
const PAGE_TIMEOUT_MS        = 4000;
const MAX_TOKENS_TOOL_SELECT = 150;
const MAX_TOKENS_ANSWER      = 350;
const HISTORY_LIMIT          = 10;
const THIN_SNIPPET_THRESHOLD = 300;

const INJECTION_SENTINEL_RE = /ignore (previous|above|all) instructions?|forget (your|the) (system|instructions?)|you are now|new instructions?:/i;

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','this','that',
  'these','those','it','its','i','you','he','she','we','they','what','which',
  'who','how','when','where','why','not','no','so','if','as','by','from',
  'about','up','out','into','than','then','just','also','more','other',
  'some','any','all','each','both','few','most','only','own','same','such',
]);

// ── Tool definitions ───────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stock_data',
      description:
        'Retrieves real-time stock trading data — price, change, open, high, low, prev close, ' +
        'intraday chart — for a specific publicly traded security or market index. ' +
        'Call ONLY when the user explicitly wants live trading/price data and the ticker is unambiguous. ' +
        'Do NOT call for: fundamentals, valuation, market cap, earnings, revenue, P/E, dividends, ' +
        'financial statements, analyst targets, news, crypto, forex, commodities, bonds, or macroeconomics. ' +
        'Do NOT call if intent is ambiguous or broader research is needed — prefer web_search instead.',
      parameters: {
        type: 'object',
        properties: { ticker: { type: 'string' } },
        required: ['ticker'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Retrieves live or externally verifiable information — current news, recent events, ' +
        'financial research (earnings, market cap, fundamentals, analyst reports), or anything ' +
        'requiring up-to-date sources. ' +
        'Do NOT call for live stock price/trading data (use get_stock_data), stable general knowledge, ' +
        'self-contained logic, math, coding, or writing tasks.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Concise query preserving intent, entity, location, timeframe. Min 2 chars.',
          },
        },
        required: ['query'],
      },
    },
  },
];

// ── Helpers ────────────────────────────────────────────────
function trunc(str, len) {
  if (!str || typeof str !== 'string') return '';
  return str.length > len ? str.slice(0, len) : str;
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

function isValidTicker(ticker) {
  if (!ticker || typeof ticker !== 'string') return false;
  return /^\^?[A-Z0-9]{1,11}(\.[A-Z]{1,4})?$/.test(ticker.trim());
}

function sanitiseToolOutput(text) {
  return INJECTION_SENTINEL_RE.test(text)
    ? '[SANITISED: tool result contained instruction-like content and was removed]'
    : text;
}

function queryTerms(query) {
  return query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function extractRelevantPassage(cleanedText, query) {
  const terms = queryTerms(query);
  if (!terms.length) return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);

  const sentences = cleanedText.split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim()).filter(s => s.length > 20);
  if (!sentences.length) return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);

  const WINDOW = 5, STEP = 2;
  let bestScore = -1, bestStart = 0;
  for (let i = 0; i < sentences.length; i += STEP) {
    const w = sentences.slice(i, i + WINDOW).join(' ').toLowerCase();
    const score = terms.reduce((n, t) => n + (w.includes(t) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestStart = i; }
  }
  if (bestScore === 0) return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);

  let passage = '', idx = Math.max(0, bestStart - 1);
  while (idx < sentences.length && passage.length < MAX_PAGE_TEXT_LEN) {
    const next = (passage ? passage + ' ' : '') + sentences[idx];
    if (next.length > MAX_PAGE_TEXT_LEN) break;
    passage = next; idx++;
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
    const clean = (await resp.text())
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return clean ? extractRelevantPassage(clean, query) : '';
  } catch { return ''; }
}

function buildSearchContext(results) {
  if (!results.length) return '';
  return 'Web search results:\n' +
    results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n\n');
}

// ── History validation ─────────────────────────────────────
const VALID_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

function sanitiseHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m => m && typeof m === 'object' && typeof m.role === 'string' &&
      VALID_ROLES.has(m.role) &&
      (typeof m.content === 'string' || m.content === null || m.content === undefined))
    .map(m => {
      const c = { role: m.role, content: m.content ?? '' };
      if (m.tool_call_id)            c.tool_call_id = String(m.tool_call_id);
      if (Array.isArray(m.tool_calls)) c.tool_calls = m.tool_calls;
      return c;
    });
}

// ── Finnhub fetch ──────────────────────────────────────────
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

    const quote   = quoteResp.ok   ? await quoteResp.json().catch(() => null)   : null;
    const profile = profileResp.ok ? await profileResp.json().catch(() => null) : null;
    const candle  = candleResp.ok  ? await candleResp.json().catch(() => null)  : null;

    const price = quote?.c > 0 ? quote.c : (quote?.pc > 0 ? quote.pc : null);
    if (!quote || !price) return null;

    let series = [];
    if (candle?.s === 'ok' && Array.isArray(candle.t) && candle.t.length > 0) {
      const all     = candle.t.map((t, i) => ({ t, o: candle.o[i], h: candle.h[i], l: candle.l[i], c: candle.c[i] }));
      const lastD   = new Date(all[all.length - 1].t * 1000);
      const lastDay = `${lastD.getUTCFullYear()}-${lastD.getUTCMonth()}-${lastD.getUTCDate()}`;
      series = all.filter(({ t }) => {
        const d = new Date(t * 1000);
        return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` === lastDay;
      });
      if (!series.length) series = all;
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
      price, open: quote.o || null, high: quote.h || null,
      low: quote.l || null, prevClose, change, changePct, series,
    };
  } catch { return null; }
}

// ── SearXNG fetch ──────────────────────────────────────────
async function fetchSearchResults(query, searxngUrl) {
  try {
    const resp = await fetch(
      `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) }
    );
    if (!resp.ok) return [];

    const data   = await resp.json().catch(() => null);
    const raw    = Array.isArray(data?.results) ? data.results.slice(0, MAX_RESULTS) : [];
    const seen   = new Set();
    const deduped = raw.filter(r => { if (!r?.url || seen.has(r.url)) return false; seen.add(r.url); return true; });

    return await Promise.all(deduped.map(async (r, i) => {
      const rawUrl   = trunc(r.url     || '', MAX_URL_LEN);
      const rawTitle = trunc(r.title   || '', MAX_TITLE_LEN);
      let   snippet  = trunc(r.content || '', MAX_SNIPPET_LEN);
      if (snippet.length < THIN_SNIPPET_THRESHOLD && i < 3 && isValidUrl(rawUrl)) {
        const pg = await fetchPageText(rawUrl, query);
        if (pg) snippet = trunc(pg, MAX_PAGE_TEXT_LEN);
      }
      return { title: rawTitle, url: rawUrl, snippet };
    }));
  } catch { return []; }
}

// ── API helpers ────────────────────────────────────────────
function mistralFetch(apiKey, body) {
  return fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(stream) {
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

// ── Main handler ───────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.MISTRAL_API_KEY) return jsonError('Server misconfiguration', 500);

  const MODEL_TOOL_SELECT = env.MISTRAL_MODEL_TOOL_SELECT || 'mistral-large-latest';
  const MODEL_ANSWER      = env.MISTRAL_MODEL_ANSWER      || 'mistral-large-latest';

  let query, history;
  try { ({ query, history } = await request.json()); }
  catch { return jsonError('Invalid request body', 400); }
  if (!query?.trim()) return jsonError('Empty query', 400);

  const systemContent = SYSTEM_PROMPT;

  const messages = [
    { role: 'system', content: systemContent },
    ...sanitiseHistory(history).slice(-HISTORY_LIMIT),
    { role: 'user', content: query.trim() },
  ];

  // ── Call 1: Tool selection ─────────────────────────────────────────────────
  let toolCall = null, directAnswer = null, firstAssistMsg = null;

  try {
    const r1 = await mistralFetch(env.MISTRAL_API_KEY, {
      model: MODEL_TOOL_SELECT, messages, tools: TOOLS,
      tool_choice: 'auto', parallel_tool_calls: false,
      stream: false, max_tokens: MAX_TOKENS_TOOL_SELECT, temperature: 0.2,
    });
    if (!r1.ok) {
      console.error(`[Call1] ${r1.status}: ${await r1.text().catch(() => '')}`);
    } else {
      const msg = (await r1.json().catch(() => null))?.choices?.[0]?.message;
      firstAssistMsg = msg ?? null;
      if (msg?.tool_calls?.length)                               toolCall     = msg.tool_calls[0];
      else if (typeof msg?.content === 'string' && msg.content.trim()) directAnswer = msg.content.trim();
    }
  } catch (e) { console.error('[Call1] threw:', e); }

  if (!toolCall && !directAnswer) return jsonError('AI service unavailable', 503);

  // ── Direct answer — no tool needed ────────────────────────────────────────
  if (!toolCall) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc    = new TextEncoder();
    (async () => {
      try {
        await writer.write(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: directAnswer } }] })}\n\n`));
        await writer.write(enc.encode('data: [DONE]\n\n'));
      } catch { } finally { try { await writer.close(); } catch { } }
    })();
    return sseResponse(readable);
  }

  // ── Tool validation ────────────────────────────────────────────────────────
  const fnName     = toolCall.function?.name;
  const toolCallId = toolCall.id ?? `tool_${Date.now()}`;
  let fnArgs = {}, argParseErr = false;
  try {
    fnArgs = JSON.parse(toolCall.function?.arguments || '{}');
    if (typeof fnArgs !== 'object' || fnArgs === null) { fnArgs = {}; argParseErr = true; }
  } catch { argParseErr = true; }

  // ── Tool execution ─────────────────────────────────────────────────────────
  let stockData = null, searchResults = [], toolResultContent = '';

  if (argParseErr) {
    toolResultContent = 'ERROR: Tool arguments were malformed.';

  } else if (fnName === 'get_stock_data') {
    const ticker = typeof fnArgs.ticker === 'string' ? fnArgs.ticker.trim().toUpperCase() : '';
    if (!ticker)                  toolResultContent = 'ERROR: No ticker provided.';
    else if (!isValidTicker(ticker)) toolResultContent = `ERROR: "${ticker}" is not a valid ticker.`;
    else if (!env.FINNHUB_API_KEY)   toolResultContent = 'ERROR: Stock provider not configured.';
    else {
      stockData = await fetchStockData(ticker, env.FINNHUB_API_KEY);
      if (stockData) {
        const { name, ticker: sym, currency, price, change, changePct, open, high, low, prevClose } = stockData;
        const sign = change >= 0 ? '+' : '';
        const cur  = currency === 'USD' ? '$' : '';
        toolResultContent =
          `LIVE STOCK DATA:\n${name} (${sym}): ${cur}${price.toFixed(2)} ` +
          `(${sign}${change.toFixed(2)}, ${sign}${changePct.toFixed(2)}%)\n` +
          `Open: ${open?.toFixed(2) ?? '—'} | High: ${high?.toFixed(2) ?? '—'} | ` +
          `Low: ${low?.toFixed(2) ?? '—'} | Prev Close: ${prevClose?.toFixed(2) ?? '—'}`;
      } else if (env.SEARXNG_URL) {
        searchResults     = await fetchSearchResults(`${ticker} stock price today`, env.SEARXNG_URL);
        const ctx         = buildSearchContext(searchResults);
        toolResultContent = ctx ? sanitiseToolOutput(ctx) : `ERROR: No data found for "${ticker}".`;
        stockData         = null;
      } else {
        toolResultContent = `ERROR: No data found for "${ticker}".`;
      }
    }

  } else if (fnName === 'web_search') {
    const q = typeof fnArgs.query === 'string' ? fnArgs.query.trim() : '';
    if (!q || q.length < 2)  toolResultContent = 'ERROR: Search query missing or too short.';
    else if (!env.SEARXNG_URL) toolResultContent = 'ERROR: Search provider not configured.';
    else {
      searchResults     = await fetchSearchResults(q, env.SEARXNG_URL);
      const ctx         = buildSearchContext(searchResults);
      toolResultContent = ctx ? sanitiseToolOutput(ctx) : 'No relevant results found.';
    }

  } else {
    toolResultContent = `ERROR: Unknown tool "${fnName}".`;
  }

  // ── Call 2: Final answer ───────────────────────────────────────────────────
  const messages2 = [
    ...messages,
    { role: 'assistant', content: firstAssistMsg?.content ?? null, tool_calls: firstAssistMsg?.tool_calls ?? [] },
    { role: 'tool', tool_call_id: toolCallId, content: toolResultContent },
  ];

  try {
    const r2 = await mistralFetch(env.MISTRAL_API_KEY, {
      model: MODEL_ANSWER, messages: messages2,
      stream: true, max_tokens: MAX_TOKENS_ANSWER, temperature: 0.3,
    });
    if (!r2.ok) {
      console.error(`[Call2] ${r2.status}: ${await r2.text().catch(() => '')}`);
      return jsonError('AI service unavailable', 503);
    }

    if (stockData) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc    = new TextEncoder();
      (async () => {
        try {
          await writer.write(enc.encode(`data: ${JSON.stringify({ stock: stockData })}\n\n`));
          const reader = r2.body.getReader();
          while (true) { const { done, value } = await reader.read(); if (done) break; await writer.write(value); }
        } catch { } finally { try { await writer.close(); } catch { } }
      })();
      return sseResponse(readable);
    }

    return sseResponse(r2.body);

  } catch (e) {
    console.error('[Call2] threw:', e);
    return jsonError('AI service unavailable', 503);
  }
            }
