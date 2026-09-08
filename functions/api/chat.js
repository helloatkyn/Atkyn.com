import { SYSTEM_PROMPT } from './systemPrompt.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MISTRAL_MODEL    = 'ministral-14b-2512';
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const FINNHUB_BASE     = 'https://finnhub.io/api/v1';
const SERPER_ENDPOINT  = 'https://google.serper.dev/search';

// WorldTimeAPI: free, no key, IANA timezone support.
// Provider can be swapped by replacing only executeDatetime() below.
const WORLDTIME_ENDPOINT = 'https://worldtimeapi.org/api/timezone';

// ─── Temporal Intent Detection ────────────────────────────────────────────────
// Lightweight pre-LLM pass. Returns true when the query contains relative or
// ambiguous temporal language that requires a real current timestamp to
// interpret correctly. Does NOT run the API — only gates it.

const TEMPORAL_PATTERNS = /\b(today|yesterday|tomorrow|right now|as of now|currently|recent(?:ly)?|latest|this\s+(week|month|year|morning|evening|afternoon)|last\s+(week|month|year)|next\s+(week|month|year)|what\s+(day|date|time)\s+(is\s+it)?|current\s+(date|time|year|month)|now)\b/i;

// Detects queries asking for the CURRENT DATE/TIME only — no external fact involved.
// These bypass Call 1 entirely: we answer directly from temporalContext.
const PURE_DATETIME_PATTERNS = /\b(what(?:'s|\s+is)\s+(the\s+)?(day|date|time|year|month)\s*(today|now|currently)?|what(?:'s|\s+is)\s+today(?:'s\s+(date|day))?|what\s+day\s+is\s+(it|today)|today(?:'s)?\s+(date|day)|current\s+(date|time|day|year|month)|what\s+time\s+is\s+it)\b/i;

// Detects queries asking for an "externally changing fact" that must be verified via search.
// Triggers when temporal keywords co-occur with a non-temporal subject (version, price, news, etc.)
const EXTERNAL_FACT_TEMPORAL_PATTERNS = /\b(latest|newest|most\s+recent|current\s+version|as\s+of\s+now|right\s+now|currently)\b/i;
// Subject patterns that indicate an external fact (not just date/time itself)
const EXTERNAL_FACT_SUBJECT_PATTERNS = /\b(version|release|update|price|rate|score|ranking|news|event|result|winner|champion|status|record|leader|ceo|president|pm|prime\s+minister|governor|law|policy|regulation|bill)\b/i;

function requiresTemporalResolution(query) {
  return TEMPORAL_PATTERNS.test(query);
}

function isPureDateTimeQuery(query) {
  return PURE_DATETIME_PATTERNS.test(query);
}

/**
 * Returns true when the query asks for a current/latest EXTERNAL FACT
 * (version, price, etc.) that the LLM must NOT answer from memory.
 * These queries MUST use web_search regardless of temporal context.
 */
function requiresForcedSearch(query) {
  return EXTERNAL_FACT_TEMPORAL_PATTERNS.test(query) && EXTERNAL_FACT_SUBJECT_PATTERNS.test(query);
}

// ─── Date/Time Tool Executor ───────────────────────────────────────────────────

/**
 * Fetches current date/time from WorldTimeAPI for the given IANA timezone.
 * Falls back to the Cloudflare Workers runtime Date if the API is unavailable.
 * Never fabricates a timestamp — returns an explicit uncertainty flag on failure.
 *
 * @param {string} timezone  IANA timezone string, e.g. "Asia/Kolkata"
 * @returns {object}         Structured datetime result
 */
async function executeDatetime(timezone = 'UTC') {
  // Sanitize: only allow valid IANA-like strings (e.g. "Asia/Kolkata")
  const safeTimezone = /^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/.test(timezone)
    ? timezone
    : 'UTC';

  try {
    const resp = await fetch(`${WORLDTIME_ENDPOINT}/${safeTimezone}`, {
      signal: AbortSignal.timeout(4000),
    });

    if (!resp.ok) throw new Error(`WorldTimeAPI ${resp.status}`);

    const d = await resp.json();

    // d.datetime is ISO-8601, e.g. "2025-09-12T14:35:22.123456+05:30"
    const dt      = new Date(d.datetime);
    const weekday = d.day_of_week; // 0 = Sunday

    const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

    return {
      source:      'worldtimeapi',
      reliable:    true,
      timezone:    d.timezone,
      utcOffset:   d.utc_offset,
      unixTs:      d.unixtime,
      iso8601:     d.datetime,
      date:        d.datetime.slice(0, 10),          // YYYY-MM-DD
      time:        d.datetime.slice(11, 19),          // HH:MM:SS
      year:        dt.getFullYear(),
      month:       MONTHS[dt.getMonth()],
      monthNum:    dt.getMonth() + 1,
      day:         dt.getDate(),
      dayOfWeek:   DAYS[weekday],
      // Derived relative labels for normalization
      yesterday:   isoDateOffset(d.datetime, -1),
      tomorrow:    isoDateOffset(d.datetime,  1),
    };
  } catch (apiErr) {
    // Fallback: Cloudflare Workers runtime Date (UTC only, no timezone offset)
    try {
      const now = new Date();
      const iso = now.toISOString();
      return {
        source:    'runtime-fallback',
        reliable:  true,
        uncertain: true,             // caller should note this to user if timezone matters
        timezone:  'UTC',
        utcOffset: '+00:00',
        unixTs:    Math.floor(now.getTime() / 1000),
        iso8601:   iso,
        date:      iso.slice(0, 10),
        time:      iso.slice(11, 19),
        year:      now.getUTCFullYear(),
        month:     ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'][now.getUTCMonth()],
        monthNum:  now.getUTCMonth() + 1,
        day:       now.getUTCDate(),
        dayOfWeek: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getUTCDay()],
        yesterday: isoDateOffset(iso, -1),
        tomorrow:  isoDateOffset(iso,  1),
        error:     apiErr.message,
      };
    } catch {
      // Total failure — neither API nor runtime clock available.
      return {
        source:   'none',
        reliable: false,
        uncertain: true,
        error:    'Date/Time API unavailable and runtime clock inaccessible.',
      };
    }
  }
}

/** Returns an ISO date string offset by `days` from a base ISO-8601 string. */
function isoDateOffset(isoString, days) {
  const d = new Date(isoString);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Formats the datetime result into a concise, unambiguous context note
 * injected into the system prompt before the LLM processes the query.
 */
function formatDatetimeContext(dt) {
  if (!dt.reliable) {
    return 'TEMPORAL CONTEXT: Date/Time unavailable. Do not fabricate or assume the current date or time. Explicitly state temporal uncertainty if relevant.';
  }

  const uncertainty = dt.uncertain
    ? ' (WARNING: timezone-aware time unavailable — this is UTC from the runtime clock)'
    : '';

  return [
    `AUTHORITATIVE TEMPORAL CONTEXT${uncertainty}:`,
    `The following date/time was obtained from the application's datetime system. It is authoritative.`,
    `NEVER use pretrained knowledge or conversation history to determine the current date/time.`,
    `If your internal knowledge conflicts with this context, ALWAYS trust this context.`,
    ``,
    `  Current date     : ${dt.date} (${dt.dayOfWeek}, ${dt.month} ${dt.day}, ${dt.year})`,
    `  Current time     : ${dt.time}`,
    `  Timezone         : ${dt.timezone} (UTC${dt.utcOffset})`,
    `  ISO-8601         : ${dt.iso8601}`,
    `  Unix timestamp   : ${dt.unixTs}`,
    `  Yesterday        : ${dt.yesterday}`,
    `  Tomorrow         : ${dt.tomorrow}`,
    ``,
    `When the user uses relative expressions such as "today", "yesterday", "tomorrow", "this week",`,
    `"last month", "recently", "latest", "now", or "currently", resolve them against the values above`,
    `before constructing any search query or answer. Never guess. Use the resolved date in search queries.`,
    ``,
    `STALE KNOWLEDGE RULE: Whenever a query asks for a current, latest, newest, recent, or as-of-now`,
    `external fact (version numbers, prices, rankings, events, etc.), your internal model knowledge is`,
    `INSUFFICIENT by default. You MUST use web_search to verify. Never present an old known value as`,
    `the current value. The current date being known does NOT mean the external fact is known.`,
  ].join('\n');
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for real-time facts, recent events, or specific URLs. Do NOT use for general knowledge, math, or coding.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A concise, keyword-focused search query. Use resolved dates (YYYY-MM-DD) for time-sensitive queries.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stock_data',
      description: 'Fetch real-time stock price, market cap, and valuation metrics for a given ticker symbol.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol only (e.g., AAPL, TSLA, RELIANCE.NS). Do not include company names.' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'datetime_tool',
      description: [
        'Returns the current date, time, day of week, month, year, timezone, UTC offset, Unix timestamp, and ISO-8601 timestamp.',
        'Use this tool ONLY when the user explicitly asks for the current date or time,',
        'or when a temporal expression (today, yesterday, tomorrow, this week, last month, etc.)',
        'must be resolved to a concrete date before searching or answering.',
        'Do NOT call this for every query. Stable knowledge queries never need this tool.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'IANA timezone string (e.g. "Asia/Kolkata", "America/New_York", "Europe/London"). Defaults to "UTC" if unknown.',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

// ─── Validation ───────────────────────────────────────────────────────────────

function validateToolArgs(toolName, rawArgs) {
  if (toolName === 'web_search') {
    if (!rawArgs.query || typeof rawArgs.query !== 'string') {
      throw new Error('Missing or invalid "query". Must be a string.');
    }
    const cleanQuery = rawArgs.query.trim();
    if (cleanQuery.length < 2) {
      throw new Error('Query is too short. Must be at least 2 characters.');
    }
    return { query: cleanQuery };
  }

  if (toolName === 'stock_data') {
    if (!rawArgs.symbol || typeof rawArgs.symbol !== 'string') {
      throw new Error('Missing or invalid "symbol". Must be a string.');
    }
    const cleanSymbol = rawArgs.symbol.trim().toUpperCase();
    if (cleanSymbol.length < 1 || cleanSymbol.length > 10) {
      throw new Error('Invalid stock symbol length. Must be 1–10 characters.');
    }
    for (let i = 0; i < cleanSymbol.length; i++) {
      const c = cleanSymbol.charCodeAt(i);
      if (!((c >= 65 && c <= 90) || (c >= 48 && c <= 57))) {
        throw new Error('Stock symbol must contain only letters and numbers.');
      }
    }
    return { symbol: cleanSymbol };
  }

  if (toolName === 'datetime_tool') {
    const tz = rawArgs.timezone && typeof rawArgs.timezone === 'string'
      ? rawArgs.timezone.trim()
      : 'UTC';
    return { timezone: tz };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

// ─── Tool Executors ───────────────────────────────────────────────────────────

async function executeSerper(searchQuery, serperApiKey) {
  try {
    const resp = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY':    serperApiKey,
      },
      body: JSON.stringify({ q: searchQuery, num: 8 }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return [];

    const data    = await resp.json();
    const organic = data.organic || [];

    return organic.slice(0, 8).map((r) => ({
      title:   r.title   || 'Untitled',
      url:     r.link    || '#',
      snippet: r.snippet || 'No snippet available.',
    })).filter((r) => r.url !== '#');

  } catch {
    return [];
  }
}

async function executeStockData(symbol, finnhubApiKey) {
  const token = `token=${finnhubApiKey}`;
  try {
    const [quoteResp, profileResp, metricResp] = await Promise.all([
      fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&${token}`,                   { signal: AbortSignal.timeout(4000) }),
      fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&${token}`,          { signal: AbortSignal.timeout(4000) }),
      fetch(`${FINNHUB_BASE}/stock/metric?symbol=${symbol}&metric=all&${token}`, { signal: AbortSignal.timeout(4000) }),
    ]);

    if (!quoteResp.ok) throw new Error('Quote API failed');

    const q = await quoteResp.json();
    const p = (await profileResp.json()) || {};
    const m = ((await metricResp.json()) || {}).metric || {};

    if (!q.c) throw new Error(`No price data for '${symbol}'. Symbol may be invalid.`);

    const marketCapM = p.marketCapitalization || 0;
    let marketCap = 'N/A';
    if      (marketCapM >= 1_000_000) marketCap = `$${(marketCapM / 1_000_000).toFixed(2)}T`;
    else if (marketCapM >= 1_000)     marketCap = `$${(marketCapM / 1_000).toFixed(2)}B`;
    else if (marketCapM > 0)          marketCap = `$${marketCapM.toFixed(2)}M`;

    return {
      ticker:    symbol,
      name:      p.name      || symbol,
      exchange:  p.exchange  || 'Unknown',
      logo:      p.logo      || '',
      currency:  p.currency  || 'USD',
      marketCap,
      price:     q.c  ?? 0,
      change:    q.d  ?? 0,
      changePct: q.dp ?? 0,
      open:      q.o  ?? 0,
      high:      q.h  ?? 0,
      low:       q.l  ?? 0,
      prevClose: q.pc ?? 0,
      pe:        m['peNormalizedAnnual'] ?? m['peTTM']   ?? null,
      eps:       m['epsNormalizedAnnual'] ?? m['epsTTM'] ?? null,
    };
  } catch (err) {
    return { error: true, message: `Failed to fetch data for ${symbol}: ${err.message}` };
  }
}

// ─── LLM Formatters ───────────────────────────────────────────────────────────

function formatSearchResultsForLLM(results) {
  if (!results.length) return 'No search results found.';
  return results
    .map((r, i) => `--- SOURCE ${i + 1} ---\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.snippet}`)
    .join('\n\n');
}

function formatStockDataForLLM(data) {
  if (data.error) return `Error: ${data.message}`;
  const prefix = data.currency === 'USD' ? '$' : '';
  return [
    `Stock: ${data.name} (${data.ticker})`,
    `Exchange: ${data.exchange}`,
    `Price: ${prefix}${data.price}`,
    `Change: ${data.change >= 0 ? '+' : ''}${data.change} (${data.changePct}%)`,
    `Market Cap: ${data.marketCap}`,
    `Open: ${data.open} | High: ${data.high} | Low: ${data.low} | Prev Close: ${data.prevClose}`,
  ].join('\n');
}

function formatDatetimeForLLM(dt) {
  if (!dt.reliable) {
    return `Date/Time API error: ${dt.error}. Do not fabricate the current date or time. Acknowledge temporal uncertainty to the user.`;
  }
  const uncertainty = dt.uncertain ? ' [TIMEZONE UNCERTAIN — UTC runtime fallback used]' : '';
  return [
    `Current Date/Time${uncertainty}:`,
    `  Date      : ${dt.date}`,
    `  Time      : ${dt.time}`,
    `  Day       : ${dt.dayOfWeek}`,
    `  Month     : ${dt.month} (${dt.monthNum})`,
    `  Year      : ${dt.year}`,
    `  Timezone  : ${dt.timezone}`,
    `  UTC offset: ${dt.utcOffset}`,
    `  Unix      : ${dt.unixTs}`,
    `  ISO-8601  : ${dt.iso8601}`,
    `  Yesterday : ${dt.yesterday}`,
    `  Tomorrow  : ${dt.tomorrow}`,
  ].join('\n');
}

// ─── SSE Helpers ──────────────────────────────────────────────────────────────

function sseChunk(content, finishReason = null) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\n`;
}

const SSE_DONE = 'data: [DONE]\n\n';

// ─── Request Handler ──────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const requestId = crypto.randomUUID();

  let query, history, timezone;
  try {
    ({ query, history, timezone } = await request.json());
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

  // ── Temporal Pre-Resolution ───────────────────────────────────────────────
  // Runs before LLM call 1. If the query contains relative temporal language,
  // we resolve the current date/time now so the LLM gets accurate context.
  // This does NOT call the LLM — it's a pure pre-processing step.

  let temporalContext = null;
  const userTimezone  = (typeof timezone === 'string' && timezone.trim()) ? timezone.trim() : 'UTC';

  const pureDatetime  = isPureDateTimeQuery(query);
  const forcedSearch  = requiresForcedSearch(query);

  console.log(`[${requestId}] [Temporal] detected: ${requiresTemporalResolution(query)} | pureDatetime: ${pureDatetime} | forcedSearch: ${forcedSearch}`);

  if (requiresTemporalResolution(query)) {
    console.log(`[${requestId}] [Temporal] resolving date/time (tz: ${userTimezone})`);
    temporalContext = await executeDatetime(userTimezone);
    console.log(`[${requestId}] [Temporal] resolved: ${temporalContext.date} via ${temporalContext.source}`);
  }

  // Inject temporal context into system prompt when available.
  // Placed after the main system prompt so it's always the freshest context.
  const systemContent = temporalContext
    ? `${SYSTEM_PROMPT}\n\n${formatDatetimeContext(temporalContext)}\n\nCRITICAL: You have a limited output token budget. Always complete your response fully within it. Never truncate mid-sentence. If space is tight, summarise — never cut off.`
    : `${SYSTEM_PROMPT}\n\nCRITICAL: You have a limited output token budget. Always complete your response fully within it. Never truncate mid-sentence. If space is tight, summarise — never cut off.`;

  const baseMessages = [
    { role: 'system', content: systemContent },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: query },
  ];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      // ── Pure Date/Time Short-Circuit ────────────────────────────────────────
      // For queries like "What's the day today?" / "What is today's date?" —
      // we already have the authoritative answer from temporalContext.
      // Bypass Call 1 entirely: build the answer directly, stream it.
      if (pureDatetime && temporalContext?.reliable) {
        console.log(`[${requestId}] [Tool] datetime_tool (pre-resolved short-circuit)`);
        const dtContent = formatDatetimeForLLM(temporalContext);

        // Ask LLM to format the answer naturally using ONLY the provided data
        const call1Resp = await fetch(MISTRAL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
          },
          body: JSON.stringify({
            model:    MISTRAL_MODEL,
            messages: [
              { role: 'system', content: `You are a helpful assistant. Answer the user's date/time question using ONLY the data provided below. Do not use your own knowledge. Do not add or infer any information not present in the data.\n\n${dtContent}` },
              { role: 'user',   content: query },
            ],
            stream:      true,
            max_tokens:  200,
            temperature: 0.1,
          }),
        });

        if (!call1Resp.ok) throw new Error(`Mistral datetime shortcircuit error: ${call1Resp.status}`);
        const reader = call1Resp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        console.log(`[${requestId}] Done (datetime short-circuit)`);
        await writer.close();
        return;
      }

      // ── Forced Search Short-Circuit ─────────────────────────────────────────
      // For queries like "latest stable version of Python" — must search first.
      // We skip Call 1 tool routing and directly execute web_search, then
      // feed results to Call 2 for the final answer.
      if (forcedSearch) {
        console.log(`[${requestId}] [Search] required: true (forcedSearch)`);
        // Build a date-aware search query
        const dateHint = temporalContext?.reliable ? ` as of ${temporalContext.date}` : '';
        const searchQuery = `${query}${dateHint}`;
        console.log(`[${requestId}] [Tool] web_search`);
        console.log(`[${requestId}] [Search] query: ${searchQuery}`);

        const results = await executeSerper(searchQuery, env.SERPER_API_KEY);
        console.log(`[${requestId}] [Search] result count: ${results.length}`);

        const toolResultContent = results.length > 0
          ? formatSearchResultsForLLM(results)
          : 'No search results found. Do not fabricate an answer from internal knowledge. Tell the user the current information could not be verified.';

        if (results.length > 0) {
          await writer.write(enc.encode(`event: results\ndata: ${JSON.stringify(results)}\n\n`));
        }

        // Call 2: final answer with search results
        console.log(`[${requestId}] Call 2 (forced search): final answer`);
        const forcedMessages = [
          ...baseMessages,
          // Synthetic assistant message representing the forced tool use
          {
            role:    'assistant',
            content: null,
            tool_calls: [{
              id:       'forced_search_0',
              type:     'function',
              function: { name: 'web_search', arguments: JSON.stringify({ query: searchQuery }) },
            }],
          },
          {
            role:         'tool',
            content:      toolResultContent,
            tool_call_id: 'forced_search_0',
          },
        ];

        const call2Resp = await fetch(MISTRAL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
          },
          body: JSON.stringify({
            model:       MISTRAL_MODEL,
            messages:    forcedMessages,
            stream:      true,
            max_tokens:  4000,
            temperature: 0.6,
          }),
        });

        if (!call2Resp.ok) throw new Error(`Mistral forced search Call 2 error: ${call2Resp.status}`);
        const reader = call2Resp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        console.log(`[${requestId}] Done (forced search)`);
        await writer.close();
        return;
      }

      // ── Call 1: Tool routing ────────────────────────────────────────────────
      console.log(`[${requestId}] Call 1: tool routing`);
      console.log(`[${requestId}] [Search] required: false (standard routing)`);

      const call1Resp = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model:       MISTRAL_MODEL,
          messages:    baseMessages,
          tools:       TOOLS,
          tool_choice: 'auto',
          stream:      false,
          max_tokens:  4000,
          temperature: 0.1,
        }),
      });

      if (!call1Resp.ok) {
        throw new Error(`Mistral Call 1 error: ${call1Resp.status} ${await call1Resp.text()}`);
      }

      const call1Data    = await call1Resp.json();
      const assistantMsg = call1Data.choices?.[0]?.message;
      const toolCalls    = assistantMsg?.tool_calls;

      // ── No tool call → stream direct answer ──────────────────────────────
      if (!toolCalls || toolCalls.length === 0) {
        console.log(`[${requestId}] [Tool] none — streaming direct answer`);
        const answer = assistantMsg?.content ?? 'I could not process that request.';
        for (const chunk of answer.split(/(?<=\s)/)) {
          await writer.write(enc.encode(sseChunk(chunk)));
        }
        await writer.write(enc.encode(sseChunk('', 'stop')));
        await writer.write(enc.encode(SSE_DONE));
        await writer.close();
        return;
      }

      // ── Parse tool call ───────────────────────────────────────────────────
      const toolCall     = toolCalls[0];
      const toolCallId   = toolCall.id;
      const functionName = toolCall.function?.name;

      console.log(`[${requestId}] [Tool] ${functionName}`);

      let functionArgs;
      try {
        const raw = toolCall.function?.arguments;
        functionArgs = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error('LLM returned malformed JSON for tool arguments.');
      }

      let validatedArgs;
      try {
        validatedArgs = validateToolArgs(functionName, functionArgs);
      } catch (err) {
        console.error(`[${requestId}] Validation error: ${err.message}`);
        await writer.write(enc.encode(sseChunk(`Tool validation failed: ${err.message}`, 'stop')));
        await writer.write(enc.encode(SSE_DONE));
        await writer.close();
        return;
      }

      // ── Execute tool ──────────────────────────────────────────────────────
      let toolResultContent = '';
      let frontendEvent     = null;
      let frontendData      = null;

      if (functionName === 'web_search') {
        console.log(`[${requestId}] [Search] query: ${validatedArgs.query}`);
        const results = await executeSerper(validatedArgs.query, env.SERPER_API_KEY);
        console.log(`[${requestId}] [Search] result count: ${results.length}`);
        toolResultContent = formatSearchResultsForLLM(results);
        if (results.length > 0) {
          frontendEvent = 'results';
          frontendData  = results;
        }

      } else if (functionName === 'stock_data') {
        const data = await executeStockData(validatedArgs.symbol, env.FINNHUB_API_KEY);
        toolResultContent = formatStockDataForLLM(data);
        if (!data.error) {
          frontendEvent = 'stock';
          frontendData  = data;
        }

      } else if (functionName === 'datetime_tool') {
        // LLM explicitly requested date/time (e.g. "What time is it in Tokyo?").
        // If we already resolved temporal context in pre-processing, reuse it
        // when the timezone matches — avoids a redundant API call.
        let dtResult;
        if (
          temporalContext &&
          temporalContext.reliable &&
          validatedArgs.timezone === userTimezone
        ) {
          dtResult = temporalContext;
          console.log(`[${requestId}] Reusing pre-resolved temporal context`);
        } else {
          dtResult = await executeDatetime(validatedArgs.timezone || userTimezone);
          console.log(`[${requestId}] datetime_tool executed: ${dtResult.date} via ${dtResult.source}`);
        }
        toolResultContent = formatDatetimeForLLM(dtResult);
        // No frontend event for datetime — purely informational for the LLM
      }

      // Emit frontend event before streaming answer
      if (frontendEvent && frontendData) {
        await writer.write(enc.encode(`event: ${frontendEvent}\ndata: ${JSON.stringify(frontendData)}\n\n`));
      }

      // ── Call 2: Final streamed answer ────────────────────────────────────
      console.log(`[${requestId}] Call 2: final answer`);

      const call2Resp = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model:    MISTRAL_MODEL,
          messages: [
            ...baseMessages,
            {
              role:       'assistant',
              content:    assistantMsg.content ?? null,
              tool_calls: toolCalls,
            },
            {
              role:         'tool',
              content:      toolResultContent,
              tool_call_id: toolCallId,
            },
          ],
          stream:      true,
          max_tokens:  4000,
          temperature: 0.6,
        }),
      });

      if (!call2Resp.ok) {
        throw new Error(`Mistral Call 2 error: ${call2Resp.status} ${await call2Resp.text()}`);
      }

      const reader = call2Resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }

      console.log(`[${requestId}] Done`);
      await writer.close();

    } catch (err) {
      console.error(`[${requestId}] Fatal: ${err.message}`);
      try {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: 'An internal error occurred. Please try again.' })}\n\n`));
        await writer.write(enc.encode(SSE_DONE));
        await writer.close();
      } catch {
        // writer already closed — nothing to do
      }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ─── Test Cases (run locally with Node / Vitest) ─────────────────────────────
// Uncomment and adapt to your test runner.

/*
import { describe, it, expect, vi } from 'vitest';

describe('Temporal Resolution', () => {
  it('requiresTemporalResolution: "What date is it today?" → true', () => {
    expect(requiresTemporalResolution('What date is it today?')).toBe(true);
  });

  it('requiresTemporalResolution: "What happened yesterday?" → true', () => {
    expect(requiresTemporalResolution('What happened yesterday?')).toBe(true);
  });

  it('requiresTemporalResolution: "Latest React version?" → true', () => {
    expect(requiresTemporalResolution('Latest React version?')).toBe(true);
  });

  it('requiresTemporalResolution: "What is a Python closure?" → false', () => {
    expect(requiresTemporalResolution('What is a Python closure?')).toBe(false);
  });

  it('requiresTemporalResolution: "What is 2 + 2?" → false', () => {
    expect(requiresTemporalResolution('What is 2 + 2?')).toBe(false);
  });
});

describe('executeDatetime', () => {
  it('returns a reliable result for Asia/Kolkata', async () => {
    const dt = await executeDatetime('Asia/Kolkata');
    expect(dt.reliable).toBe(true);
    expect(dt.timezone).toBe('Asia/Kolkata');
    expect(dt.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dt.yesterday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dt.tomorrow).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back gracefully when API is unreachable', async () => {
    // Simulate API failure by mocking fetch to throw
    const origFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('Network error'));
    const dt = await executeDatetime('America/New_York');
    globalThis.fetch = origFetch;
    // Should fall back to runtime clock, not fabricate
    expect(['runtime-fallback', 'none']).toContain(dt.source);
    if (dt.source === 'runtime-fallback') {
      expect(dt.reliable).toBe(true);
      expect(dt.uncertain).toBe(true);
    } else {
      expect(dt.reliable).toBe(false);
    }
  });

  it('never fabricates date when API fails and runtime fails', async () => {
    const origFetch = globalThis.fetch;
    const origDate  = globalThis.Date;
    globalThis.fetch = () => Promise.reject(new Error('Network error'));
    globalThis.Date  = class { constructor() { throw new Error('No clock'); } static now() { throw new Error(); } };
    const dt = await executeDatetime('UTC');
    globalThis.fetch = origFetch;
    globalThis.Date  = origDate;
    expect(dt.reliable).toBe(false);
    expect(dt.source).toBe('none');
  });
});

describe('isoDateOffset', () => {
  it('returns yesterday correctly', () => {
    expect(isoDateOffset('2025-03-01T00:00:00Z', -1)).toBe('2025-02-28');
  });

  it('returns tomorrow correctly across month boundary', () => {
    expect(isoDateOffset('2025-01-31T00:00:00Z', 1)).toBe('2025-02-01');
  });
});
*/
