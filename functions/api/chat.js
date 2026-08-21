import { SYSTEM_PROMPT } from './systemPrompt.js';

// ── Constants ──────────────────────────────────────────────
const MAX_RESULTS       = 5;
const MAX_PAGE_TEXT_LEN = 2500;
const MAX_TITLE_LEN     = 120;
const MAX_URL_LEN       = 300;
const MAX_SNIPPET_LEN   = 900;
const PAGE_TIMEOUT_MS   = 4000;
const MAX_TOKENS_INTENT = 10;
const MAX_TOKENS_ANSWER = 350;
const HISTORY_LIMIT     = 100;
const THIN_SNIPPET_THRESHOLD = 300;

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','this','that',
  'these','those','it','its','i','you','he','she','we','they','what','which',
  'who','how','when','where','why','not','no','so','if','as','by','from',
  'about','up','out','into','than','then','just','also','more','other',
  'some','any','all','each','both','few','most','only','own','same','such',
]);

const INTENT_SYSTEM = `You decide if a web search is needed to answer the user query.
Reply with ONLY [SEARCH] or [NO_SEARCH]. Nothing else.

Return [SEARCH] for:
- current / latest / today's / recent information
- news, events, announcements
- current prices: stocks, crypto, gold, silver, oil, commodities
- market cap, valuation, funding
- exchange rates, forex
- weather conditions or forecasts
- current software/app/product versions
- product pricing or availability
- current officials, leaders, or executives
- current laws, regulations, policies
- sports scores, results, standings, rankings
- anything that materially changes over time

Return [NO_SEARCH] for:
- math, logic, calculations
- translation or rewriting
- summarization of user-provided content
- creative writing or brainstorming
- stable general knowledge or history
- explanations of concepts, science, definitions`;

const ANSWER_INSTRUCTION = `

OUTPUT RULES (hard limit: 150 tokens):
- Complete your answer naturally before reaching the limit.
- Answer the user's actual question first, directly.
- Simple questions: 1–3 sentences max.
- Complex/factual questions: essential verified facts only, no padding.
- If search results are available, use the most important verified data.
- If current data is unavailable, say so clearly — never fabricate prices, versions, or live stats.
- Never start a sentence or list you cannot finish within the remaining budget.
- Never fill tokens just because the limit is 150.`;

// ── Helpers ─────────────────────────────────────────────────
function trunc(str, len) {
  if (!str || typeof str !== 'string') return '';
  return str.length > len ? str.slice(0, len) : str;
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Tokenize a query into meaningful terms by lowercasing, splitting, and
 * removing stop words and very short tokens.
 */
function queryTerms(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Score a text window by how many distinct query terms it contains.
 * Returns a count of matched unique terms.
 */
function scoreWindow(windowText, terms) {
  const lower = windowText.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score++;
  }
  return score;
}

/**
 * Extract the most query-relevant passage from cleaned page text.
 * Splits text into overlapping windows, scores each against query terms,
 * and returns the highest-scoring window trimmed to MAX_PAGE_TEXT_LEN.
 * Falls back to the start of the page if no terms match.
 */
function extractRelevantPassage(cleanedText, query) {
  const terms = queryTerms(query);

  // If no meaningful terms, just return the beginning
  if (!terms.length) {
    return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);
  }

  // Use sentence-like boundaries for windows
  // Split on '. ', '! ', '? ', '\n' to get rough sentences
  const sentences = cleanedText
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);  // drop tiny fragments

  if (!sentences.length) {
    return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);
  }

  // Build windows of ~5 sentences each, stepping 2 sentences at a time
  const WINDOW_SIZE = 5;
  const STEP = 2;
  let bestScore = -1;
  let bestStart = 0;

  for (let i = 0; i < sentences.length; i += STEP) {
    const window = sentences.slice(i, i + WINDOW_SIZE).join(' ');
    const score = scoreWindow(window, terms);
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }

  // If best score is 0, no matches found — fall back to page start
  if (bestScore === 0) {
    return cleanedText.slice(0, MAX_PAGE_TEXT_LEN);
  }

  // Expand the best window into surrounding context up to MAX_PAGE_TEXT_LEN
  let passage = '';
  let idx = Math.max(0, bestStart - 1); // one sentence of context before
  while (idx < sentences.length && passage.length < MAX_PAGE_TEXT_LEN) {
    const next = (passage ? passage + ' ' : '') + sentences[idx];
    if (next.length > MAX_PAGE_TEXT_LEN) break;
    passage = next;
    idx++;
  }

  return passage || cleanedText.slice(0, MAX_PAGE_TEXT_LEN);
}

async function fetchPageText(url, query) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!resp.ok) return '';

    // Reject non-HTML responses (binary, PDFs, etc.)
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return '';
    }

    const html = await resp.text();
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return '';

    return extractRelevantPassage(clean, query);
  } catch {
    return '';
  }
}

function buildSearchContext(results) {
  if (!results.length) return '';
  return 'Web search results:\n' +
    results.map((r, i) =>
      `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`
    ).join('\n\n');
}

async function groqFetch(apiKey, body) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  return resp;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Main Handler ─────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GROQ_API_KEY) {
    return jsonError('Server misconfiguration', 500);
  }

  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch {
    return jsonError('Invalid request body', 400);
  }

  if (!query?.trim()) {
    return jsonError('Empty query', 400);
  }

  // ── Step 1: Intent classification ───────────────────────
  let needsSearch = false;
  try {
    const intentResp = await groqFetch(env.GROQ_API_KEY, {
      model: 'qwen/qwen3.6-27b',
      messages: [
        { role: 'system', content: INTENT_SYSTEM },
        { role: 'user', content: query },
      ],
      stream: false,
      max_tokens: MAX_TOKENS_INTENT,
      temperature: 0,
      reasoning_effort: 'none',
    });

    if (intentResp.ok) {
      const intentData = await intentResp.json().catch(() => null);
      const decision = intentData?.choices?.[0]?.message?.content?.trim();
      needsSearch = decision === '[SEARCH]';
    }
  } catch {
    // classifier failed → skip search conservatively
  }

  // ── Step 2: SearXNG (if needed) ─────────────────────────
  let searchResults = [];
  let searchContext = '';

  if (needsSearch) {
    if (!env.SEARXNG_URL) {
      // No SearXNG configured — skip gracefully
    } else {
      try {
        const searxResp = await fetch(
          `${env.SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`,
          {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(6000),
          }
        );

        if (searxResp.ok) {
          const data = await searxResp.json().catch(() => null);
          const raw = Array.isArray(data?.results) ? data.results.slice(0, MAX_RESULTS) : [];

          // Deduplicate by URL
          const seenUrls = new Set();
          const deduped = raw.filter(r => {
            const url = r?.url;
            if (!url || seenUrls.has(url)) return false;
            seenUrls.add(url);
            return true;
          });

          searchResults = await Promise.all(
            deduped.map(async (r, i) => {
              const rawUrl   = trunc(r.url     || '', MAX_URL_LEN);
              const rawTitle = trunc(r.title   || '', MAX_TITLE_LEN);
              let   snippet  = trunc(r.content || '', MAX_SNIPPET_LEN);

              // Enrich with page text only when snippet is genuinely thin
              // and only for the first 3 results to control latency
              if (snippet.length < THIN_SNIPPET_THRESHOLD && i < 3 && isValidUrl(rawUrl)) {
                const pageText = await fetchPageText(rawUrl, query);
                if (pageText) snippet = trunc(pageText, MAX_PAGE_TEXT_LEN);
              }

              return { title: rawTitle, url: rawUrl, snippet };
            })
          );

          searchContext = buildSearchContext(searchResults);
        }
      } catch {
        // SearXNG failed → continue without search data
      }
    }
  }

  // ── Step 3: Stream final answer ──────────────────────────
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  const safeWrite = async (chunk) => {
    try { await writer.write(chunk); } catch { /* writer closed */ }
  };

  (async () => {
    try {
      if (searchResults.length > 0) {
        await safeWrite(enc.encode(
          `event: results\ndata: ${JSON.stringify(searchResults)}\n\n`
        ));
      }

      const systemContent = searchContext
        ? `${SYSTEM_PROMPT}${ANSWER_INSTRUCTION}\n\n${searchContext}`
        : `${SYSTEM_PROMPT}${ANSWER_INSTRUCTION}`;

      const groqResp = await groqFetch(env.GROQ_API_KEY, {
        model: 'qwen/qwen3.6-27b',
        messages: [
          { role: 'system', content: systemContent },
          ...(Array.isArray(history) ? history.slice(-HISTORY_LIMIT) : []),
          { role: 'user', content: query },
        ],
        stream: true,
        max_tokens: MAX_TOKENS_ANSWER,
        temperature: 0.3,
        reasoning_effort: 'none',
      });

      if (!groqResp.ok) {
        await safeWrite(enc.encode(
          `data: ${JSON.stringify({ error: 'AI response failed' })}\n\n`
        ));
        await writer.close();
        return;
      }

      const reader = groqResp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await safeWrite(value);
      }

      await writer.close();
    } catch {
      await safeWrite(enc.encode(
        `data: ${JSON.stringify({ error: 'Internal error' })}\n\n`
      ));
      try { await writer.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(readable, {
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
