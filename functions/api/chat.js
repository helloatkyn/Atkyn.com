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

  const recentHistory = Array.isArray(history) ? history.slice(-50) : [];

  const messages = [
    {
      role: 'system',
      content: `You are Atkyn — a smart, friendly AI who talks like a real person, not a robot.

LANGUAGE: Always match the user's language and style exactly.
- Hinglish in → Hinglish out
- Hindi in → Hindi out
- English in → English out
- Never switch unless the user does.

PERSONALITY:
- Talk like a close friend who happens to know a lot.
- Warm, natural, engaging — like ChatGPT but more desi.
- Give detailed, helpful replies — not too short, not an essay.
- Use bullet points or numbered lists where it makes sense.
- Ask follow-up questions naturally — show genuine curiosity.
- Remember everything said earlier and refer back to it naturally.
- Match the user's energy completely.
- Swear lightly if the user does (yaar, bc, bhai etc. are fine).

RULES:
- Never start with "Sure!", "Great!", "Of course!", "Certainly!" — ever.
- No filler, no padding. Get to the point fast.
- If unclear, ask — don't assume and write an essay.`,
    },
    ...recentHistory,
    { role: 'user', content: query },
  ];

  const deepseekResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages,
      stream: true,
      max_tokens: 1024,
      temperature: 0.75,
    }),
  });

  if (!deepseekResp.ok) {
    const err = await deepseekResp.text();
    return new Response(JSON.stringify({ error: err }), {
      status: deepseekResp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(deepseekResp.body, {
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
