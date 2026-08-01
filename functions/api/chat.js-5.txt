import { IDENTITY_PROMPT }     from './identity.js';
import { CONVERSATION_PROMPT } from './conversation.js';
import { classifyQuery, getTypeInstruction } from './queryType.js';

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
          ...(Array.isArray(history) ? history.slice(-100) : []),
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
