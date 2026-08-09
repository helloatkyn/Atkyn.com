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
    const langResp = await fetch('https://api.langsearch.com/v1/web-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LANGSEARCH_API_KEY}`,
      },
      body: JSON.stringify({ query: query, count: 6, summary: false }),
    });

    if (langResp.ok) {
      const pages = (await langResp.json()).data?.webPages?.value || [];
      searchResults = pages.slice(0, 6).map(r => ({
        title:   r.name    || '',
        url:     r.url     || '',
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

      const mistralResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: searchContext ? `${SYSTEM_PROMPT}\n\n${searchContext}` : SYSTEM_PROMPT },
            ...(Array.isArray(history) ? history.slice(-100) : []),
            { role: 'user', content: query },
          ],
          stream: true,
          max_tokens: 2048,
          temperature: 0.6,
        }),
      });

      if (!mistralResp.ok) {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: await mistralResp.text() })}\n\n`));
        await writer.close();
        return;
      }

      const reader = mistralResp.body.getReader();
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
