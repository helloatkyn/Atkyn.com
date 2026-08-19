/* ═══════════════════════════════════════════════════════════════
   functions/api/chat.js — Atkyn Answer tab
   Smart intent classification → SearXNG → Groq (Qwen 3.6 27B) streaming
   ═══════════════════════════════════════════════════════════════ */

import { SYSTEM_PROMPT } from './systemPrompt.js';

/* ─────────────────────────────────────────────────────────────
   INTENT CLASSIFIER
   Returns { needsSearch: bool, reason: string }
───────────────────────────────────────────────────────────── */
function classifyIntent(query, history = []) {
  const raw = query.trim();
  const q   = raw.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);

  if (words.length === 0) return { needsSearch: false, reason: 'empty' };
  if (words.length === 1) {
    const SINGLE_SKIP = new Set([
      'hi','hey','hello','hii','heyy','yo','sup','hola','namaste','namaskar',
      'ok','okay','k','fine','sure','yep','yes','no','nope','nah',
      'lol','lmao','haha','hehe','xd','😂','🙏',
      'thanks','thank','thx','ty','np','welcome',
      'bye','cya','later','gtg','brb',
    ]);
    if (SINGLE_SKIP.has(q)) return { needsSearch: false, reason: 'single-word greeting/filler' };
  }

  const CHIT_CHAT_PATTERNS = [
    /^(hi+|hey+|hello+|hola|howdy|sup|yo+)[!?. ]*$/i,
    /^(good\s?(morning|evening|night|afternoon))[!?. ]*$/i,
    /^(how are you|how r u|kaisa hai|kya haal|kya chal raha|kaise ho|kya hal)[?!. ]*$/i,
    /^(what('s| is) up|whatsup|wassup)[?!. ]*$/i,
    /^(thanks?|thank you|thx|ty|shukriya|dhanyawad)[!?. ]*$/i,
    /^(bye|goodbye|cya|later|alvida|phir milenge)[!?. ]*$/i,
    /^(ok(ay)?|sure|got it|alright|theek hai|haan|nahi|nope|yep|yeah)[!?. ]*$/i,
    /^(lol+|lmao|haha+|hehe+|xd)[!?. ]*$/i,
    /^(nice|cool|wow|great|awesome|amazing|shabash|wah)[!?. ]*$/i,
  ];
  for (const re of CHIT_CHAT_PATTERNS) {
    if (re.test(raw)) return { needsSearch: false, reason: 'chit-chat pattern' };
  }

  const NOSEARCH_TASK_PATTERNS = [
    /\b(calculate|solve|simplify|evaluate|differentiate|integrate|expand|factorise?)\b/i,
    /\b(write\s+(a|an|me\s+a)?\s*(code|program|script|function|class|component|api|query))\b/i,
    /\b(debug|fix\s+this|refactor|optimise?|improve\s+this)\b/i,
    /\b(translate|summarise?|summarize|proofread|grammar|spell\s?check)\b/i,
    /\b(explain\s+(me\s+)?(what\s+is|the\s+concept|how)\b)/i,
    /\b(write\s+(a|an)\s*(poem|story|essay|email|letter|caption|bio|cover letter))\b/i,
    /\b(make\s+(a|an)\s*(list|plan|itinerary|schedule|table|comparison))\b/i,
    /[\d]+\s*[\+\-\*\/\^]\s*[\d]+/,
    /\b(what\s+is\s+\d+[\+\-\*\/])/i,
  ];
  for (const re of NOSEARCH_TASK_PATTERNS) {
    if (re.test(raw)) return { needsSearch: false, reason: 'computation/creative/code task' };
  }

  const SEARCH_SIGNALS = [
    /\b(latest|recent|current|today|tonight|right now|this week|this month|2024|2025|2026)\b/i,
    /\b(news|breaking|update|just happened|just announced|launched)\b/i,
    /\b(live score|live|streaming|trending|viral)\b/i,
    /\b(who is|who are|who was|who were)\b/i,
    /\b(what is the (price|cost|rate|fee|charge) of)\b/i,
    /\b(where is|where are|where can i (find|buy|get|watch))\b/i,
    /\b(when (is|was|will|does|did))\b/i,
    /\b(how (much|many|long|far|tall|big|old))\b/i,
    /\b(phone number|address|contact|timing|hours|open|closed)\b/i,
    /\b(buy|purchase|order|shop|price|discount|offer|deal|coupon)\b/i,
    /\b(best|top|review|rating|vs|versus|compare|comparison|alternative)\b/i,
    /\b(specs|specifications|release date|launch date)\b/i,
    /\b(capital (of|city)|population|gdp|ceo|founder|chairman|owner|president|prime minister|minister)\b/i,
    /\b(movie|film|series|show|episode|season|trailer|cast|imdb)\b/i,
    /\b(stock|share price|market cap|nifty|sensex|nasdaq|bitcoin|crypto)\b/i,
    /\b(recipe|ingredients|how to make|how to cook)\b/i,
    /\b(weather|temperature|forecast|rain|humidity)\b/i,
    /\b(flight|train|bus|ticket|pnr|status|schedule)\b/i,
    /\b(hospital|doctor|clinic|near me|nearby|around me)\b/i,
    /\b(election|result|vote|poll|survey)\b/i,
  ];
  for (const re of SEARCH_SIGNALS) {
    if (re.test(raw)) return { needsSearch: true, reason: 'search signal matched' };
  }

  if (words.length <= 5 && history.length >= 2) {
    const FOLLOW_UP_RE = /^(what about|and|but|also|tell me more|more|elaborate|go on|continue|why|how so|really|seriously|then what)[?!. ]*/i;
    if (FOLLOW_UP_RE.test(raw)) return { needsSearch: false, reason: 'conversational follow-up' };
  }

  const OPINION_RE = /^(what do you think|what('s| is) your (opinion|view|take)|do you (like|prefer|believe|think)|in your opinion|aap kya sochte|tumhara kya khayal)/i;
  if (OPINION_RE.test(raw)) return { needsSearch: false, reason: 'opinion question' };

  if (q.endsWith('?') && words.length >= 4) {
    return { needsSearch: true, reason: 'question heuristic' };
  }

  if (words.length <= 3) return { needsSearch: false, reason: 'short non-question' };

  return { needsSearch: true, reason: 'long query default' };
}

/* ─────────────────────────────────────────────────────────────
   PAGE SCRAPER
───────────────────────────────────────────────────────────── */
async function fetchPageText(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Atkyn/1.0)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
  } catch {
    return '';
  }
}

/* ─────────────────────────────────────────────────────────────
   MAIN HANDLER
───────────────────────────────────────────────────────────── */
export async function onRequestPost(context) {
  const { request, env } = context;

  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch {
    return _errJson('Invalid request body', 400);
  }

  if (!query?.trim()) return _errJson('Empty query', 400);

  const historyArr = Array.isArray(history) ? history : [];

  /* ── Classify intent ── */
  const { needsSearch } = classifyIntent(query, historyArr);

  /* ── Step 1: SearXNG (only when needed) ── */
  let searchResults = [];
  let searchContext = '';

  if (needsSearch) {
    try {
      const searxResp = await fetch(
        `${env.SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
      );
      if (searxResp.ok) {
        const data = await searxResp.json();
        const raw  = (data.results || []).slice(0, 6);

        searchResults = await Promise.all(
          raw.map(async (r, i) => {
            let content = r.content || '';
            if (i < 5) {
              const pageText = await fetchPageText(r.url);
              if (pageText) content = pageText;
            }
            return { title: r.title || '', url: r.url || '', snippet: content };
          })
        );

        if (searchResults.length) {
          searchContext = 'Web search results:\n' +
            searchResults
              .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
              .join('\n\n');
        }
      }
    } catch (_) {
      // Search failed silently — Groq answers from internal knowledge
    }
  }

  /* ── Step 2: Stream Groq (Qwen 3.6 27B) response ── */
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      if (searchResults.length) {
        await writer.write(enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`));
      }

      const systemContent = searchContext
        ? `${SYSTEM_PROMPT}\n\n${searchContext}`
        : SYSTEM_PROMPT;

      const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model:            'qwen/qwen3.6-27b',
          reasoning_effort: 'none',
          reasoning_format: 'hidden',
          messages: [
            { role: 'system', content: systemContent },
            ...historyArr.slice(-100),
            { role: 'user', content: query },
          ],
          stream:      true,
          max_tokens:  2048,
          temperature: 0.6,
        }),
      });

      if (!groqResp.ok) {
        const errText = await groqResp.text();
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: errText })}\n\n`));
        await writer.close();
        return;
      }

      const reader = groqResp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();

    } catch (err) {
      try {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
        await writer.close();
      } catch (_) {}
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function _errJson(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
     }
