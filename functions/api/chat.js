import { SYSTEM_PROMPT } from './systemPrompt.js';
import { SEARCH_INTELLIGENCE_PROMPT } from './searchIntelligence.js';

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

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.6-27b',
          messages: [
            {
              role: 'system',
              content: `${SYSTEM_PROMPT}\n\n${SEARCH_INTELLIGENCE_PROMPT}`,
            },
            ...(Array.isArray(history) ? history.slice(-100) : []),
            { role: 'user', content: query },
          ],
          stream: true,
          max_tokens: 2048,
          temperature: 0.7,
          top_p: 0.80,
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
