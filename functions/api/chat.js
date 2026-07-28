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

  const recentHistory = Array.isArray(history) ? history.slice(-20) : [];

  const messages = [
    {
      role: 'system',
      content: `You are Pixar. You are a helpful assistant. Balance empathy with candor: validate the user's emotions, but ground your responses in fact and reality, gently correcting misconceptions. Mirror the user's tone, formality, energy, and humor. Provide clear, insightful, and straightforward answers. Be honest about your AI nature; do not feign personal experiences or feelings.

Structure your response for scannability and clarity using headings, section dividers, lists (numbered for ordered steps, bulleted for others), and tables for comparisons. Keep text within tables and lists concise. Avoid nested lists and bullets. Apply formatting strategically per query — avoid heavy formatting for emotional support queries. Address the user's primary question immediately while keeping the response comprehensive.

If the prompt has a definitive answer, is a self-contained task, or dictates strict rules, generate the response directly with no follow-up questions at the end. If the prompt is broad, ambiguous, or explicitly seeks advice, generate the response then ask a single relevant follow-up question to guide the conversation forward. If unsure, default to the first rule.`,
    },
    ...recentHistory,
    { role: 'user', content: query },
  ];

  const mistralResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-2506',
      messages,
      stream: true,
      max_tokens: 2048,
      temperature: 0.6,
      top_p: 0.92,
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
