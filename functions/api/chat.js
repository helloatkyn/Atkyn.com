// Queries jo search nahi karni — LLM seedha answer kare
function needsSearch(query) {
  const q = query.trim().toLowerCase();

  // Bohot choti queries (1-2 words)
  if (q.split(/\s+/).length <= 2) return false;

  // Always search if user says "search kar / phir se search / dobara search"
  if (/search\s*(kar|karo|karna|phir|dobara|again)/i.test(q)) return true;
  if (/phir\sse\ssearch/i.test(q)) return true;

  // Pure greetings
  const greetings = [
    /^(hi|hello|hey|hola|namaste|namaskar|salam)\b/,
    /^(kya haal|kaisa hai|kaise ho|kya chal)\b/,
    /^(shukriya|thanks|thank you|dhanyawad|bahut accha|wah)\b/,
    /^(haan|nahi|ok|okay|theek|bilkul|accha|achha)\b/,
    /^(ha|hm+|hmm+|lol)\b/,
  ];
  if (greetings.some(r => r.test(q))) return false;

  // Factual / search signals
  const searchSignals = [
    /\b(kya hai|what is|who is|kaun hai|kab|when|kaha|where|kyun|why|kaun|how|kitna|kitne)\b/,
    /\b(price|cost|rate|value|worth)\b/,
    /\b(news|khabar|latest|abhi|aaj|today|kal|tomorrow|recent|2024|2025|2026)\b/,
    /\b(weather|mausam|temperature|barish)\b/,
    /\b(best|top|review|compare|vs|difference|better)\b/,
    /\b(net worth|salary|income|ameer|richest|sabse)\b/,
    /\b(result|score|match|winner|game)\b/,
    /\b(galat|galt|wrong|incorrect|sahi nahi|mistake)\b/,
  ];
  if (searchSignals.some(r => r.test(q))) return true;

  // 5+ word queries default search
  return q.split(/\s+/).length >= 5;
}

// Chinese/irrelevant domains blacklist
const BLOCKED_DOMAINS = [
  'm.163.com', '163.com', 'csdn.net', 'baidu.com', 'weibo.com',
  'zhihu.com', 'bilibili.com', 'sina.com', 'sohu.com', 'qq.com',
  'taobao.com', 'jd.com', 'aliexpress.com', 'douban.com',
  'naver.com', 'yahoo.co.jp', 'nicovideo.jp',
];

// ── System prompts ─────────────────────────────────────────────────────────

const SYSTEM_WITH_SEARCH = (contextBlock) => `\
You are Atkyn, a smart AI assistant. Reply like a knowledgeable friend — direct, clear, natural.

LANGUAGE: Mirror the user exactly. Hinglish in → Hinglish out. Hindi in → Hindi out. English in → English out. Never switch unless asked.

WEB SEARCH RESULTS:
${contextBlock}

Use these results to answer. Cite as [1], [2] where useful — keep it minimal. Never invent facts. If sources conflict, say so.

RESPONSE STYLE:
- Answer first, no preamble.
- Concise by default, expand only when needed.
- Bullet points only for genuinely list-shaped content.
- No filler openers ("Sure!", "Great question!") or closers ("Hope this helps!").
- If unsure, say so.

EMOJI: Only as bullet markers (✅ ❌ 📌 💡 ⚠️). Never in flowing prose.`;

const SYSTEM_WITHOUT_SEARCH = `\
You are Atkyn, a smart AI assistant. Reply like a knowledgeable friend — direct, clear, natural.

LANGUAGE: Mirror the user exactly. Hinglish in → Hinglish out. Hindi in → Hindi out. English in → English out. Never switch unless asked.

RESPONSE STYLE:
- Answer first, no preamble.
- Concise by default, expand only when needed.
- Bullet points only for genuinely list-shaped content.
- No filler openers ("Sure!", "Great question!") or closers ("Hope this helps!").
- If unsure, say so clearly — never guess with false confidence.

EMOJI: Only as bullet markers (✅ ❌ 📌 💡 ⚠️). Never in flowing prose.`;

// ── Main handler ───────────────────────────────────────────────────────────

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

  const doSearch = needsSearch(query);

  // ── 1. Serper.dev web search ──────────────────────────────────────────────
  let sources = [];
  let contextBlock = '';

  if (doSearch) {
    try {
      const webResp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': env.SERPER_API_KEY,
        },
        body: JSON.stringify({
          q: query,
          num: 10,
          gl: 'in',
          hl: 'en',
        }),
      });

      if (webResp.ok) {
        const webData = await webResp.json();
        const pages = (webData.organic || []).filter(p => {
          try {
            const hostname = new URL(p.link).hostname.replace(/^www\./, '');
            return !BLOCKED_DOMAINS.includes(hostname);
          } catch (_) { return true; }
        });

        sources = pages.slice(0, 10).map(p => ({
          name:       p.title,
          url:        p.link,
          displayUrl: p.link,
        }));

        contextBlock = pages.slice(0, 10)
          .map((p, i) => `[${i + 1}] ${p.title}\n${(p.snippet || '').slice(0, 400)}`)
          .join('\n\n');
      }
    } catch (_) {
      // Serper failed — answer without context
    }
  }

  // ── 2. Build messages with history ────────────────────────────────────────
  const systemPrompt = contextBlock
    ? SYSTEM_WITH_SEARCH(contextBlock)
    : SYSTEM_WITHOUT_SEARCH;

  const recentHistory = Array.isArray(history) ? history.slice(-6) : [];

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: query },
  ];

  // ── 3. Stream response ────────────────────────────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();
  const write   = chunk => writer.write(encoder.encode(chunk));

  (async () => {
    await write(`data: ${JSON.stringify({ sources })}\n\n`);

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages,
        stream: true,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!groqResp.ok) {
      const err = await groqResp.text();
      await write(`data: ${JSON.stringify({ error: err })}\n\n`);
      await writer.close();
      return;
    }

    const reader  = groqResp.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await write(decoder.decode(value, { stream: true }));
    }

    await write('data: [DONE]\n\n');
    await writer.close();
  })();

  return new Response(readable, {
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
