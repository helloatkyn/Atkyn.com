// Queries jo search nahi karni — LLM seedha answer kare
function needsSearch(query) {
  const q = query.trim().toLowerCase();

  // Bohot choti queries
  if (q.split(/\s+/).length < 3) return false;

  // Greetings / conversational
  const conversational = [
    /^(hi|hello|hey|hola|namaste|namaskar|salam)\b/,
    /kya haal/,  /kaisa hai/, /kaise ho/, /kya chal/,
    /shukriya/, /thanks/, /thank you/, /dhanyawad/,
    /acha|achha|ok|okay|theek|bilkul|haan|nahi|nope/,
    /bhai\s+(sun|ek|koi|kuch|mat|kya|mujhe|mere|mera|tu)/,
    /^(ha|hm+|hmm+|lol|lmao|xd)$/,
    /^(aur|or|phir|then|so|bas|done|finish)/,
  ];
  if (conversational.some(r => r.test(q))) return false;

  // Factual / search-worthy signals
  const searchSignals = [
    /\b(kya hai|what is|who is|kab|when|kaha|where|kyun|why|kaun|how)\b/,
    /\b(price|cost|rate|kitna|kitne|kitni)\b/,
    /\b(news|khabar|latest|abhi|aaj|today|kal|tomorrow)\b/,
    /\b(weather|mausam|temperature)\b/,
    /\b(best|top|review|compare|vs|difference)\b/,
    /\b(net worth|salary|income)\b/,
    /\b(result|score|match|winner)\b/,
  ];
  if (searchSignals.some(r => r.test(q))) return true;

  // Default: 5+ word queries search karo
  return q.split(/\s+/).length >= 5;
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

        // Filter non-English results
        const enPages = pages.filter(p => {
          const url = p.url || '';
          return !url.match(/\/(zh|cn|ja|ko|ar|ru|de|fr|es|pt)\//);
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

Use these results to give a clear, accurate answer. Bold key terms with **text**. Cite sources as [1], [2] etc. Be concise.`
    : `You are Atkyn, a helpful AI assistant. Answer in the same language the user writes in — if they write in Hindi, reply in Hindi; Hinglish in Hinglish; English in English. Be conversational and concise.`;

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
        model: 'llama-3.1-8b-instant',
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
