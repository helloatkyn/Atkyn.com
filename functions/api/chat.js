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

const WEB_SEARCH_TOOL = [
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
];

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'qwen/qwen3-14b:free'; // ✅ Free on OpenRouter, 131K context, tool use support

// Strip <think>...</think> blocks that Qwen3 emits in thinking mode
function stripThinking(text) {
  return (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trimStart();
}

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

  const authHeader = { 'Authorization': `Bearer ${env.OPENROUTER_API_KEY}` };

  // Call #1: Native tool calling — model decides whether to search or answer directly
  const call1Resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: baseMessages,
      tools: WEB_SEARCH_TOOL,
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

      const call1Data = await call1Resp.json();
      const assistantMessage = call1Data.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls;

      // NO SEARCH: model answered directly — stream it out
      if (!toolCalls || toolCalls.length === 0) {
        const directAnswer = stripThinking(assistantMessage?.content ?? '');
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

      // SEARCH: execute tool, then Call #2 for final streamed answer
      const toolCall   = toolCalls[0];
      const toolCallId = toolCall.id;
      const functionName = toolCall.function?.name;

      let searchResults = [];
      let toolResultContent = 'No results found.';

      if (functionName === 'web_search') {
        let functionArgs = {};
        try {
          functionArgs = JSON.parse(toolCall.function?.arguments || '{}');
        } catch (_) {}

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
      }

      // Emit search results to frontend before answer stream
      if (searchResults.length > 0) {
        await writer.write(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }

      // Call #2: Final streamed answer with tool result
      const call2Resp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          model: MODEL,
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

      // Stream Call #2, stripping <think>...</think> blocks on the fly
      const reader = call2Resp.body.getReader();
      const dec = new TextDecoder();
      let thinkBuffer = '';
      let insideThink = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = dec.decode(value, { stream: true });
        const lines = raw.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            await writer.write(enc.encode(line + '\n'));
            continue;
          }

          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            await writer.write(enc.encode(`data: [DONE]\n\n`));
            continue;
          }

          let parsed;
          try { parsed = JSON.parse(payload); } catch { continue; }

          const delta = parsed?.choices?.[0]?.delta;
          let chunk = delta?.content ?? '';
          if (!chunk) {
            await writer.write(enc.encode(`data: ${JSON.stringify(parsed)}\n\n`));
            continue;
          }

          // Buffer-based <think> stripping
          thinkBuffer += chunk;

          if (insideThink) {
            const closeIdx = thinkBuffer.indexOf('</think>');
            if (closeIdx !== -1) {
              thinkBuffer = thinkBuffer.slice(closeIdx + 8);
              insideThink = false;
            } else {
              thinkBuffer = '';
              continue;
            }
          }

          // Check for opening tag
          while (true) {
            const openIdx = thinkBuffer.indexOf('<think>');
            if (openIdx === -1) break;
            const before = thinkBuffer.slice(0, openIdx);
            if (before) {
              const out = { ...parsed, choices: [{ ...parsed.choices[0], delta: { ...delta, content: before } }] };
              await writer.write(enc.encode(`data: ${JSON.stringify(out)}\n\n`));
            }
            thinkBuffer = thinkBuffer.slice(openIdx + 7);
            insideThink = true;
            const closeIdx = thinkBuffer.indexOf('</think>');
            if (closeIdx !== -1) {
              thinkBuffer = thinkBuffer.slice(closeIdx + 8);
              insideThink = false;
            } else {
              thinkBuffer = '';
              break;
            }
          }

          if (!insideThink && thinkBuffer) {
            const out = { ...parsed, choices: [{ ...parsed.choices[0], delta: { ...delta, content: thinkBuffer } }] };
            await writer.write(enc.encode(`data: ${JSON.stringify(out)}\n\n`));
            thinkBuffer = '';
          }
        }
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
