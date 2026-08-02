import { SYSTEM_PROMPT } from './systemPrompt.js';

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

  /* ── Web search via Serper ── */
  let searchResults = [];
  let searchContext = '';

  try {
    const serperResp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': env.SERPER_API_KEY,
      },
      body: JSON.stringify({ q: query, num: 6 }),
    });

    if (serperResp.ok) {
      const serperData = await serperResp.json();
      const organic = serperData.organic || [];

      searchResults = organic.slice(0, 6).map(r => ({
        title:   r.title   || '',
        url:     r.link    || '',
        snippet: r.snippet || '',
      }));

      if (searchResults.length > 0) {
        searchContext = 'Web search results for context:\n' +
          searchResults.map((r, i) =>
            `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
          ).join('\n\n') +
          '\n\nUse the above search results to inform your answer where relevant.';
      }
    }
  } catch (_) {
    // Search failure is non-fatal — continue without web context.
  }

  /* ── Build streaming response ── */
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      // Emit search result cards first (if any), before the LLM stream starts.
      if (searchResults.length > 0) {
        const resultsEvent =
          `event: results\ndata: ${JSON.stringify(searchResults)}\n\n`;
        await writer.write(enc.encode(resultsEvent));
      }

      // Inject web context into the system prompt when available.
      const systemContent = searchContext
        ? `${SYSTEM_PROMPT}\n\n${searchContext}`
        : SYSTEM_PROMPT;

      const qwenResp = await fetch(
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.QWEN_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'qwen3.7-flash',
            messages: [
              { role: 'system', content: systemContent },
              ...(Array.isArray(history) ? history.slice(-100) : []),
              { role: 'user', content: query },
            ],
            stream: true,
            max_tokens: 2048,
            temperature: 0.6,
            enable_thinking: false,
          }),
        }
      );

      if (!qwenResp.ok) {
        const err = await qwenResp.text();
        await writer.write(
          enc.encode(`data: ${JSON.stringify({ error: err })}\n\n`)
        );
        await writer.close();
        return;
      }

      // Pipe Qwen's SSE stream straight through.
      const reader = qwenResp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }

      await writer.close();
    } catch (err) {
      try {
        await writer.write(
          enc.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
        );
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
