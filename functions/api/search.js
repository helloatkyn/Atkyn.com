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

  // ── 1. SearXNG se web results fetch karo ──
  let webResults = [];
  try {
    const searxngUrl = env.SEARXNG_URL;
    const searchResp = await fetch(
      `${searxngUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=auto`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (searchResp.ok) {
      const data = await searchResp.json();
      webResults = (data.results || []).slice(0, 8).map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || '',
        source: r.engine || '',
      }));
    }
  } catch (e) {
    console.error('SearXNG error:', e);
  }

  // ── 2. Mistral ke liye context banao ──
  const contextBlock = webResults.length
    ? `Web search results for: "${query}"\n\n` +
      webResults.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n\n')
    : '';

  // ── 3. Mistral stream ──
  const mistralResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'ministral-8b-latest',
      messages: [
        ...(Array.isArray(history) ? history.slice(-20) : []),
        {
          role: 'user',
          content: contextBlock
            ? `${contextBlock}\n\n---\n\nQuery: ${query}`
            : query,
        },
      ],
      stream: true,
      max_tokens: 2048,
      temperature: 0.6,
      frequency_penalty: 0.3,
    }),
  });

  if (!mistralResp.ok) {
    const err = await mistralResp.text();
    return new Response(JSON.stringify({ error: err }), {
      status: mistralResp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── 4. Pehle results event, phir AI stream ──
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  writer.write(encoder.encode(`event: results\ndata: ${JSON.stringify(webResults)}\n\n`));

  (async () => {
    const reader = mistralResp.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
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
