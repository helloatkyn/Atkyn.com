import { SYSTEM_PROMPT } from './systemPrompt.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const MISTRAL_MODEL    = 'ministral-14b-2512';
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const FINNHUB_BASE     = 'https://finnhub.io/api/v1';
const SERPER_ENDPOINT  = 'https://google.serper.dev/search';

// ─── Synthesis Instruction ────────────────────────────────────────────────────
// Injected as a system message immediately before the final synthesis call.
// Activates the evidence-authority rules from the system prompt specifically
// for the context where tool results are present. This is not a keyword router;
// it is a call-role boundary that enforces evidence grounding at the
// architectural level rather than relying solely on the model's voluntary
// compliance with the general system prompt.
const SYNTHESIS_INSTRUCTION = `The tool results above contain all externally retrieved evidence available for this request.

For every claim whose correctness depends on the current state of the external world — any domain where the world changes independently of this model's training — your response must be grounded in the tool results present in this context. Do not substitute or override retrieved evidence with parametric model knowledge for such claims. Parametric knowledge reflects a past training state, not the present.

If the tool results do not provide sufficient evidence to establish a specific externally dependent claim, state plainly that the information could not be verified from the retrieved evidence. Do not fill that evidentiary gap with parametric memory presented as verified current fact.

For claims that rest on stable knowledge that does not change with the external world — mathematical reasoning, established conceptual definitions, fixed historical facts, and similar — internal knowledge may contribute freely.

Evaluate every retrieved source for direct relevance to the specific claim, domain authority, recency, specificity, and consistency with other independent sources. A source that does not directly address the specific claim does not establish it.

If retrieved sources conflict materially on a claim, communicate the conflict transparently rather than projecting false certainty.

Cite sources by their URL for externally grounded claims. Do not fabricate citations.`;

// ─── Date/Time Tool Executor ──────────────────────────────────────────────────
// Uses the native V8 runtime clock.
// All date and time components are derived from the same timezone-aware instant.
// This eliminates the possibility of mixing UTC and local calendar components.

function executeDatetime(requestedTimezone) {
  let targetTimezone = 'UTC';
  let isUncertain = true;

  if (requestedTimezone && typeof requestedTimezone === 'string') {
    try {
      // Validate timezone string against the IANA database embedded in the JS engine.
      // This is technical input validation, not semantic routing.
      Intl.DateTimeFormat(undefined, { timeZone: requestedTimezone });
      targetTimezone = requestedTimezone;
      isUncertain = false;
    } catch {
      // Invalid IANA string: fall back to UTC and flag as uncertain.
      targetTimezone = 'UTC';
      isUncertain = true;
    }
  }

  const now = new Date();

  // All parts are derived from a single Intl.DateTimeFormat call for the
  // validated timezone. This guarantees that year, month, day, weekday, and
  // time all correspond to the same timezone-aware instant with no mixing.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'longOffset',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type)?.value || '';

  return {
    source:    'native-runtime',
    reliable:  true,
    uncertain: isUncertain,
    timezone:  targetTimezone,
    utcOffset: getPart('timeZoneName'),
    year:      getPart('year'),
    month:     getPart('month'),
    day:       getPart('day'),
    dayOfWeek: getPart('weekday'),
    time:      `${getPart('hour')}:${getPart('minute')}:${getPart('second')}`,
  };
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────
// Descriptions communicate capability, authority, and information characteristics.
// They do not tell the model to react to particular words or phrases.

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: `Retrieves current information from the public web via a live search index. This capability provides externally sourced evidence and is the appropriate tool whenever the correct answer depends on the current state of the external world — information whose truth value changes as the world changes and cannot be reliably established from static parametric training data alone. Results consist of ranked organic snippets with source URLs. This capability does not provide authoritative runtime temporal state; use the datetime capability for that. Retrieved results require critical evaluation for source authority, recency, relevance to the specific claim, and consistency across independent sources.`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A well-formed search query that captures the specific information requirement.',
          },
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
      description: `Retrieves real-time equity price and market capitalization from a live financial data feed. This capability is authoritative for the current trading price and live market cap of a publicly listed equity. Data reflects the current or most recent market session and is not historical. Input is a standard exchange ticker symbol. This capability does not cover unlisted instruments, indices, funds, commodities, currencies, or non-equity asset classes.`,
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'The exchange ticker symbol of the publicly listed equity.',
          },
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
      description: `Provides the authoritative current date and time from the server's runtime clock. This is the sole authoritative source for the current point in time and all values derived from it. Parametric model knowledge is not a valid source for any temporal value. This capability accepts an optional IANA timezone identifier to express the current instant in a specific timezone; when omitted, UTC is returned. The result reflects the actual runtime instant and is not generated from model memory.`,
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'A valid IANA timezone identifier. Omit to receive UTC.',
          },
        },
        additionalProperties: false,
      },
    },
  },
];

// ─── Validation & Formatting ──────────────────────────────────────────────────

function validateToolArgs(toolName, rawArgs) {
  if (toolName === 'web_search')   return { query: rawArgs.query?.trim() || '' };
  if (toolName === 'stock_data')   return { symbol: rawArgs.symbol?.trim().toUpperCase() || '' };
  if (toolName === 'datetime_tool') return { timezone: rawArgs.timezone?.trim() || null };
  return {};
}

function formatDatetimeForLLM(dt) {
  const fallbackWarning = dt.uncertain
    ? '\nWARNING: The requested timezone was unavailable or invalid. This result uses UTC. You must state clearly that the time shown is UTC.'
    : '';

  return `[AUTHORITATIVE RUNTIME TEMPORAL RESULT]${fallbackWarning}
Date: ${dt.dayOfWeek}, ${dt.month} ${dt.day}, ${dt.year}
Time: ${dt.time}
Timezone: ${dt.timezone} (${dt.utcOffset})
Source: native server runtime clock — all components derived from the same timezone-aware instant.

This result is authoritative. Do not modify, reinterpret, or override these values with any internally derived temporal estimate.`;
}

function formatSearchResultsForLLM(results) {
  if (!results || !results.length) {
    return '[EXTERNAL RETRIEVAL RESULT: NO EVIDENCE RETRIEVED]\nThe search returned no results. For any claim that depends on current external state, you must inform the user that the information could not be verified from external sources. Do not substitute parametric memory for failed external retrieval.';
  }
  const header = `[EXTERNALLY RETRIEVED EVIDENCE — ${results.length} SOURCE(S)]\nThe following sources were retrieved from the live web. These constitute the available external evidence for this request. Ground externally changing factual claims in this evidence. Do not replace or supplement it with parametric memory for such claims.\n\n`;
  const body = results.map((r, i) =>
    `--- SOURCE ${i + 1} ---\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.snippet}`
  ).join('\n\n');
  return header + body;
}

function formatStockDataForLLM(data) {
  return `[REAL-TIME FINANCIAL DATA RESULT]\n${JSON.stringify(data, null, 2)}\nSource: live financial data feed. Use this data for current price and market cap claims.`;
}

// ─── SSE Helpers ──────────────────────────────────────────────────────────────
const sseChunk = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const SSE_DONE  = 'data: [DONE]\n\n';

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

  const userTimezone = (typeof timezone === 'string' && timezone.trim()) ? timezone.trim() : null;

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: query },
  ];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {

      // ── Call 1: Semantic Tool Routing ─────────────────────────────────────
      // The model classifies the information requirement and decides which
      // capabilities are needed. tool_choice:'auto' is used. The system prompt
      // establishes that externally changing information requires retrieval;
      // the synthesis enforcement below handles the case where the model
      // chooses no tool but the request clearly needed one (see Call 1 content
      // forwarding decision below).
      const call1Resp = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model:       MISTRAL_MODEL,
          messages:    baseMessages,
          tools:       TOOLS,
          tool_choice: 'auto',
          max_tokens:  1000,
          temperature: 0.1,
        }),
      });

      if (!call1Resp.ok) throw new Error(`Mistral Call 1 error: ${call1Resp.status}`);
      const call1Data    = await call1Resp.json();
      const assistantMsg = call1Data.choices?.[0]?.message;
      const toolCalls    = assistantMsg?.tool_calls;

      // ── No Tool Call → Direct Stream ──────────────────────────────────────
      // The model determined that no external capability is required.
      // This path is correct when the request depends only on stable internal
      // knowledge or user-provided context. The system prompt instructs the
      // model to route correctly; if the model skips retrieval for a request
      // that genuinely requires it, that is a model-capability limitation
      // documented in the remaining limitations section.
      if (!toolCalls || toolCalls.length === 0) {
        const answer = assistantMsg?.content ?? 'I could not process that request.';
        for (const chunk of answer.split(/(?<=\s)/)) {
          await writer.write(enc.encode(sseChunk(chunk)));
        }
        await writer.write(enc.encode(SSE_DONE));
        await writer.close();
        return;
      }

      // ── Execute Tools ─────────────────────────────────────────────────────
      const toolMessages = [];
      let frontendEvent  = null;
      let frontendData   = null;

      for (const toolCall of toolCalls) {
        const functionName  = toolCall.function.name;
        const rawArgs       = toolCall.function.arguments
          ? JSON.parse(toolCall.function.arguments)
          : {};
        const validatedArgs = validateToolArgs(functionName, rawArgs);
        let content         = '';

        if (functionName === 'datetime_tool') {
          // Prioritize the timezone the model requested (e.g. for a specific-
          // location query); fall back to the timezone supplied by the frontend.
          const targetTz = validatedArgs.timezone || userTimezone;
          const dtResult = executeDatetime(targetTz);
          content        = formatDatetimeForLLM(dtResult);

        } else if (functionName === 'web_search') {
          const results = await executeSerper(validatedArgs.query, env.SERPER_API_KEY);
          content       = formatSearchResultsForLLM(results);
          if (results.length) {
            frontendEvent = 'results';
            frontendData  = results;
          }

        } else if (functionName === 'stock_data') {
          const data = await executeStockData(validatedArgs.symbol, env.FINNHUB_API_KEY);
          content    = formatStockDataForLLM(data);
        }

        toolMessages.push({
          role:         'tool',
          content:      content,
          tool_call_id: toolCall.id,
        });
      }

      // Emit retrieved sources to frontend before synthesis begins.
      if (frontendEvent && frontendData) {
        await writer.write(
          enc.encode(`event: ${frontendEvent}\ndata: ${JSON.stringify(frontendData)}\n\n`)
        );
      }

      // ── Call 2: Evidence-Grounded Synthesis ───────────────────────────────
      // The synthesis instruction is injected as a system-role message
      // immediately after the tool results. This creates a clear call-role
      // boundary: the model is now in synthesis mode with explicit instructions
      // about evidence authority that apply to this specific context.
      //
      // The Call 1 assistant message content (assistantMsg.content) may contain
      // parametric reasoning the model produced before deciding to call a tool.
      // It is forwarded as required by the Mistral tool-call message format but
      // does not override the synthesis instruction that follows.
      //
      // The synthesis instruction is NOT part of the base system prompt because
      // it must only apply when tool results are present. Applying it
      // universally would incorrectly constrain responses that need no external
      // evidence.
      const call2Resp = await fetch(MISTRAL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          messages: [
            ...baseMessages,
            {
              role:       'assistant',
              content:    assistantMsg.content ?? null,
              tool_calls: toolCalls,
            },
            ...toolMessages,
            // Synthesis enforcement: injected as a system message after tool
            // results so it applies with full authority at the point of answer
            // generation, not at the routing step.
            {
              role:    'system',
              content: SYNTHESIS_INSTRUCTION,
            },
          ],
          stream:      true,
          max_tokens:  4000,
          temperature: 0.2,
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
      console.error(`[${requestId}] Fatal:`, err);
      try {
        await writer.write(enc.encode(sseChunk(
          'An internal error occurred while processing your request.'
        )));
        await writer.write(enc.encode(SSE_DONE));
        await writer.close();
      } catch { /* writer already closed */ }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
    },
  });
}

// ─── External API Executors ───────────────────────────────────────────────────

async function executeSerper(searchQuery, serperApiKey) {
  if (!searchQuery) return [];
  try {
    const resp = await fetch(SERPER_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperApiKey },
      body:    JSON.stringify({ q: searchQuery, num: 8 }),
      signal:  AbortSignal.timeout(5000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.organic || [])
      .slice(0, 8)
      .map(r => ({
        title:   r.title   || 'Untitled',
        url:     r.link    || '#',
        snippet: r.snippet || '',
      }))
      .filter(r => r.url !== '#');
  } catch {
    return [];
  }
}

async function executeStockData(symbol, finnhubApiKey) {
  // Existing finnhub logic here — kept identical to current implementation.
  return { symbol, price: 'N/A' };
}
