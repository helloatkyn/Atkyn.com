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
    return clean.slice(0, 1500);
  } catch {
    return '';
  }
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

  // Step 1: Intent check
  const intentResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'ministral-3b-latest',
      messages: [
        { role: 'system', content: 'You decide if a web search is needed to answer the user query. Reply with only [SEARCH] or [NO_SEARCH]. Nothing else.' },
        { role: 'user', content: query },
      ],
      stream: false,
      max_tokens: 10,
      temperature: 0,
    }),
  });

  let searchResults = [];
  let searchContext = '';

  if (intentResp.ok) {
    const intentData = await intentResp.json();
    const decision = intentData.choices?.[0]?.message?.content?.trim();

    if (decision === '[SEARCH]') {
      try {
        const searxResp = await fetch(
          `${env.SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (searxResp.ok) {
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

          searchResults = enriched;
          if (searchResults.length > 0) {
            searchContext = 'Web search results:\n' +
              searchResults.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n\n');
          }
        }
      } catch (_) {}
    }
  }

  // Step 2: Ministral 3B stream
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
          model: 'ministral-3b-latest',  // ← Ministral 3B
          messages: [
            { role: 'system', content: searchContext ? `${SYSTEM_PROMPT}\n\n${searchContext}` : SYSTEM_PROMPT },
            ...(Array.isArray(history) ? history.slice(-100) : []),
            { role: 'user', content: query },
          ],
          stream: true,
          max_tokens: 2048,
          temperature: 0.3,
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
