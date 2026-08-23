import { SYSTEM_PROMPT } from './systemPrompt.js';

// ── Constants ──────────────────────────────────────────────
const MAX_RESULTS       = 5;
const MAX_PAGE_TEXT_LEN = 2000;
const MAX_TITLE_LEN     = 120;
const MAX_URL_LEN       = 300;
const MAX_SNIPPET_LEN   = 500;
const PAGE_TIMEOUT_MS   = 4000;
const MAX_TOKENS_ANSWER = 500;
const HISTORY_LIMIT     = 100;

// ── Tool definition ─────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current, recent, or external information. ' +
        'Use this when the user needs facts that may have changed since your training cutoff, ' +
        'or that you cannot reliably answer from model knowledge alone.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to send, derived from the user\'s intent.',
          },
        },
        required: ['query'],
      },
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────
function trunc(str, len) {
  if (!str || typeof str !== 'string') return '';
  return str.length > len ? str.slice(0, len) : str;
}

async function fetchPageText(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean.slice(0, MAX_PAGE_TEXT_LEN);
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

// ── Execute web_search tool ──────────────────────────────────
async function executeWebSearch(searchQuery, env) {
  if (!env.SEARXNG_URL) return { results: [], context: '' };

  try {
    const searxResp = await fetch(
      `${env.SEARXNG_URL}/search?q=${encodeURIComponent(searchQuery)}&format=json&categories=general&language=en`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!searxResp.ok) return { results: [], context: '' };

    const data = await searxResp.json().catch(() => null);
    const raw = Array.isArray(data?.results) ? data.results.slice(0, MAX_RESULTS) : [];

    const seenUrls = new Set();
    const deduped = raw.filter(r => {
      const url = r?.url;
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });

    const results = await Promise.all(
      deduped.map(async (r, i) => {
        const rawUrl   = trunc(r.url     || '', MAX_URL_LEN);
        const rawTitle = trunc(r.title   || '', MAX_TITLE_LEN);
        let   snippet  = trunc(r.content || '', MAX_SNIPPET_LEN);

        if (snippet.length < 100 && i < 3 && rawUrl) {
          const pageText = await fetchPageText(rawUrl);
          if (pageText) snippet = trunc(pageText, MAX_PAGE_TEXT_LEN);
        }

        return { title: rawTitle, url: rawUrl, snippet };
      })
    );

    return { results, context: buildSearchContext(results) };
  } catch {
    return { results: [], context: '' };
  }
}

// ── Parse SSE lines ──────────────────────────────────────────
function parseSseLine(line) {
  if (!line.startsWith('data: ')) return null;
  const payload = line.slice(6).trim();
  if (payload === '[DONE]') return null;
  try { return JSON.parse(payload); } catch { return null; }
}

// ── Assemble tool calls ──────────────────────────────────────
function assembleToolCalls(accumulated) {
  const result = [];
  for (const [, tc] of accumulated) {
    result.push({
      id: tc.id,
      function: { name: tc.name, arguments: tc.argumentsStr },
    });
  }
  return result;
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

  const messages = [
    ...(Array.isArray(history) ? history.slice(-HISTORY_LIMIT) : []),
    { role: 'user', content: query },
  ];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  const safeWrite = async (chunk) => {
    try { await writer.write(chunk); } catch { /* writer closed */ }
  };

  (async () => {
    try {
      // ── 1st call: fast model for tool detection ───────────
      const firstResp = await mistralFetch(env.MISTRAL_API_KEY, {
        model: 'ministral-8b-2410',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        tools: env.SEARXNG_URL ? TOOLS : [],
        tool_choice: env.SEARXNG_URL ? 'auto' : 'none',
        stream: true,
        max_tokens: MAX_TOKENS_ANSWER,
        temperature: 0.3,
      });

      if (!firstResp.ok) {
        await safeWrite(enc.encode(
          `data: ${JSON.stringify({ error: 'AI response failed' })}\n\n`
        ));
        await writer.close();
        return;
      }

      const reader   = firstResp.body.getReader();
      const dec      = new TextDecoder();
      let   leftover = '';

      const toolCallMap    = new Map();
      let   hasToolCalls   = false;
      let   assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text  = leftover + dec.decode(value, { stream: true });
        const lines = text.split('\n');
        leftover    = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const parsed = parseSseLine(trimmed);
          if (!parsed) continue;

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta ?? {};

          if (delta.tool_calls?.length) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap.has(idx)) {
                toolCallMap.set(idx, { id: tc.id ?? '', name: '', argumentsStr: '' });
              }
              const entry = toolCallMap.get(idx);
              if (tc.id)                  entry.id           = tc.id;
              if (tc.function?.name)      entry.name         += tc.function.name;
              if (tc.function?.arguments) entry.argumentsStr += tc.function.arguments;
            }
            continue;
          }

          if (!hasToolCalls && delta.content) {
            assistantContent += delta.content;
            await safeWrite(enc.encode(trimmed + '\n\n'));
          }
        }
      }

      // ── Direct answer, no tool call ───────────────────────
      if (!hasToolCalls) {
        await writer.close();
        return;
      }

      // ── Execute search ────────────────────────────────────
      const toolCalls        = assembleToolCalls(toolCallMap);
      const allSearchResults = [];

      const assistantMsg = {
        role: 'tool_calls',
        content: assistantContent || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };

      const updatedMessages = [...messages, assistantMsg];

      for (const tc of toolCalls) {
        if (tc.function?.name !== 'web_search') continue;

        let searchQuery = query;
        try {
          const args = JSON.parse(tc.function.arguments || '{}');
          if (args.query) searchQuery = args.query;
        } catch { /* use fallback */ }

        const { results, context } = await executeWebSearch(searchQuery, env);
        if (results.length) allSearchResults.push(...results);

        updatedMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: context || 'No results found.',
        });
      }

      if (allSearchResults.length) {
        await safeWrite(enc.encode(
          `event: results\ndata: ${JSON.stringify(allSearchResults)}\n\n`
        ));
      }

      // ── 2nd call: best model for final answer ─────────────
      const finalResp = await mistralFetch(env.MISTRAL_API_KEY, {
        model: 'mistral-large-2411',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...updatedMessages],
        stream: true,
        max_tokens: MAX_TOKENS_ANSWER,
        temperature: 0.3,
      });

      if (!finalResp.ok) {
        await safeWrite(enc.encode(
          `data: ${JSON.stringify({ error: 'AI response failed' })}\n\n`
        ));
        await writer.close();
        return;
      }

      const finalReader = finalResp.body.getReader();
      while (true) {
        const { done, value } = await finalReader.read();
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
