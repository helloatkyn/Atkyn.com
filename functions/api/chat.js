// Queries jo search nahi karni — LLM seedha answer kare
function needsSearch(query) {
  const q = query.trim().toLowerCase();

  // Bohot choti queries (1-2 words)
  if (q.split(/\s+/).length <= 2) return false;

  // Always search if user says "search kar / phir se search / dobara search"
  if (/search\s*(kar|karo|karna|phir|dobara|again)/i.test(q)) return true;
  if (/phir\s*se\s*search/i.test(q)) return true;

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

  // ── 1. LangSearch (only if needed) ────────────────────────────────────────
  let sources = [];
  let contextBlock = '';

  if (doSearch) {
    try {
      const lsResp = await fetch('https://api.langsearch.com/v1/web-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.LANGSEARCH_API_KEY}`,
        },
        body: JSON.stringify({
          query,
          freshness: 'noLimit',
          summary: false,
          count: 5,
          mkt: 'en-IN',
        }),
      });

      if (lsResp.ok) {
        const lsData = await lsResp.json();
        const pages  = lsData?.data?.webPages?.value || [];

        // Filter Chinese/irrelevant domains
        const enPages = pages.filter(p => {
          try {
            const hostname = new URL(p.url).hostname.replace(/^www\./, '');
            return !BLOCKED_DOMAINS.includes(hostname);
          } catch (_) { return true; }
        });

        sources = enPages.slice(0, 5).map(p => ({
          name:       p.name,
          url:        p.url,
          displayUrl: p.displayUrl || p.url,
        }));

        contextBlock = enPages.slice(0, 5)
          .map((p, i) => `[${i + 1}] ${p.name}\n${(p.snippet || '').slice(0, 400)}`)
          .join('\n\n');
      }
    } catch (_) {
      // LangSearch failed — answer without context
    }
  }

  // ── 2. Build messages with history ────────────────────────────────────────
  const systemPrompt = contextBlock
    ? `You are Atkyn, a fast AI search assistant. Answer in the same language the user writes in (Hindi, English, or Hinglish — match their style exactly).

Web search results:
${contextBlock}

STRICT RULES:
- Only use facts clearly stated in the search results above
- NEVER mix facts between different people — if a number belongs to person X, only say it about X, not person Y
- If sources contradict each other, mention the range
- Bold key terms with **text**. Cite as [1], [2] etc. Be concise.`
    : `You are Atkyn, a helpful AI assistant. Answer in the same language the user writes in — Hindi to Hindi, Hinglish to Hinglish, English to English. Be conversational and concise.`;

  // history = [{role, content}, ...] last 6 messages
  const recentHistory = Array.isArray(history) ? history.slice(-6) : [];

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: query },
  ];

  // ── 3. Stream: sources event + Groq SSE ───────────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();
  const write   = chunk => writer.write(encoder.encode(chunk));

  (async () => {
    // First event: sources (empty array if no search)
    await write(`data: ${JSON.stringify({ sources })}\n\n`);

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
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
