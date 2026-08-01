// ─────────────────────────────────────────────────────────────
// ROLE MANAGER
// ─────────────────────────────────────────────────────────────

const ROLE_ASSIGN_RE   = /\b(act as|you are|pretend to be|behave like|respond as|play the role of|be a|be an|imagine you are|assume the role of|from now on you are)\b/i;
const ROLE_CONTINUE_RE = /^(next|continue|go on|explain step|show another|one more|translate this too|same|and|also|furthermore|what about|another example|next question|next one|step \d)/i;
const ROLE_EXIT_RE     = /\b(sun meri baat|by the way|new topic|forget that|forget it|let's talk|help me|what is|who is|search this|different topic|change topic|nevermind|never mind|actually|unrelated|alag|chodo|chhodo|bhool jao)\b/i;

function extractRole(query) {
  const m = query.match(
    /(?:act as|you are|pretend to be|behave like|respond as|play the role of|be a|be an|imagine you are|assume the role of|from now on you are)\s+(?:a|an|the)?\s*(.+?)(?:\.|,|and|$)/i
  );
  return m ? m[1].trim() : null;
}

function resolveRole(query, history) {
  const recent = Array.isArray(history) ? history.slice(-20) : [];

  if (ROLE_ASSIGN_RE.test(query))
    return { activeRole: extractRole(query), shouldClear: false, isNewAssignment: true };

  if (ROLE_EXIT_RE.test(query))
    return { activeRole: null, shouldClear: true, isNewAssignment: false };

  let detectedRole = null, roleIdx = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].role === 'user' && ROLE_ASSIGN_RE.test(recent[i].content)) {
      detectedRole = extractRole(recent[i].content);
      roleIdx = i;
      break;
    }
  }
  if (!detectedRole) return { activeRole: null, shouldClear: false, isNewAssignment: false };

  const after = recent.slice(roleIdx + 1).filter(m => m.role === 'user');
  for (const m of after) {
    if (ROLE_EXIT_RE.test(m.content)) return { activeRole: null, shouldClear: true, isNewAssignment: false };
    if (!ROLE_CONTINUE_RE.test(m.content) && m.content.trim().split(/\s+/).length > 6)
      return { activeRole: null, shouldClear: true, isNewAssignment: false };
  }

  const wc = query.trim().split(/\s+/).length;
  if (!ROLE_CONTINUE_RE.test(query) && wc > 6)
    return { activeRole: null, shouldClear: true, isNewAssignment: false };

  return { activeRole: detectedRole, shouldClear: false, isNewAssignment: false };
}

// ─────────────────────────────────────────────────────────────
// INTENT PLANNER  v10
// Priority order matters — casual/greeting must run first.
// ─────────────────────────────────────────────────────────────

// Broad Hinglish + English casual chat — covers partial matches anywhere in query
const CASUAL_RE = /(?:^|\s)(kya haal hai|kya hal hai|kya haal|kya hal|aur kya haal|aur kya hal|aur kya|aur bata|aur bhai|aur yaar|kya scene|kya chal raha|kya chal|kya kar raha|kya ho raha|kaisa hai|kaisi hai|kaise ho|kaise hain|abay kaisa|abey kaisa|abay|abey|bhai kya|yaar kya|sun bhai|sun yaar|sab theek|sab thik|sab badhiya|chal kya|aaj kya|kya yaar|kya bhai|thak gaya|bore ho|mast hai|maza aa|kem cho|kem chho|ka haal ba|kasa kai|ram ram|wassup|what'?s up|wyd|hru|how r u|how are you doing|how have you been|what'?s good|what'?s new|bata kuch|kuch naya|kya hua|kya scene hai)(?:\s|$|[?!?,])/i;

// Greeting — standalone words only
const GREETING_RE = /^(hi+|hey+|hello|yo+|sup|hola|namaste|heya|howdy|gm|gn|good (morning|evening|night|afternoon)|salam|adaab|jai hind)[\s!?.]*$/i;

function planIntent(query) {
  const q   = query.trim();
  const ql  = q.toLowerCase();
  const wc  = q.split(/\s+/).length;

  // 1. Greeting
  if (GREETING_RE.test(q))
    return { intent: 'greeting', max_tokens: 30,
      directive: 'Greeting mode. One warm sentence, stop.' };

  // 2. Casual chat — runs before everything else to prevent mis-routing
  if (CASUAL_RE.test(ql) && wc <= 12)
    return { intent: 'casual_chat', max_tokens: 24, temperature_override: 0.9,
      directive: 'CASUAL CHAT — HIGHEST PRIORITY. Reply like a close friend. MAX 1 sentence, MAX 18 words. NEVER define, translate, explain, list, or teach. Just reply naturally and STOP.' };

  // 3. Math
  if (/[\d+\-*/^=]/.test(ql) && /\d/.test(ql) && wc <= 15)
    return { intent: 'math', max_tokens: 120,
      directive: 'Math mode. Answer + minimal working only. Stop.' };

  // 4. Translation
  if (/\b(translate|translation|meaning in|how do you say|ka matlab kya|ka hindi|ka english)\b/.test(ql))
    return { intent: 'translation', max_tokens: 100,
      directive: 'Translation mode. Give translation + 1 example if useful. Stop.' };

  // 5. Research / deep dive
  if (/\b(research|deep dive|in depth|comprehensive|full analysis|detailed analysis|write an? (essay|article|report))\b/.test(ql))
    return { intent: 'research', max_tokens: 1800,
      directive: 'Research mode. Well-structured, use ## headings. Stop when complete.' };

  // 6. Tutorial / how-to
  if (/\b(how to|tutorial|step by step|teach me|guide me|explain how|walkthrough)\b/.test(ql))
    return { intent: 'tutorial', max_tokens: 600,
      directive: 'Tutorial mode. Numbered steps, concise. Skip obvious steps. Stop after last step.' };

  // 7. Coding
  if (/\b(code|function|bug|error|fix|implement|write a|class|api|endpoint|query|sql|regex|script|loop|array|object|hook|component|flutter|dart|kotlin|python|javascript|typescript|react|node|css|html)\b/.test(ql))
    return { intent: 'coding', max_tokens: 500,
      directive: 'Coding mode. Root cause → solution → clean code → short explanation only if non-obvious. No line-by-line. Stop.' };

  // 8. Comparison
  if (/\b(vs|versus|compare|difference between|which is better|pros and cons|contrast)\b/.test(ql))
    return { intent: 'comparison', max_tokens: 280,
      directive: 'Comparison mode. Key differences only — table or bullets. No history or market data unless asked. Stop.' };

  // 9. Recommendation
  if (/\b(recommend|suggest|best|top|which should i|what should i use|advise)\b/.test(ql))
    return { intent: 'recommendation', max_tokens: 200,
      directive: 'Recommendation mode. Direct pick + brief reason. No exhaustive list unless asked. Stop.' };

  // 10. Who is
  if (/^who (is|was|are|were)\b/.test(ql))
    return { intent: 'who_is', max_tokens: 90,
      directive: 'Who-is mode. Name, role, 1–2 key facts. No biography or timeline. Stop.' };

  // 11. What is / definition
  if (/^what (is|are|was|were)\b/.test(ql) || /\b(define|definition of|meaning of|what does .+? mean)\b/.test(ql))
    return { intent: 'definition', max_tokens: 110,
      directive: 'Definition mode. Clear concise definition + 1–2 facts. No history, business model, competitors, or financials. Stop.' };

  // 12. Named entity — bare short phrase, no verb
  if (wc <= 4 && !/[?]/.test(q) && /^[\w\s]+$/.test(q))
    return { intent: 'entity', max_tokens: 110,
      directive: 'Entity mode. 1–2 sentence description + 1–2 facts. No history, timeline, financials, pros/cons, or competitors. Stop.' };

  // 13. How / Why explanation
  if (/^(how|why|kaise|kyun|kyunki)\b/.test(ql))
    return { intent: 'explanation', max_tokens: 200,
      directive: 'Explanation mode. Direct answer. Context only if it changes the answer. Stop.' };

  // 14. Creative
  if (/\b(write a (poem|story|letter|email|song|joke|shayari)|creative|fiction|narrative)\b/.test(ql))
    return { intent: 'creative', max_tokens: 450,
      directive: 'Creative mode. Match intent and style. Craft over length. Stop when piece is complete.' };

  // 15. Default conversation
  return { intent: 'conversation', max_tokens: 160,
    directive: 'Conversation mode. Direct, natural, concise. Stop when answered.' };
}

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT  v10  — compact, high-signal
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `MODULE RESPONSE ENGINE

CORE DIRECTIVE
You are the response generation engine for a production-grade AI assistant. Your sole responsibility is to structure, format, and articulate responses with maximum naturalness, conciseness, and readability. You do not determine facts, perform reasoning, enforce safety, or detect language. Those are handled by dedicated modules. Your output must feel indistinguishable from a highly competent, natural human writer, matching the conversational quality of frontier models.

RESPONSE STRUCTURE AND INFORMATION PRIORITY
Always lead with the direct answer to the user query. Do not use long introductions, filler phrases, or preamble. Expand only when it adds genuine utility. Structure your response based on strict information priority. Highest priority is the direct answer. Second is necessary explanation. Third is helpful context. Fourth is optional extra details. Never repeat the user's question in your response.

PROGRESSIVE DISCLOSURE
Never dump all information at once. Start with what matters most to the user's immediate intent. Reveal additional information naturally and progressively, allowing the user to guide the depth of the conversation.

INFORMATION COMPRESSION AND DENSITY
Compress information without losing meaning. Every sentence must justify its existence by providing high value, low word count, and maximum clarity. Avoid redundancy. Never say the same thing twice in different words. Avoid padding or filler content.

READABILITY AND MOBILE OPTIMIZATION
Optimize all responses for mobile reading. Use short paragraphs and natural spacing. Never generate giant blocks of text. Ensure whitespace is used effectively to reduce cognitive load.

PARAGRAPH LOGIC
Every paragraph must serve exactly one clear purpose. Do not mix unrelated ideas within a single paragraph. Maintain strict thematic cohesion within each block of text.

LIST AND HEADING INTELLIGENCE
Only use bulleted or numbered lists when they genuinely improve readability or organize complex data better than prose. Do not convert every answer into a list. Only create headings when the response is long and complex enough to genuinely benefit from structural division. Never force headings or lists where natural prose is superior.

EXPLANATION DEPTH
Match the user's expected depth precisely. Never over-explain simple concepts. Never under-explain complex requests. Calibrate the depth based on the implicit and explicit cues in the user's prompt.

NATURAL FLOW AND HUMAN WRITING STYLE
Ensure every sentence naturally leads to the next. Avoid abrupt topic changes. Avoid predictable LLM writing patterns. Eliminate repetitive transitions, repetitive openings, and repetitive conclusions. Never adopt a textbook, Wikipedia, or generic customer support writing style. The prose must feel alive, dynamic, and authentically human.

REDUNDANCY REMOVAL
Before generating every paragraph, internally verify whether it adds new, distinct information. If a paragraph does not advance the response or provide new value, remove it entirely.

ENDING LOGIC
Stop the response naturally the moment the user's intent is satisfied. Never force artificial conclusions, summaries, or transitions. Never use generic closing phrases such as Hope this helps, Let me know, Anything else, or Feel free to ask. If one sentence is enough to answer the query, one sentence is the entire response.

FINAL VERIFICATION
Before returning any response, internally execute a final quality check. Verify the following: Is this the shortest complete answer possible? Is anything repetitive? Is anything unnecessary? Does the very first sentence directly answer the user? Would a frontier model naturally write this? If the answer to any of these is negative, refine and improve the response internally before sending. Do not mention this verification process to the user.`;

// ─────────────────────────────────────────────────────────────
// CLOUDFLARE PAGES FUNCTION
// ─────────────────────────────────────────────────────────────

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

  // Role Manager
  const roleState = resolveRole(query, history);

  // Intent Planner
  const plan = roleState.isNewAssignment
    ? { intent: 'role_ack', max_tokens: 50,
        directive: 'User just assigned a temporary role. Acknowledge in 1 sentence and ask what they need.' }
    : planIntent(query);

  // Build system message
  let systemMessage = SYSTEM_PROMPT;

  if (roleState.activeRole) {
    systemMessage += `\n\n[ACTIVE ROLE: ${roleState.activeRole}] — Adopt this role's expertise and tone for this response only. All Atkyn core rules still apply. Revert after task.`;
  } else if (roleState.shouldClear) {
    systemMessage += `\n\n[ROLE CLEARED] — Topic changed. You are plain Atkyn. Ignore any prior role from this conversation.`;
  }

  systemMessage += `\n\n[ACTIVE PLANNER DIRECTIVE] ${plan.directive}`;

  const groqResp = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen-turbo',
      messages: [
        { role: 'system', content: systemMessage },
        ...(Array.isArray(history) ? history.slice(-20) : []),   // Fix #2: was -100
        { role: 'user', content: query },
      ],
      stream: true,
      max_tokens: plan.max_tokens,
      temperature: plan.temperature_override ?? 0.55,
      top_p: plan.temperature_override ? 0.95 : 0.85,
      frequency_penalty: 0.15,
      presence_penalty: 0.2,
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
