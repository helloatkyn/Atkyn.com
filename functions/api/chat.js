export async function onRequestPost(context) {
  const { request, env } = context;

  let query;
  try {
    ({ query } = await request.json());
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

  // ── 1. LangSearch ──────────────────────────────────────────────────────────
  let sources = [];
  let contextBlock = '';

  try {
    const lsResp = await fetch('https://api.langsearch.com/v1/web-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LANGSEARCH_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        freshness: 'noLimit',
        summary: true,
        count: 5,
      }),
    });

    if (lsResp.ok) {
      const lsData = await lsResp.json();
      const pages  = lsData?.data?.webPages?.value || [];

      sources = pages.map(p => ({
        name:       p.name,
        url:        p.url,
        displayUrl: p.displayUrl || p.url,
      }));

      // Build context for Groq — cap each source at 400 chars to stay within token limit
      contextBlock = pages
        .map((p, i) => {
          const text = (p.snippet || '').slice(0, 400);
          return `[${i + 1}] ${p.name}\nURL: ${p.url}\n${text}`;
        })
        .join('\n\n');
    }
  } catch (_) {
    // LangSearch failed — continue without context
  }

  // ── 2. Stream: send sources event first, then Groq SSE ────────────────────
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();

  const write = chunk => writer.write(encoder.encode(chunk));

  (async () => {
    // First SSE event: sources JSON
    await write(`data: ${JSON.stringify({ sources })}\n\n`);

    // ── Groq call ──
    const systemPrompt = contextBlock
      ? `You are Atkyn, a fast and helpful AI search assistant.\n\nHere are the web search results for the user's query:\n\n${contextBlock}\n\nUsing these results, give a clear, concise, well-structured answer. Use markdown bold (**text**) for key terms. Cite sources by number like [1] when referencing them. Keep the answer focused and useful.`
      : 'You are Atkyn, a fast and helpful search assistant. Give clear, concise, well-structured answers. Use markdown bold (**text**) for key terms. Keep answers focused and useful.';

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: query },
        ],
        stream: true,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!groqResp.ok) {
      const err = await groqResp.text();
      await write(`data: ${JSON.stringify({ error: err })}\n\n`);
      await writer.close();
      return;
    }

    // Pipe Groq SSE chunks through
    const reader  = groqResp.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await write(decoder.decode(value, { stream: true }));
    }

    await write('data: [DONE]\n\n');
    await writer.close();
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

    
