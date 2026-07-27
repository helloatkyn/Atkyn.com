// ============================================================
// Atkyn — Search Worker
// File: functions/api/search.js
//
// Prompt edit karna ho toh: functions/prompts/system.js
// Model change karna ho toh: GROQ_MODEL constant neeche
// ============================================================

import { getSystemPrompt } from '../prompts/system.js';

// ── Config ────────────────────────────────────────────────
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // upgraded from 8b-instant
const MAX_TOKENS  = 1024;
const HISTORY_LEN = 6;   // last N messages to pass as context
const SEARCH_COUNT = 5;  // langsearch results to fetch

// ── Domains to filter out (non-English / irrelevant) ──────
const BLOCKED_DOMAINS = [
  'm.163.com', '163.com', 'csdn.net', 'baidu.com', 'weibo.com',
  'zhihu.com', 'bilibili.com', 'sina.com', 'sohu.com', 'qq.com',
  'taobao.com', 'jd.com', 'aliexpress.com', 'douban.com',
  'naver.com', 'yahoo.co.jp', 'nicovideo.jp',
];

// ── Search decision logic ─────────────────────────────────
function needsSearch(query) {
  const q = query.trim().toLowerCase();

  // Very short queries — answer directly
  if (q.split(/\s+/).length <= 2) return false;

  // User explicitly asks to search
  if (/search\s*(kar|karo|karna|phir|dobara|again)/i.test(q)) return true;
  if (/phir\sse\ssearch/i.test(q)) return true;

  // Pure greetings / acknowledgements — no search needed
  const greetings = [
    /^(hi|hello|hey|hola|namaste|namaskar|salam)\b/,
    /^(kya haal|kaisa hai|kaise ho|kya chal)\b/,
    /^(shukriya|thanks|thank you|dhanyawad|bahut accha|wah)\b/,
    /^(haan|nahi|ok|okay|theek|bilkul|accha|achha)\b/,
    /^(ha|hm+|hmm+|lol)\b/,
  ];
  if (greetings.some(r => r.test(q))) return false;

  // Signals that clearly need fresh / web data
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

  // 5+ word queries default to search
  return q.split(/\s+/).length >= 5;
}

// ── POST handler ──────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  // Parse body
  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch {
    return jsonError('Invalid request body', 400);
  }

  if (!query?.trim()) return jsonError('Empty query', 400);

  const doSearch = needsSearch(query);

  // ── 1. LangSearch (conditional) ───────────────────────
  let sources      = [];
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
          count: SEARCH_COUNT,
          mkt: 'en-IN',
        }),
      });

      if (lsResp.ok) {
        const lsData = await lsResp.json();
        const pages  = lsData?.data?.webPages?.value || [];

        // Filter blocked domains
        const filtered = pages.filter(p => {
          try {
            const host = new URL(p.url).hostname.replace(/^www\./, '');
            return !BLOCKED_DOMAINS.includes(host);
          } catch (_) { return true; }
        });

        sources = filtered.slice(0, SEARCH_COUNT).map(p => ({
          name:       p.name,
          url:        p.url,
          displayUrl: p.displayUrl || p.url,
        }));

        contextBlock = filtered.slice(0, SEARCH_COUNT)
          .map((p, i) => `[${i + 1}] ${p.name}\n${(p.snippet || '').slice(0, 400)}`)
          .join('\n\n');
      }
    } catch (_) {
      // LangSearch failed — fall through to direct answer
    }
  }

  // ── 2. Build messages ─────────────────────────────────
  const systemPrompt  = getSystemPrompt(contextBlock);
  const recentHistory = Array.isArray(history) ? history.slice(-HISTORY_LEN) : [];

  const messages = [
    { role: 'system',  content: systemPrompt },
    ...recentHistory,
    { role: 'user',    content: query },
  ];

  // ── 3. Stream response ────────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();
  const write   = chunk => writer.write(encoder.encode(chunk));

  (async () => {
    // First SSE event — send sources immediately so UI can render them
    await write(`data: ${JSON.stringify({ sources })}\n\n`);

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages,
        stream:      true,
        max_tokens:  MAX_TOKENS,
        temperature: 0.7,
      }),
    });

    if (!groqResp.ok) {
      const err = await groqResp.text();
      await write(`data: ${JSON.stringify({ error: err })}\n\n`);
      await writer.close();
      return;
    }

    // Pipe Groq SSE → client
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
      'Content-Type':     'text/event-stream',
      'Cache-Control':    'no-cache',
      'X-Accel-Buffering':'no',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── OPTIONS (CORS preflight) ──────────────────────────────
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// ── Helper ────────────────────────────────────────────────
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
