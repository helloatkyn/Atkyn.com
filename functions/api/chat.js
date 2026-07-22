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

  const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: 'You are Atkyn, a fast and helpful search assistant. Give clear, concise, well-structured answers. Use markdown bold (**text**) for key terms. Keep answers focused and useful.',
        },
        { role: 'user', content: query },
      ],
      stream: true,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!groqResp.ok) {
    const err = await groqResp.text();
    return new Response(JSON.stringify({ error: err }), {
      status: groqResp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(groqResp.body, {
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

