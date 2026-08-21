/* ═══════════════════════════════════════════════════════════════
   functions/api/query.js — Atkyn Search Query Extractor
   Extracts 5 tab-specific search queries from user input via Mistral Nemo.
   Called ONCE per user message — results cached in sessionStorage.
   Tabs: answer · web · images · news · videos
   ═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   SYSTEM PROMPT
───────────────────────────────────────────────────────────── */
const QUERY_SYSTEM_PROMPT = `You are a professional search query extractor for a multi-tab search engine.

Given a user message, extract exactly 5 optimized search queries — one for each tab.

Rules:
- Each query must be 2–5 words, no punctuation, no quotes
- Queries should be distinct and tailored to the specific tab's content type
- Do NOT repeat the user's exact words verbatim; rephrase naturally
- Output ONLY valid JSON, no explanation, no markdown, no backticks

Tab guidance:
- "answer": Factual query for AI to answer directly (e.g. "Mistral free tier limits")
- "web":    Informational query for article/doc results (e.g. "Mistral Nemo API docs")
- "images": Visual query for photos/diagrams (e.g. "Mistral AI logo diagram")
- "news":   Recent event query (e.g. "Mistral free plan announcement 2025")
- "videos": Tutorial/explainer query (e.g. "Mistral Nemo integration tutorial")

Output format (strict JSON, no extra keys):
{
  "answer": "...",
  "web": "...",
  "images": "...",
  "news": "...",
  "videos": "..."
}`;

/* ─────────────────────────────────────────────────────────────
   MAIN HANDLER
───────────────────────────────────────────────────────────── */
export async function onRequestPost(context) {
  const { request, env } = context;

  /* ── Parse body ── */
  let userQuery;
  try {
    ({ query: userQuery } = await request.json());
  } catch {
    return _errJson('Invalid request body', 400);
  }

  if (!userQuery?.trim()) return _errJson('Empty query', 400);

  const raw = userQuery.trim();

  /* ── Call Mistral Nemo ── */
  let extracted;
  try {
    const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'open-mistral-nemo',
        messages: [
          { role: 'system', content: QUERY_SYSTEM_PROMPT },
          { role: 'user',   content: `User message: "${raw}"` },
        ],
        max_tokens:  120,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(7000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return _errJson(`Mistral error: ${errText}`, 502);
    }

    const data    = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return _errJson('Empty response from Mistral', 502);

    /* Strip accidental backticks/fences just in case */
    const clean = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    extracted   = JSON.parse(clean);

  } catch (err) {
    return _errJson(`Query extraction failed: ${String(err)}`, 500);
  }

  /* ── Validate shape ── */
  const REQUIRED = ['answer', 'web', 'images', 'news', 'videos'];
  for (const key of REQUIRED) {
    if (typeof extracted[key] !== 'string' || !extracted[key].trim()) {
      extracted[key] = raw; // fallback: original query
    }
  }

  /* ── Return clean result ── */
  return new Response(
    JSON.stringify({
      source:  raw,
      queries: {
        answer: extracted.answer.trim(),
        web:    extracted.web.trim(),
        images: extracted.images.trim(),
        news:   extracted.news.trim(),
        videos: extracted.videos.trim(),
      },
    }),
    {
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
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
