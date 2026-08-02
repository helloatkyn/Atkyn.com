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
      const organic = (await serperResp.json()).organic || [];
      searchResults = organic.slice(0, 6).map(r => ({
        title:   r.title   || '',
        url:     r.link    || '',
        snippet: r.snippet || '',
      }));
      if (searchResults.length > 0) {
        searchContext = 'Web search results:\n' +
          searchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join('\n\n');
      }
    }
  } catch (_) {}

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      if (searchResults.length > 0) {
        await writer.write(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }

      const qwenResp = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.QWEN_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen3.7-flash',
          messages: [
            { role: 'system', content: searchContext ? `${SYSTEM_PROMPT}\n\n${searchContext}` : SYSTEM_PROMPT },
            ...(Array.isArray(history) ? history.slice(-100) : []),
            { role: 'user', content: query },
          ],
          stream: true,
          max_tokens: 2048,
          temperature: 0.6,
          enable_thinking: false,
        }),
      });

      if (!qwenResp.ok) {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: await qwenResp.text() })}\n\n`));
        await writer.close();
        return;
      }

      const reader = qwenResp.body.getReader();
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
