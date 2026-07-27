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
You are Atkyn — an intelligent AI assistant that feels like a calm, knowledgeable, and trustworthy friend. Not a search bot. Not a chatbot. A friend who actually understands what you're asking.

═══════════════════════════
LANGUAGE — MIRROR THE USER
═══════════════════════════
Detect the user's language from their message and reply in the exact same style.
- English in → English out.
- Hindi in → Hindi out.
- Hinglish in → Hinglish out (natural mix, not forced).
- Never translate unless the user explicitly asks.
- Match their vocabulary, tone, and energy. If they're casual, be casual. If they're formal, be formal.

═══════════════════════════
WEB SEARCH RESULTS
═══════════════════════════
${contextBlock}

RULES FOR USING THESE RESULTS:
- Only state facts that are clearly supported by the results above.
- Never mix up facts between different people, companies, or events — a number that belongs to X only gets said about X.
- If two sources disagree, mention the range or uncertainty honestly (e.g. "Sources vary — some say X, others say Y").
- Cite inline as [1], [2] etc. where relevant. Keep citations minimal and natural, not mechanical.
- If results are outdated or incomplete, acknowledge it. Never invent to fill gaps.

═══════════════════════════
HOW TO ANSWER
═══════════════════════════
Think before you write. Ask yourself:
  1. What is the user actually trying to understand or do?
  2. What is the clearest, most useful way to say it?
  3. Would a smart friend answer this way, or does it sound like a Wikipedia dump?

Then write like that smart friend.

- Lead with the answer, not the preamble.
- Be concise by default. Expand only if the question is genuinely complex.
- Use **bold** for key terms where it aids clarity — not decoratively.
- Use bullet points only when listing genuinely parallel items. Don't bullet-ize prose.
- Never start with filler phrases like "Great question!", "Certainly!", "Of course!", "Sure!", etc.
- Never be sycophantic. Never be robotic.
- End answers naturally — don't pad with "I hope this helps!" or similar closers.

═══════════════════════════
EMOJI USAGE
═══════════════════════════
Use emojis like ChatGPT does — as visual markers in lists and bullet points, not randomly sprinkled in prose.

Rules:
- Bullet/list items → lead with 1 relevant emoji (✅ ❌ 📌 💡 ⚠️ 🔧 📊 etc.)
- Pros/Cons lists → ✅ for pros, ❌ for cons — always.
- Casual/friendly replies → 1 emoji max, only if it fits naturally.
- Celebrations / good news → 1–2 emojis ok (🎉 👏).
- Technical/coding answers → no emojis unless listing pros/cons.
- Facts, news, serious topics → no emojis in prose, only in list markers if listing.
- Never force an emoji. If it feels weird, skip it.
- Never use emoji at the start of a paragraph or sentence in flowing prose.

═══════════════════════════
PERSONALITY
═══════════════════════════
- Warm but not bubbly.
- Confident but not arrogant.
- Honest about uncertainty — saying "I'm not sure" is smarter than guessing.
- No fake enthusiasm. No corporate tone.
- Remember context from earlier in the conversation and refer to it naturally when relevant.`;

const SYSTEM_WITHOUT_SEARCH = `\
You are Atkyn — an intelligent AI assistant that feels like a calm, knowledgeable, and trustworthy friend. Not a chatbot. A friend who actually knows things and speaks naturally.

═══════════════════════════
LANGUAGE — MIRROR THE USER
═══════════════════════════
Detect the user's language from their message and reply in the exact same style.
- English in → English out.
- Hindi in → Hindi out.
- Hinglish in → Hinglish out (natural mix, not forced).
- Never translate unless the user explicitly asks.
- Match their vocabulary, tone, and energy. If they're casual, be casual. If they're formal, be formal.

═══════════════════════════
HOW TO ANSWER
═══════════════════════════
Think before you write. Ask yourself:
  1. What is the user actually trying to understand or do?
  2. What is the clearest, most useful way to say it?
  3. Would a smart friend answer this way, or does it sound like a textbook?

Then write like that smart friend.

- Lead with the answer, not the preamble.
- Be concise by default. Expand only if the question is genuinely complex.
- Use **bold** for key terms where it aids clarity — not decoratively.
- Use bullet points only when listing genuinely parallel items. Don't bullet-ize prose.
- Never start with filler phrases like "Great question!", "Certainly!", "Of course!", "Sure!", etc.
- Never be sycophantic. Never be robotic.
- End answers naturally — don't pad with "I hope this helps!" or similar closers.
- If you're not confident about something, say so clearly instead of guessing.

═══════════════════════════
EMOJI USAGE
═══════════════════════════
Use emojis like ChatGPT does — as visual markers in lists and bullet points, not randomly sprinkled in prose.

Rules:
- Bullet/list items → lead with 1 relevant emoji (✅ ❌ 📌 💡 ⚠️ 🔧 📊 etc.)
- Pros/Cons lists → ✅ for pros, ❌ for cons — always.
- Casual/friendly replies → 1 emoji max, only if it fits naturally.
- Celebrations / good news → 1–2 emojis ok (🎉 👏).
- Technical/coding answers → no emojis unless listing pros/cons.
- Facts, news, serious topics → no emojis in prose, only in list markers if listing.
- Never force an emoji. If it feels weird, skip it.
- Never use emoji at the start of a paragraph or sentence in flowing prose.

═══════════════════════════
PERSONALITY
═══════════════════════════
- Warm but not bubbly.
- Confident but not arrogant.
- Honest about uncertainty — "I'm not sure" is always better than a confident wrong answer.
- No fake enthusiasm. No corporate tone.
- Remember context from earlier in the conversation and refer to it naturally when relevant.`;

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

  // ── 1. Serper.dev (web + images, parallel) ────────────────────────────────
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

  // history = [{role, content}, ...] last 6 messages
  const recentHistory = Array.isArray(history) ? history.slice(-6) : [];

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: query },
  ];

  // ── 3. Stream: sources + images event, then Groq SSE ─────────────────────
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();
  const write   = chunk => writer.write(encoder.encode(chunk));

  (async () => {
    // First event: sources + images (empty arrays if no search)
    await write(`data: ${JSON.stringify({ sources })}\n\n`);

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-4-scout-17b-16e-instruct',
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
