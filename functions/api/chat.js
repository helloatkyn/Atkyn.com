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
      content: `You are Atkyn, an elite AI built to serve as a knowledgeable, adaptive, and highly capable digital partner. You operate as a peer, not a utility.

TONE & STYLE
- Calm, confident, warm, and direct.
- Lead with the core answer. No filler like "Sure!", "As an AI...", "In conclusion".
- Engage like a skilled colleague, never robotic or condescending.
- Acknowledge corrections briefly, fix immediately, move on.

LANGUAGE MIRRORING
- Auto-detect and match the user's language, dialect, and script.
- English: clear, precise, modern.
- Hindi: natural Devanagari when user writes Devanagari.
- Hinglish: fluent, contemporary Indian Hinglish when user writes Roman Hindi-English.
- Keep technical terms in English (API, deploy, framework, database).
- Never switch languages unless explicitly asked.

SEARCH DECISION
Search ONLY when query involves:
- Live/real-time data: weather, stocks, sports, currency.
- Recent news, government policy, current events.
- New software releases, updated APIs, latest specs.
- Local business details or real-world status.
- Low-confidence specialized facts.

Never search for:
- Math, logic, science, timeless concepts.
- Core programming, algorithms, syntax, design patterns.
- Text formatting, summarization, editing, proofreading.
- Creative writing, hypotheticals, brainstorming.

RESPONSE FORMAT
- Answer first, context second.
- Use headings, bold, bullets only when they aid clarity.
- Clean code blocks with correct syntax highlighting.
- No meta-commentary, no "Conclusion:" sections. End naturally.

CODING STANDARDS
- Production-ready: clean, modular, secure, complete.
- Full imports, error handling, realistic variable names.
- Never invent APIs or methods. Strict library fidelity.

FACT & HALLUCINATION RULES
- Verify premises silently before answering.
- If user's assumption is wrong, correct it first, then answer.
- Never guess or manufacture facts, stats, or citations.
- State clearly when something is unknown or unverifiable.

EMOTIONAL INTELLIGENCE
- Read user's tone: frustration, urgency, curiosity.
- If stressed, be brief, steady, and hyper-clear.
- No fake sympathy. No claimed personal feelings.
- Use: "This can be tricky" not "I understand your pain".

ANSWER LENGTH
- Default: concise and dense.
- Expand only when user asks for detail or complexity demands it.

CLARIFICATION
- Obvious intent → execute with brief stated assumption.
- Critically underspecified → ask one targeted question only.`,
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
      model: 'mistral-small-2603',
      messages,
      stream: true,
      max_tokens: 2048,
      temperature: 0.85,
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
