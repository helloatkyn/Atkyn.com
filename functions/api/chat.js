import { SYSTEM_PROMPT } from './systemPrompt.js';

async function fetchPageText(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean.slice(0, 5000);
  } catch {
    return '';
  }
}

async function executeSearXNG(searchQuery, searxngUrl) {
  const searxResp = await fetch(
    `${searxngUrl}/search?q=${encodeURIComponent(searchQuery)}&format=json&categories=general&language=en`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!searxResp.ok) return [];

  const data = await searxResp.json();
  const raw = (data.results || []).slice(0, 6);

  const enriched = await Promise.all(
    raw.map(async (r, i) => {
      let content = r.content || '';
      if (i < 5) {
        const pageText = await fetchPageText(r.url);
        if (pageText) content = pageText;
      }
      return {
        title:   r.title || '',
        url:     r.url   || '',
        snippet: content,
      };
    })
  );

  return enriched;
}

async function executeStockData(symbol, finnhubApiKey) {
  const base  = 'https://finnhub.io/api/v1';
  const token = `token=${finnhubApiKey}`;

  const [quoteResp, profileResp] = await Promise.all([
    fetch(`${base}/quote?symbol=${symbol}&${token}`),
    fetch(`${base}/stock/profile2?symbol=${symbol}&${token}`),
  ]);

  const q = await quoteResp.json();
  const p = await profileResp.json();

  return {
    ticker:    symbol,
    name:      p.name     || symbol,
    exchange:  p.exchange || '',
    logo:      p.logo     || '',
    currency:  p.currency || 'USD',
    price:     q.c  ?? 0,
    change:    q.d  ?? 0,
    changePct: q.dp ?? 0,
    open:      q.o  ?? 0,
    high:      q.h  ?? 0,
    low:       q.l  ?? 0,
    prevClose: q.pc ?? 0,
    series:    [],
  };
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current, external, or specialized information. ' +
        'Call this tool when the user query requires up-to-date facts, recent events, ' +
        'real-time data, specific URLs, or any information that may not be in the model\'s training data. ' +
        'Do NOT call this tool when the query can be answered directly from existing knowledge ' +
        '(e.g. general explanations, reasoning tasks, creative writing, math, or coding questions).',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to look up on the web.',
          },
        },
        required: ['query'],
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
          symbol: {
            type: 'string',
            description: 'Stock ticker symbol, e.g. AAPL, TSLA, GOOGL',
          },
        },
        required: ['symbol'],
      },
    },
  },
];

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

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(Array.isArray(history) ? history.slice(-100) : []),
    { role: 'user', content: query },
  ];

  // Call #1: Tool routing — model decides web_search, stock_data, or direct answer
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
      max_tokens: 2048,
      temperature: 0.6,
    }),
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      if (!call1Resp.ok) {
        const errText = await call1Resp.text();
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: errText })}\n\n`));
        await writer.close();
        return;
      }

      const call1Data        = await call1Resp.json();
      const assistantMessage = call1Data.choices?.[0]?.message;
      const toolCalls        = assistantMessage?.tool_calls;

      // NO TOOL: model answered directly — stream it out
      if (!toolCalls || toolCalls.length === 0) {
        const directAnswer = assistantMessage?.content ?? '';
        const chunks = directAnswer.match(/.{1,64}/gs) || [''];
        for (const chunk of chunks) {
          const ssePayload = {
            choices: [{ delta: { content: chunk }, finish_reason: null }],
          };
          await writer.write(enc.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
        }
        await writer.write(enc.encode(`data: [DONE]\n\n`));
        await writer.close();
        return;
      }

      // TOOL CALL: execute the right tool
      const toolCall     = toolCalls[0];
      const toolCallId   = toolCall.id;
      const functionName = toolCall.function?.name;

      let functionArgs = {};
      try {
        functionArgs = JSON.parse(toolCall.function?.arguments || '{}');
      } catch (_) {}

      let searchResults     = [];
      let stockData         = null;
      let toolResultContent = 'No results found.';

      if (functionName === 'web_search') {
        if (functionArgs.query) {
          try {
            searchResults = await executeSearXNG(functionArgs.query, env.SEARXNG_URL);
            if (searchResults.length > 0) {
              toolResultContent = searchResults
                .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
                .join('\n\n');
            }
          } catch (_) {}
        }
      } else if (functionName === 'stock_data') {
        if (functionArgs.symbol) {
          try {
            stockData = await executeStockData(functionArgs.symbol, env.FINNHUB_API_KEY);
            toolResultContent = JSON.stringify(stockData);
          } catch (_) {}
        }
      }

      // Emit to frontend before answer stream
      if (searchResults.length > 0) {
        await writer.write(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }
      if (stockData) {
        await writer.write(enc.encode(`event: stock\ndata: ${JSON.stringify(stockData)}\n\n`));
      }

      // Call #2: Final streamed answer with tool result
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
              name: functionName,
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
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: await call2Resp.text() })}\n\n`));
        await writer.close();
        return;
      }

      const reader = call2Resp.body.getReader();
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
