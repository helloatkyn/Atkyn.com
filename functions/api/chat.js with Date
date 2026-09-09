import { SYSTEM_PROMPT } from './systemPrompt.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const MISTRAL_MODEL    = 'ministral-14b-2512';
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const FINNHUB_BASE     = 'https://finnhub.io/api/v1';
const SERPER_ENDPOINT  = 'https://google.serper.dev/search';
const WORLDTIME_ENDPOINT = 'https://worldtimeapi.org/api/timezone';

// ─── Date/Time Tool Executor ───────────────────────────────────────────────────

/**
 * Fetches current date/time from WorldTimeAPI for the given IANA timezone.
 * Falls back to the Cloudflare Workers runtime Date if the API is unavailable.
 */
async function executeDatetime(timezone = 'UTC') {
  const safeTimezone = /^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/.test(timezone) ? timezone : 'UTC';

  try {
    const resp = await fetch(`${WORLDTIME_ENDPOINT}/${safeTimezone}`, {
      signal: AbortSignal.timeout(4000),
    });

    if (!resp.ok) throw new Error(`WorldTimeAPI ${resp.status}`);

    const d = await resp.json();
    const dt = new Date(d.datetime);
    const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    return {
      source:      'worldtimeapi',
      reliable:    true,
      uncertain:   false,
      timezone:    d.timezone,
      utcOffset:   d.utc_offset,
      unixTs:      d.unixtime,
      iso8601:     d.datetime,
      date:        d.datetime.slice(0, 10),
      time:        d.datetime.slice(11, 19),
      year:        dt.getFullYear(),
      month:       MONTHS[dt.getMonth()],
      day:         dt.getDate(),
      dayOfWeek:   DAYS[d.day_of_week],
    };
  } catch (apiErr) {
    try {
      const now = new Date();
      const iso = now.toISOString();
      return {
        source:    'runtime-fallback',
        reliable:  true,
        uncertain: true, 
        timezone:  'UTC',
        utcOffset: '+00:00',
        unixTs:    Math.floor(now.getTime() / 1000),
        iso8601:   iso,
        date:      iso.slice(0, 10),
        time:      iso.slice(11, 19),
        year:      now.getUTCFullYear(),
        month:     ['January','February','March','April','May','June','July','August','September','October','November','December'][now.getUTCMonth()],
        day:       now.getUTCDate(),
        dayOfWeek: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getUTCDay()],
        error:     apiErr.message,
      };
    } catch {
      return {
        source:   'none',
        reliable: false,
        uncertain: true,
        error:    'Date/Time API unavailable and runtime clock inaccessible.',
      };
    }
  }
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for real-time facts, recent events, or current metrics. Use this when asked for "latest", "newest", or factual data.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Concise search query.' },
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
      description: 'Fetch real-time stock price and market cap.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker symbol.' },
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
      description: 'CRITICAL: You MUST use this tool whenever the user asks for the current date, time, year, month, or day. Your internal weights do NOT know the date. Always execute this tool first for time-aware questions.',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'IANA timezone string (e.g., "Asia/Kolkata"). Leave empty to use user\'s default.',
          },
        },
        additionalProperties: false,
      },
    },
  },
];

// ─── Validation & LLM Formatters ──────────────────────────────────────────────

function validateToolArgs(toolName, rawArgs) {
  if (toolName === 'web_search') return { query: rawArgs.query?.trim() };
  if (toolName === 'stock_data') return { symbol: rawArgs.symbol?.trim().toUpperCase() };
  if (toolName === 'datetime_tool') return { timezone: rawArgs.timezone?.trim() || null };
  return {};
}

function formatDatetimeForLLM(dt) {
  if (!dt.reliable) {
    return 'CRITICAL ERROR: Datetime retrieval completely failed. DO NOT guess the date. Tell the user: "I couldn\'t reliably determine the current date right now."';
  }

  const fallbackWarning = dt.uncertain 
    ? '\nWARNING: The timezone API failed. The time below is the server\'s UTC time. You MUST inform the user that their local time is unavailable and you are falling back to UTC.' 
    : '';

  return `[AUTHORITATIVE TOOL RESULT - DO NOT OVERRIDE]${fallbackWarning}
Date: ${dt.date}
Time: ${dt.time}
Day: ${dt.dayOfWeek}
Month: ${dt.month}
Year: ${dt.year}
Timezone: ${dt.timezone} (UTC${dt.utcOffset})

STRICT INSTRUCTION: You MUST construct your answer using the exact Date, Year, and Time provided above. Do not use your own memory. Do not hallucinate external context.`;
}

// ─── External Executors (Abridged for space) ──────────────────────────────────
// Note: Keep your existing executeSerper and executeStockData functions here.
async function executeSerper(query, key) { /* ... existing ... */ return []; }
async function executeStockData(sym, key) { /* ... existing ... */ return {}; }
function formatSearchResultsForLLM(res) { return "Search Output"; }
function formatStockDataForLLM(res) { return "Stock Output"; }

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
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const userTimezone = (typeof timezone === 'string' && timezone.trim()) ? timezone.trim() : 'UTC';
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
      // ── Call 1: Tool Semantic Routing ──
      console.log(`[${requestId}] Call 1: tool routing`);
      
      const call1Resp = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.MISTRAL_API_KEY}` },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          messages: baseMessages,
          tools: TOOLS,
          tool_choice: 'auto',
          stream: false,
          max_tokens: 1000,
          temperature: 0.1,
        }),
      });

      if (!call1Resp.ok) throw new Error(`Mistral Call 1 error: ${call1Resp.status}`);
      const call1Data = await call1Resp.json();
      const assistantMsg = call1Data.choices?.[0]?.message;
      const toolCalls = assistantMsg?.tool_calls;

      // No tools needed -> stream direct
      if (!toolCalls || toolCalls.length === 0) {
        const answer = assistantMsg?.content ?? 'I could not process that request.';
        for (const chunk of answer.split(/(?<=\s)/)) await writer.write(enc.encode(sseChunk(chunk)));
        await writer.write(enc.encode(sseChunk('', 'stop')));
        await writer.write(enc.encode(SSE_DONE));
        await writer.close();
        return;
      }

      const toolCall = toolCalls[0];
      const toolCallId = toolCall.id;
      const functionName = toolCall.function?.name;
      const rawArgs = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
      const validatedArgs = validateToolArgs(functionName, rawArgs);

      let toolResultContent = '';

      // ── Tool Execution ──
      if (functionName === 'datetime_tool') {
        const targetTz = validatedArgs.timezone || userTimezone;
        const dtResult = await executeDatetime(targetTz);
        
        // DIRECTIVE 3: EXACT DEVELOPMENT LOGGING
        console.log(JSON.stringify({
          event: "DATETIME_TOOL_RESULT",
          source: dtResult.source,
          reliable: dtResult.reliable,
          uncertain: dtResult.uncertain,
          timezone: dtResult.timezone,
          utcOffset: dtResult.utcOffset,
          date: dtResult.date,
          time: dtResult.time,
          year: dtResult.year,
          month: dtResult.month,
          day: dtResult.day,
          dayOfWeek: dtResult.dayOfWeek,
          iso8601: dtResult.iso8601,
          unixTs: dtResult.unixTs
        }));

        toolResultContent = formatDatetimeForLLM(dtResult);
      } 
      else if (functionName === 'web_search') { /* ... */ } 
      else if (functionName === 'stock_data') { /* ... */ }

      // ── Call 2: Final Streamed Answer ──
      console.log(`[${requestId}] Call 2: final answer generating`);

      const call2Messages = [
        ...baseMessages,
        { role: 'assistant', content: assistantMsg.content ?? null, tool_calls: toolCalls },
        { role: 'tool', content: toolResultContent, tool_call_id: toolCallId }
      ];

      const call2Resp = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.MISTRAL_API_KEY}` },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          messages: call2Messages,
          stream: true,
          max_tokens: 4000,
          temperature: 0.2, // Lower temperature to strictly adhere to formatting
        }),
      });

      const reader = call2Resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
      
    } catch (err) {
      console.error(`[${requestId}] Fatal: ${err.message}`);
      try {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: 'An internal error occurred.' })}\n\n`));
        await writer.write(enc.encode(SSE_DONE));
        await writer.close();
      } catch {}
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
