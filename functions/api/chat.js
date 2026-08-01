import { planIntent }        from './core/planner.js';
import { resolveRole }       from './core/role_manager.js';
import { buildSystemMessage } from './core/prompt_loader.js';
import { getHistory }        from './core/memory_manager.js';
import { buildRequestBody }  from './core/response_engine.js';
import { SETTINGS }          from './config/settings.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let query, history;
  try { ({ query, history } = await request.json()); }
  catch { return err(400, 'Invalid request body'); }
  if (!query?.trim()) return err(400, 'Empty query');

  const roleState   = resolveRole(query, history);
  const plan        = roleState.isNewAssignment
    ? { intent: 'role_ack', max_tokens: 50, directive: 'User just assigned a temporary role. Acknowledge in 1 sentence and ask what they need.' }
    : planIntent(query);

  const systemMsg   = buildSystemMessage(plan, roleState);
  const messages    = [
    { role: 'system', content: systemMsg },
    ...getHistory(history),
    { role: 'user', content: query },
  ];

  const groqResp = await fetch(SETTINGS.groqEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify(buildRequestBody(messages, plan)),
  });

  if (!groqResp.ok) return err(groqResp.status, await groqResp.text());

  return new Response(groqResp.body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}

function err(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
