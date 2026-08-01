// ─────────────────────────────────────────────────────────────────────────────
// DEBUG VERSION of chat.js
// Deploy this temporarily. Check the browser Network tab → response body.
// The exact stage/error will be in the JSON.
// After diagnosing, swap back to normal chat.js with the fix applied.
// ─────────────────────────────────────────────────────────────────────────────

import { planIntent }         from './core/planner.js';
import { resolveRole }        from './core/role_manager.js';
import { buildSystemMessage } from './core/prompt_loader.js';
import { getHistory }         from './core/memory_manager.js';
import { buildRequestBody }   from './core/response_engine.js';
import { SETTINGS }           from './config/settings.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const debug = [];

  try {
    debug.push('[1] Request received');

    let query, history;
    try {
      ({ query, history } = await request.json());
      debug.push('[2] Request parsed: query=' + (query?.slice(0, 80) ?? 'null'));
    } catch (e) {
      return debugErr(400, 'Invalid request body', e, debug);
    }

    if (!query?.trim()) return debugErr(400, 'Empty query', null, debug);

    const keyStatus = env.GROQ_API_KEY
      ? 'SET (length=' + env.GROQ_API_KEY.length + ')'
      : 'MISSING — this is the bug';
    debug.push('[3] GROQ_API_KEY: ' + keyStatus);

    let roleState;
    try {
      roleState = resolveRole(query, history);
      debug.push('[4] resolveRole OK → ' + JSON.stringify(roleState));
    } catch (e) {
      return debugErr(500, 'resolveRole threw', e, debug);
    }

    let plan;
    try {
      plan = roleState.isNewAssignment
        ? { intent: 'role_ack', max_tokens: 50, directive: 'User just assigned a temporary role. Acknowledge in 1 sentence and ask what they need.' }
        : planIntent(query);
      debug.push('[5] planIntent OK → intent=' + plan.intent + ' max_tokens=' + plan.max_tokens);
    } catch (e) {
      return debugErr(500, 'planIntent threw', e, debug);
    }

    let systemMsg;
    try {
      systemMsg = buildSystemMessage(plan, roleState);
      debug.push('[6] buildSystemMessage OK → len=' + systemMsg.length + ' chars');
    } catch (e) {
      return debugErr(500, 'buildSystemMessage threw', e, debug);
    }

    let messages;
    try {
      const hist = getHistory(history);
      messages = [
        { role: 'system', content: systemMsg },
        ...hist,
        { role: 'user', content: query },
      ];
      debug.push('[7] messages built → total=' + messages.length + ' (history=' + hist.length + ')');
    } catch (e) {
      return debugErr(500, 'getHistory/messages threw', e, debug);
    }

    let requestBody;
    try {
      requestBody = buildRequestBody(messages, plan);
      debug.push('[8] buildRequestBody OK → model=' + requestBody.model
        + ' max_tokens=' + requestBody.max_tokens
        + ' temperature=' + requestBody.temperature
        + ' has_stop=' + ('stop' in requestBody));
    } catch (e) {
      return debugErr(500, 'buildRequestBody threw', e, debug);
    }

    debug.push('[9] Fetching Groq: ' + SETTINGS.groqEndpoint);

    let groqResp;
    try {
      groqResp = await fetch(SETTINGS.groqEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });
      debug.push('[10] Groq responded → status=' + groqResp.status + ' ok=' + groqResp.ok);
    } catch (e) {
      return debugErr(502, 'Groq fetch() threw: ' + e.message, e, debug);
    }

    if (!groqResp.ok) {
      let groqBody = '';
      try { groqBody = await groqResp.text(); } catch {}
      debug.push('[11] Groq error → ' + groqBody.slice(0, 300));
      return new Response(JSON.stringify({
        error: 'Groq API error',
        groq_status: groqResp.status,
        groq_body: groqBody,
        debug,
      }), {
        status: groqResp.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    debug.push('[11] Groq OK — streaming');

    return new Response(groqResp.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Unhandled exception in onRequestPost',
      message: e.message,
      stack: e.stack ?? '(no stack)',
      debug,
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
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

function debugErr(status, message, error, debug) {
  return new Response(JSON.stringify({
    error: message,
    exception: error ? { message: error.message, stack: error.stack ?? '(no stack)' } : null,
    debug,
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
        }
