import { SYSTEM_PROMPT, ANSWER_INSTRUCTION, TOOL_ROUTER_PROMPT } from './systemPrompt.js';

// ── Constants ──────────────────────────────────────────────
const MAX_RESULTS            = 5;
const MAX_PAGE_TEXT_LEN      = 2500;
const MAX_TITLE_LEN          = 120;
const MAX_URL_LEN            = 300;
const MAX_SNIPPET_LEN        = 900;
const PAGE_TIMEOUT_MS        = 4000;
const MAX_TOKENS_TOOL_SELECT = 300;   // Call 1: only needs a tool call or a short direct answer
const MAX_TOKENS_ANSWER      = 350;   // Call 2: final answer
const HISTORY_LIMIT          = 10;
const THIN_SNIPPET_THRESHOLD = 300;

// Injection-attempt marker — if this appears in tool output, sanitise before forwarding
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

// ── Tool Definitions ───────────────────────────────────────
// Descriptions are required by the Mistral API for accurate tool selection.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stock_data',
      description:
        'Retrieve current stock market data for a publicly traded company or index. ' +
        'Returns: current price, open, high, low, previous close, and daily change. ' +
        'Use for stock price, current market valuation (price-based), and intraday movement queries. ' +
        'Do NOT use for company news, earnings, market cap, P/E, EPS, revenue, crypto, forex, or commodities.',
      parameters: {
        type: 'object',
        properties: {
          ticker: {
            type: 'string',
            description: 'Standard exchange ticker symbol in uppercase (e.g. AAPL, TSLA, NVDA, MSFT, ^GSPC).',
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
      description:
        'Search the web for current, time-sensitive, or externally verifiable information. ' +
        'Use for: latest news, recent events, current developments, niche or rapidly changing facts, ' +
        'real-world verification. ' +
        'Do NOT use for stable general knowledge, coding help, math, definitions, or writing tasks.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Concise, keyword-dense search query (not a full question).',
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
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function isValidTicker(ticker) {
  if (!ticker || typeof ticker !== 'string') return false;
  // Allow 1–12 uppercase alphanumeric chars, optional leading ^ for indices, optional . separator
  return /^\^?[A-Z0-9]{1,11}(\.[A-Z]{1,4})?$/.test(ticker.trim());
}

function sanitiseToolOutput(text) {
  // Replace suspected prompt-injection attempts with a safe placeholder
  // Tool output is data, not instructions
  if (INJECTION_SENTINEL_RE.test(text)) {
    return '[SANITISED: tool result contained instruction-like content and was removed]';
  }
  return text;
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

// Block private/loopback IPs to prevent SSRF via attacker-influenced SearXNG URLs
function isPrivateUrl(url) {
  try {
    const { hostname } = new URL(url);
    // Reject localhost and loopback
    if (hostname === 'localhost' || hostname === '::1') return true;
    // Reject IPv4 private ranges: 10.x, 172.16-31.x, 192.168.x, 127.x, 0.x, 169.254.x
    const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [, a, b] = v4.map(Number);
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 127) return true;
      if (a === 0) return true;
      if (a === 169 && b === 254) return true;
    }
    return false;
  } catch { return true; } // malformed URL — block it
}

async function fetchPageText(url, query) {
  try {
    if (isPrivateUrl(url)) return '';
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

// ── History Validation ─────────────────────────────────────
const VALID_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

function sanitiseHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m =>
      m &&
      typeof m === 'object' &&
      typeof m.role === 'string' &&
      VALID_ROLES.has(m.role) &&
      (typeof m.content === 'string' || m.content === null || m.content === undefined)
    )
    .map(m => {
      // Strip any keys we don't control to avoid injecting unexpected fields
      const clean = { role: m.role, content: m.content ?? '' };
      if (m.tool_call_id) clean.tool_call_id = String(m.tool_call_id);
      if (Array.isArray(m.tool_calls)) {
        // Validate each tool call: only pass through structurally valid entries
        // with function names in the known allowlist
        const ALLOWED_FN = new Set(['web_search', 'get_stock_data']);
        const validCalls = m.tool_calls.filter(tc =>
          tc &&
          typeof tc === 'object' &&
          typeof tc.id === 'string' &&
          tc.type === 'function' &&
          tc.function &&
          typeof tc.function === 'object' &&
          typeof tc.function.name === 'string' &&
          ALLOWED_FN.has(tc.function.name) &&
          typeof tc.function.arguments === 'string'
        );
        if (validCalls.length > 0) clean.tool_calls = validCalls;
      }
      return clean;
    });
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

    const quote   = quoteResp.ok   ? await quoteResp.json().catch(() => null)   : null;
    const profile = profileResp.ok ? await profileResp.json().catch(() => null) : null;
    const candle  = candleResp.ok  ? await candleResp.json().catch(() => null)  : null;

    // Treat price = 0 as invalid (Finnhub returns 0 for unsupported tickers)
    const price = quote?.c > 0 ? quote.c : (quote?.pc > 0 ? quote.pc : null);
    if (!quote || !price) return null;

    let series = [];
    if (candle && candle.s === 'ok' && Array.isArray(candle.t) && candle.t.length > 0) {
      const allCandles = candle.t.map((t, i) => ({
        t, o: candle.o[i], h: candle.h[i], l: candle.l[i], c: candle.c[i],
      }));
      const lastTs   = allCandles[allCandles.length - 1].t;
      const lastDate = new Date(lastTs * 1000);
      // Build date key using UTC components. getUTCMonth() is 0-indexed (0=Jan…11=Dec)
      // but both sides of the comparison use the same function so grouping is consistent.
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

// ── Groq API ──────────────────────────────────────────
async function groqFetch(apiKey, body) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
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
  if (!env.GROQ_API_KEY)    return jsonError('Server misconfiguration', 500);

  const MODEL_TOOL_SELECT = env.MISTRAL_MODEL_TOOL_SELECT || 'mistral-large-latest';
  const MODEL_ANSWER      = env.MISTRAL_MODEL_ANSWER      || 'qwen/qwen3.6-27b';

  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch { return jsonError('Invalid request body', 400); }

  if (!query?.trim()) return jsonError('Empty query', 400);

  const call1Messages = [
    { role: 'system', content: TOOL_ROUTER_PROMPT },
    ...sanitiseHistory(history).slice(-HISTORY_LIMIT),
    { role: 'user', content: query.trim() },
  ];

  const call2SystemContent = `${SYSTEM_PROMPT}\n\n${ANSWER_INSTRUCTION}`;

  // ── Call 1: Tool selection (non-streaming, low token budget) ──────────────
  // Mistral native tool calling is the authoritative routing mechanism.
  // The model returns either:
  //   A) a native tool_call  → toolCall is set
  //   B) a direct text answer (no tool needed) → directAnswer is set
  // A third outcome (null) means Call 1 itself failed.

  let toolCall       = null;
  let directAnswer   = null;
  let firstAssistMsg = null;

  try {
    const call1Resp = await mistralFetch(env.MISTRAL_API_KEY, {
      model:               MODEL_TOOL_SELECT,
      messages:            call1Messages,
      tools:               TOOLS,
      tool_choice:         'auto',
      parallel_tool_calls: false,
      stream:              false,
      max_tokens:          MAX_TOKENS_TOOL_SELECT,
      temperature:         0.2,
    });

    if (!call1Resp.ok) {
      const errText = await call1Resp.text().catch(() => '');
      console.error(`[Call1] Mistral error ${call1Resp.status}: ${errText}`);
      // Fall through — both toolCall and directAnswer remain null
    } else {
      const d   = await call1Resp.json().catch(() => null);
      const msg = d?.choices?.[0]?.message;
      firstAssistMsg = msg ?? null;

      if (msg?.tool_calls?.length) {
        toolCall = msg.tool_calls[0];
      } else if (typeof msg?.content === 'string' && msg.content.trim()) {
        const raw = msg.content.trim();
        // Guard: if model emitted XML-style tool call text into content instead of
        // a proper native tool_calls entry, treat it as a Call 1 routing failure
        // rather than streaming raw XML to the UI.
        if (/<tool_call|<function=/.test(raw)) {
          toolCall     = null;
          directAnswer = null;
        } else {
          directAnswer = raw;
        }
      }
    }
  } catch (err) {
    console.error('[Call1] fetch threw:', err);
    // Fall through — both remain null
  }

  // ── Call 1 complete failure: nothing returned ─────────────────────────────
  if (!toolCall && !directAnswer) {
    return jsonError('AI service unavailable', 503);
  }

  // ── Call 2 not needed: direct answer from Call 1 ──────────────────────────
  // Build SSE response from directAnswer without a second model call.
  if (!toolCall && directAnswer) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc    = new TextEncoder();
    (async () => {
      try {
        await writer.write(enc.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: directAnswer } }] })}\n\n`
        ));
        await writer.write(enc.encode('data: [DONE]\n\n'));
      } catch { /* ignore */ } finally {
        try { await writer.close(); } catch { /* already closed */ }
      }
    })();
    return new Response(readable, {
      headers: {
        'Content-Type':      'text/event-stream',
        'Cache-Control':     'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // ── Tool was chosen: validate arguments before execution ──────────────────
  const fnName    = toolCall.function?.name;
  const toolCallId = toolCall.id ?? `tool_${Date.now()}`; // defensive: id should always be present

  let fnArgs = {};
  let argParseError = false;
  try {
    fnArgs = JSON.parse(toolCall.function?.arguments || '{}');
    if (typeof fnArgs !== 'object' || fnArgs === null) { fnArgs = {}; argParseError = true; }
  } catch {
    argParseError = true;
  }

  // ── Execute tool ──────────────────────────────────────────────────────────
  let stockData         = null;
  let searchResults     = [];
  let toolResultContent = '';

  if (argParseError) {
    toolResultContent = 'ERROR: Tool arguments were malformed and could not be parsed.';

  } else if (fnName === 'get_stock_data') {
    const ticker = typeof fnArgs.ticker === 'string' ? fnArgs.ticker.trim().toUpperCase() : '';

    if (!ticker) {
      toolResultContent = 'ERROR: No ticker symbol was provided.';
    } else if (!isValidTicker(ticker)) {
      toolResultContent = `ERROR: "${ticker}" is not a valid ticker format.`;
    } else if (!env.FINNHUB_API_KEY) {
      toolResultContent = 'ERROR: Stock data provider is not configured.';
    } else {
      stockData = await fetchStockData(ticker, env.FINNHUB_API_KEY);
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
        // Finnhub returned no data — fall back to web search without a third model call
        if (env.SEARXNG_URL) {
          const fallbackQuery = `${ticker} stock price today`;
          searchResults = await fetchSearchResults(fallbackQuery, env.SEARXNG_URL);
          const searchCtx = buildSearchContext(searchResults);
          toolResultContent =
            `ERROR: Real-time stock data is unavailable for "${ticker}" ` +
            `(unsupported exchange, invalid ticker, or provider error).\n` +
            `[FALLBACK — WEB DATA, NOT LIVE STRUCTURED QUOTE]:\n` +
            (searchCtx || 'No web fallback data found either.');
        } else {
          toolResultContent =
            `ERROR: Real-time stock data is unavailable for "${ticker}" ` +
            `and no web fallback is configured.`;
        }
      }
    }

  } else if (fnName === 'web_search') {
    const rawQuery = typeof fnArgs.query === 'string' ? fnArgs.query.trim() : '';

    if (!rawQuery || rawQuery.length < 2) {
      toolResultContent = 'ERROR: Search query was empty or too short.';
    } else if (!env.SEARXNG_URL) {
      toolResultContent = 'ERROR: Search provider is not configured.';
    } else {
      searchResults = await fetchSearchResults(rawQuery, env.SEARXNG_URL);
      const ctx = buildSearchContext(searchResults);
      toolResultContent = ctx || 'No search results found for this query.';
    }

  } else {
    // Unknown tool name — model returned something unexpected; never execute it
    toolResultContent = `ERROR: Unknown tool "${fnName ?? 'undefined'}" was requested.`;
  }

  // Sanitise tool output against prompt injection before it reaches the model
  toolResultContent = sanitiseToolOutput(toolResultContent);

  // ── Call 2: Final answer (streaming) ──────────────────────────────────────
  // Reconstruct the exact conversation the model expects:
  //   original messages → assistant tool-call turn → tool result → model generates answer

  const finalMessages = [
    { role: 'system', content: call2SystemContent },
    ...sanitiseHistory(history).slice(-HISTORY_LIMIT),
    { role: 'user', content: query.trim() },
    {
      role:       'assistant',
      content:    firstAssistMsg?.content ?? '',   // must be string, not null
      tool_calls: [toolCall],
    },
    {
      role:         'tool',
      tool_call_id: toolCallId,
      content:      toolResultContent,
    },
  ];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  const safeWrite = async (chunk) => {
    try { await writer.write(chunk); } catch { /* writer closed */ }
  };

  (async () => {
    let reader = null;
    try {
      // Emit UI data events before streaming the answer text
      if (stockData) {
        await safeWrite(enc.encode(`event: stock\ndata: ${JSON.stringify(stockData)}\n\n`));
      }
      if (searchResults.length > 0) {
        await safeWrite(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }

      const answerResp = await groqFetch(env.GROQ_API_KEY, {
        model:            MODEL_ANSWER,
        messages:         finalMessages,
        stream:           true,
        max_tokens:       MAX_TOKENS_ANSWER,
        temperature:      0.7,
        top_p:            0.80,
        presence_penalty: 1.5,
        reasoning_effort: 'none',
        reasoning_format: 'hidden',
      });

      if (!answerResp.ok) {
        const errText = await answerResp.text().catch(() => '');
        console.error(`[Call2] Groq error ${answerResp.status}: ${errText}`);
        await safeWrite(enc.encode(`data: ${JSON.stringify({ error: 'AI response failed' })}\n\n`));
        return;
      }

      reader = answerResp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await safeWrite(value);
      }
    } catch (err) {
      console.error('[Call2] streaming error:', err);
      if (reader) { try { await reader.cancel(); } catch { /* ignore */ } }
      await safeWrite(enc.encode(`data: ${JSON.stringify({ error: 'Internal error' })}\n\n`));
    } finally {
      try { await writer.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
