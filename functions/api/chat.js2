import { SYSTEM_PROMPT } from './systemPrompt.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MISTRAL_MODEL    = 'mistral-small-2603';
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const FINNHUB_BASE     = 'https://finnhub.io/api/v1';
const SERPER_ENDPOINT  = 'https://google.serper.dev/search';

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
          query: { type: 'string', description: 'A concise, keyword-focused search query.' },
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
      fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&${token}`,                { signal: AbortSignal.timeout(4000) }),
      fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&${token}`,       { signal: AbortSignal.timeout(4000) }),
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
      pe:        m['peNormalizedAnnual'] ?? m['peTTM']  ?? null,
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

// ─── SSE Helpers ──────────────────────────────────────────────────────────────

function sseChunk(content, finishReason = null) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\n`;
}

const SSE_DONE = 'data: [DONE]\n\n';

// ─── Request Handler ──────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const requestId = crypto.randomUUID();

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

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT + '\n\nCRITICAL: You have a limited output token budget. Always complete your response fully within it. Never truncate mid-sentence. If space is tight, summarise — never cut off.' },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: query },
  ];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      // ── Call 1: Tool routing ──────────────────────────────────────────────
      console.log(`[${requestId}] Call 1: tool routing`);

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
        console.log(`[${requestId}] No tool call — streaming direct answer`);
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

      console.log(`[${requestId}] Tool requested: ${functionName}`);

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
        const results = await executeSerper(validatedArgs.query, env.SERPER_API_KEY);
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
      }

      // Emit frontend event before streaming answer
      if (frontendEvent && frontendData) {
        await writer.write(enc.encode(`event: ${frontendEvent}\ndata: ${JSON.stringify(frontendData)}\n\n`));
      }

      // ── Call 2: Final streamed answer ─────────────────────────────────────
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
  
