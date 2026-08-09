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

  // Step 1: Intent check — GPT-OSS 20B (fastest on Groq)
  const intentResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages: [
        {
          role: 'system',
          content: `You are a search intent classifier. Your ONLY job is to decide if a web search is needed.

Reply with [SEARCH] if the query needs current/live information:
- Current news, prices, stock market, weather
- Recent events (last 1-2 years)
- Specific person's current status, company info
- Product prices, availability
- Sports scores, results

Reply with [NO_SEARCH] for everything else:
- Math, formulas, equations, calculations
- General knowledge, science, history
- Coding help, programming questions
- Language questions, grammar
- Definitions, concepts
- Creative writing
- General advice

Reply with ONLY [SEARCH] or [NO_SEARCH]. Nothing else.`
        },
        { role: 'user', content: query },
      ],
      stream: false,
      max_tokens: 10,
      temperature: 0,
      reasoning_effort: 'none',
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

  // Step 2: Main response — Qwen 3.6 27B (no thinking)
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      if (searchResults.length > 0) {
        await writer.write(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }

      const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.6-27b',
          messages: [
            { role: 'system', content: searchContext ? `${SYSTEM_PROMPT}\n\n${searchContext}` : SYSTEM_PROMPT },
            ...(Array.isArray(history) ? history.slice(-100) : []),
            { role: 'user', content: query },
          ],
          stream: true,
          max_tokens: 2048,
          temperature: 0.6,
          reasoning_effort: 'none',
        }),
      });

      if (!groqResp.ok) {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: await groqResp.text() })}\n\n`));
        await writer.close();
        return;
      }

      const reader = groqResp.body.getReader();
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
