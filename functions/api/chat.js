import { IDENTITY_PROMPT }     from './identity.js';
import { CONVERSATION_PROMPT } from './conversation.js';
import { classifyQuery, getTypeInstruction } from './queryType.js';

/**
 * Sanitize conversation history before sending to Groq.
 *
 * WHY THIS EXISTS:
 * When a request fails (rate-limit, timeout, model error), the frontend
 * adds the user message to local history but never receives a valid
 * assistant reply. On the next send, history ends with a 'user' turn.
 * chat.js then appends another { role: 'user' } → two consecutive user
 * roles → Groq returns 400 → "Something went wrong" → cascade of failures.
 *
 * This function makes history safe to use regardless of prior failures.
 */
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  // Strip any trailing user turns — chat.js appends the current query itself.
  // A trailing user in history + the new user query = consecutive user roles → 400.
  let h = [...history];
  while (h.length > 0 && h[h.length - 1].role === 'user') {
    h.pop();
  }

  // Drop malformed entries and any system messages that snuck into history.
  // Also collapse any remaining consecutive same-role sequences defensively.
  const cleaned = [];
  let lastRole = 'assistant'; // history should start with a user turn
  for (const msg of h) {
    if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') continue;
    if (msg.role === 'system') continue;
    if (msg.content.trim() === '') continue;
    if (msg.role === lastRole) continue; // skip consecutive same-role
    cleaned.push({ role: msg.role, content: msg.content });
    lastRole = msg.role;
  }

  return cleaned;
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

  const queryType       = classifyQuery(query);
  const typeInstruction = getTypeInstruction(queryType);

  const systemPrompt = [
    IDENTITY_PROMPT,
    CONVERSATION_PROMPT,
    typeInstruction,
  ].join('\n\n');

  // Sanitize history BEFORE slicing and before building the messages array.
  const safeHistory = sanitizeHistory(history).slice(-100);

  let groqResp;
  try {
    groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        messages: [
          { role: 'system', content: systemPrompt },
          ...safeHistory,
          { role: 'user', content: query },
        ],
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
        top_p: 0.8,
        presence_penalty: 1.5,
        reasoning_effort: 'none',
      }),
    });
  } catch (fetchErr) {
    return new Response(JSON.stringify({ error: 'Failed to reach Groq API', detail: fetchErr.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!groqResp.ok) {
    const errText = await groqResp.text();
    // Pass Groq's status through so frontend can distinguish 429 vs 500
    return new Response(errText, {
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
