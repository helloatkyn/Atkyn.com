import { SYSTEM_PROMPT } from './systemPrompt.js';

async function searchWeb(query, apiKey) {
  const url = `https://api.searlo.tech/api/v1/search/web?q=${encodeURIComponent(query)}&limit=5&hl=en`;
  const resp = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.items || [];
}

function formatSearchResults(items) {
  if (!items || items.length === 0) return '';
  const formatted = items
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.link}\n${r.snippet}`)
    .join('\n\n');
  return `\n\n<web_results>\n${formatted}\n</web_results>`;
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

  const searchResults = await searchWeb(query, env.SEARLO_API_KEY);
  const searchContext = formatSearchResults(searchResults);

  const userMessageWithContext = searchContext
    ? `${query}${searchContext}`
    : query;

  const mistralResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(Array.isArray(history) ? history.slice(-100) : []),
        { role: 'user', content: userMessageWithContext },
      ],
      stream: true,
      max_tokens: 2048,
      temperature: 0.6,
    }),
  });

  if (!mistralResp.ok) {
    const err = await mistralResp.text();
    return new Response(JSON.stringify({ error: err }), {
      status: mistralResp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(mistralResp.body, {
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
