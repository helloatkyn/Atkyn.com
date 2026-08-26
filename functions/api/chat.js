import { SYSTEM_PROMPT } from './systemPrompt.js';

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
      throw new Error('Invalid stock symbol length. Must be 1-10 characters.');
    }
    for (let i = 0; i < cleanSymbol.length; i++) {
      const char = cleanSymbol.charCodeAt(i);
      const isAlpha = (char >= 65 && char <= 90);
      const isNum = (char >= 48 && char <= 57);
      if (!isAlpha && !isNum) {
        throw new Error('Stock symbol must contain only letters and numbers.');
      }
    }
    return { symbol: cleanSymbol };
  }

  throw new Error(`Unknown tool requested: ${toolName}`);
}

async function fetchPageText(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AtkynBot/1.0)' },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok || !resp.headers.get('content-type')?.includes('text/html')) {
      return '';
    }
    const html = await resp.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
  } catch {
    return '';
  }
}

async function executeSearXNG(searchQuery, searxngUrl) {
  try {
    const searxResp = await fetch(
      `${searxngUrl}/search?q=${encodeURIComponent(searchQuery)}&format=json&categories=general&language=en`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) }
    );

    if (!searxResp.ok) return [];
    const data = await searxResp.json();
    const raw = (data.results || []).slice(0, 5);

    const enriched = await Promise.all(
      raw.map(async (r) => {
        let content = r.content || 'No snippet available.';
        const pageText = await fetchPageText(r.url);
        if (pageText && pageText.length > 100) {
          content = pageText;
        }
        return {
          title: r.title || 'Untitled',
          url: r.url || '#',
          snippet: content,
        };
      })
    );
    return enriched.filter(r => r.url !== '#');
  } catch {
    return [];
  }
}

async function executeStockData(symbol, finnhubApiKey) {
  const base = 'https://finnhub.io/api/v1';
  const token = `token=${finnhubApiKey}`;

  try {
    const [quoteResp, profileResp, metricResp] = await Promise.all([
      fetch(`${base}/quote?symbol=${symbol}&${token}`, { signal: AbortSignal.timeout(4000) }),
      fetch(`${base}/stock/profile2?symbol=${symbol}&${token}`, { signal: AbortSignal.timeout(4000) }),
      fetch(`${base}/stock/metric?symbol=${symbol}&metric=all&${token}`, { signal: AbortSignal.timeout(4000) }),
    ]);

    if (!quoteResp.ok) throw new Error('Quote API failed');

    const q = await quoteResp.json();
    const p = (await profileResp.json()) || {};
    const m = ((await metricResp.json()) || {}).metric || {};

    if (q.c === 0 && q.d === 0 && q.dp === 0) {
      throw new Error(`Symbol '${symbol}' not found or market is closed with no data.`);
    }

    const marketCapM = p.marketCapitalization || 0;
    let marketCapStr = 'N/A';
    if (marketCapM >= 1_000_000) marketCapStr = `$${(marketCapM / 1_000_000).toFixed(2)}T`;
    else if (marketCapM >= 1_000) marketCapStr = `$${(marketCapM / 1_000).toFixed(2)}B`;
    else if (marketCapM > 0) marketCapStr = `$${marketCapM.toFixed(2)}M`;

    return {
      ticker: symbol,
      name: p.name || symbol,
      exchange: p.exchange || 'Unknown',
      logo: p.logo || '',
      currency: p.currency || 'USD',
      marketCap: marketCapStr,
      price: q.c ?? 0,
      change: q.d ?? 0,
      changePct: q.dp ?? 0,
      open: q.o ?? 0,
      high: q.h ?? 0,
      low: q.l ?? 0,
      prevClose: q.pc ?? 0,
      pe: m['peNormalizedAnnual'] ?? m['peTTM'] ?? null,
      eps: m['epsNormalizedAnnual'] ?? m['epsTTM'] ?? null,
      series: [],
    };
  } catch (err) {
    return { error: true, message: `Failed to fetch data for ${symbol}: ${err.message}` };
  }
}

function formatSearchResultsForLLM(results) {
  if (results.length === 0) return 'No search results found.';
  return results.map((r, i) =>
    `--- SOURCE ${i + 1} ---\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.snippet}`
  ).join('\n\n');
}

function formatStockDataForLLM(data) {
  if (data.error) return `Error: ${data.message}`;
  return `Stock: ${data.name} (${data.ticker})\nExchange: ${data.exchange}\nPrice: ${data.currency === 'USD' ? '$' : ''}${data.price}\nChange: ${data.change >= 0 ? '+' : ''}${data.change} (${data.changePct}%)\nMarket Cap: ${data.marketCap}\nOpen: ${data.open} | High: ${data.high} | Low: ${data.low} | Prev Close: ${data.prevClose}`;
}

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

export async function onRequestPost(context) {
  const { request, env } = context;
  const requestId = crypto.randomUUID();

  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: 'Empty query' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: query },
  ];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  (async () => {
    try {
      console.log(`[${requestId}] Calling Ministral for routing...`);

      const call1Resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'ministral-14b-2512',
          messages: baseMessages,
          tools: TOOLS,
          tool_choice: 'auto',
          stream: false,
          max_tokens: 500,
          temperature: 0.1,
        }),
      });

      if (!call1Resp.ok) {
        throw new Error(`Mistral API Error: ${call1Resp.status} ${await call1Resp.text()}`);
      }

      const call1Data = await call1Resp.json();
      const assistantMessage = call1Data.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        console.log(`[${requestId}] No tool call. Streaming direct answer.`);
        const directAnswer = assistantMessage?.content ?? 'I could not process that request.';
        const chunks = directAnswer.match(/.{1,64}/gs) || [''];
        for (const chunk of chunks) {
          await writer.write(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })}\n\n`));
        }
        await writer.write(enc.encode(`data: [DONE]\n\n`));
        await writer.close();
        return;
      }

      const toolCall = toolCalls[0];
      const toolCallId = toolCall.id;
      const functionName = toolCall.function?.name;

      console.log(`[${requestId}] Executing tool: ${functionName}`);

      let functionArgs = {};
      try {
        functionArgs = JSON.parse(toolCall.function?.arguments || '{}');
      } catch {
        throw new Error('LLM returned invalid JSON for tool arguments.');
      }

      let validatedArgs;
      try {
        validatedArgs = validateToolArgs(functionName, functionArgs);
      } catch (err) {
        console.error(`[${requestId}] Validation failed:`, err.message);
        const errorMsg = `Tool execution failed: ${err.message}. Please ask the user for clarification or try a different approach.`;
        await writer.write(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMsg }, finish_reason: 'stop' }] })}\n\n`));
        await writer.write(enc.encode(`data: [DONE]\n\n`));
        await writer.close();
        return;
      }

      let toolResultContent = '';
      let frontendEvent = null;
      let frontendData = null;

      if (functionName === 'web_search') {
        const results = await executeSearXNG(validatedArgs.query, env.SEARXNG_URL);
        toolResultContent = formatSearchResultsForLLM(results);
        if (results.length > 0) {
          frontendEvent = 'results';
          frontendData = results;
        }
      } else if (functionName === 'stock_data') {
        const data = await executeStockData(validatedArgs.symbol, env.FINNHUB_API_KEY);
        toolResultContent = formatStockDataForLLM(data);
        if (!data.error) {
          frontendEvent = 'stock';
          frontendData = data;
        }
      }

      if (frontendEvent && frontendData) {
        await writer.write(enc.encode(`event: ${frontendEvent}\ndata: ${JSON.stringify(frontendData)}\n\n`));
      }

      console.log(`[${requestId}] Calling Ministral for final answer...`);

      const call2Resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'ministral-14b-2512',
          messages: [
            ...baseMessages,
            {
              role: 'assistant',
              content: assistantMessage.content ?? null,
              tool_calls: toolCalls,
            },
            {
              role: 'tool',
              content: toolResultContent,
              tool_call_id: toolCallId,
            },
          ],
          stream: true,
          max_tokens: 2048,
          temperature: 0.6,
        }),
      });

      if (!call2Resp.ok) {
        throw new Error(`Final generation API Error: ${call2Resp.status} ${await call2Resp.text()}`);
      }

      const reader = call2Resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }

      console.log(`[${requestId}] Request completed successfully.`);
      await writer.close();

    } catch (err) {
      console.error(`[${requestId}] Fatal Error:`, err);
      try {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: 'An internal error occurred. Please try again.' })}\n\n`));
        await writer.write(enc.encode(`data: [DONE]\n\n`));
        await writer.close();
      } catch (_) {}
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
            }
