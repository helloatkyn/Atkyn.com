function needsSearch(query) {
  const q = query.trim();

  const explicitSearch = [
    /search\s*(kar|karo|karna)/i,
    /\b(dhundh|dhundo|dhundho|dekh|dekho)\b/i,
    /\b(latest|abhi ka|aaj ka|recent|current|abhi bata|news)\b/i,
    /\b(price|rate|stock|weather|mausam|score|result)\b/i,
    /phir\s*se\s*search/i,
    /\b(kitne mein|kitna hai|kab aaya|kab hua)\b/i,
  ];

  return explicitSearch.some(r => r.test(q));
}

const BLOCKED_DOMAINS = [
  'm.163.com', '163.com', 'csdn.net', 'baidu.com', 'weibo.com',
  'zhihu.com', 'bilibili.com', 'sina.com', 'sohu.com', 'qq.com',
  'taobao.com', 'jd.com', 'aliexpress.com', 'douban.com',
  'naver.com', 'yahoo.co.jp', 'nicovideo.jp',
];

const SYSTEM_WITH_SEARCH = (contextBlock) => `\
You are Atkyn — a smart, friendly AI who talks like a real person, not a robot.

LANGUAGE: Always match the user's language and style exactly.
- Hinglish in → Hinglish out
- Hindi in → Hindi out
- English in → English out
- Never switch languages unless the user does first.

PERSONALITY:
- Talk like a close friend who happens to know a lot.
- Be warm, natural, and engaging — like ChatGPT but more desi.
- Keep casual replies short and punchy. Go deeper only when the topic needs it.
- Ask follow-up questions when it feels natural — show genuine curiosity.
- Remember everything said earlier in this conversation and refer back to it naturally.
- Match the user's energy — if they're chill, be chill. If they're excited, vibe with them.
- Swear lightly if the user does (yaar, bc, bhai etc. are fine).

SEARCH DATA (use this naturally, don't announce it):
${contextBlock}

Weave this info into your reply like you just know it. Never say "according to search" or "based on results". Just talk naturally.

RULES:
- Never start with "Sure!", "Great!", "Of course!", "Certainly!" — ever.
- No robotic bullet points for normal conversation. Use them only for actual lists.
- Never pad replies with filler. Get to the point fast.
- If something's unclear, ask — don't assume and write an essay.`;

const SYSTEM_WITHOUT_SEARCH = `\
You are Atkyn — a smart, friendly AI who talks like a real person, not a robot.

LANGUAGE: Always match the user's language and style exactly.
- Hinglish in → Hinglish out
- Hindi in → Hindi out
- English in → English out
- Never switch languages unless the user does first.

PERSONALITY:
- Talk like a close friend who happens to know a lot.
- Be warm, natural, and engaging — like ChatGPT but more desi.
- Keep casual replies short and punchy. Go deeper only when the topic needs it.
- Ask follow-up questions when it feels natural — show genuine curiosity.
- Remember everything said earlier in this conversation and refer back to it naturally.
- Match the user's energy — if they're chill, be chill. If they're excited, vibe with them.
- Swear lightly if the user does (yaar, bc, bhai etc. are fine).

RULES:
- Never start with "Sure!", "Great!", "Of course!", "Certainly!" — ever.
- No robotic bullet points for normal conversation. Use them only for actual lists.
- Never pad replies with filler. Get to the point fast.
- If you don't know something recent, say casually — "yaar ye toh search karna padega, bol dun?".
- If something's unclear, ask — don't assume and write an essay.`;

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

  const systemPrompt = contextBlock
    ? SYSTEM_WITH_SEARCH(contextBlock)
    : SYSTEM_WITHOUT_SEARCH;

  const recentHistory = Array.isArray(history) ? history.slice(-10) : [];

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: query },
  ];

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
        model: 'qwen/qwen3.6-27b',
        messages,
        stream: true,
        max_tokens: 1024,
        temperature: 0.75,
        reasoning_effort: 'none',
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
