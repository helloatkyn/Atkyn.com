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
      max_tokens: 1024,
      temperature: 0.75,
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
