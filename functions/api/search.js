/* ═══════════════════════════════════════════════════════════════
   functions/api/search.js — Atkyn Web tab
   Pure SearXNG proxy — zero AI calls.
   Returns: JSON with:
     results[]   → { title, url, snippet, image?, publishedDate? }
     infobox?    → { title, content, image?, urls[] }  ← sitelinks source
     suggestions → string[]   ← related searches
     answers     → string[]   ← direct answers (calculator, etc.)
   ═══════════════════════════════════════════════════════════════ */

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = new URL(request.url).searchParams.get('q')?.trim();

  if (!q) {
    return _json({ error: 'Empty query' }, 400);
  }

  try {
    const searxResp = await fetch(
      `${env.SEARXNG_URL}/search?q=${encodeURIComponent(q)}&format=json&categories=general&language=en`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!searxResp.ok) return _json({ error: 'Search backend error' }, 502);

    const data = await searxResp.json();

    // ── Main results ─────────────────────────────────────────
    const results = (data.results || []).slice(0, 10).map(r => ({
      title:   r.title   || '',
      url:     r.url     || '',
      snippet: r.content || '',
      ...(r.img_src       ? { image: r.img_src }           : {}),
      ...(r.publishedDate ? { date: r.publishedDate }       : {}),
    }));

    // ── Infobox (Wikipedia / entity panel) ───────────────────
    // infobox.urls[] is the real sitelinks equivalent in SearXNG JSON
    const rawBox = (data.infoboxes || [])[0];
    const infobox = rawBox ? {
      title:   rawBox.infobox || '',
      content: rawBox.content || '',
      ...(rawBox.img_src ? { image: rawBox.img_src } : {}),
      // urls → your sitelinks: [{ title, url }]
      urls: (rawBox.urls || [])
        .filter(u => u.url && u.title)
        .slice(0, 6)
        .map(u => ({ title: u.title, url: u.url })),
    } : null;

    // ── Suggestions (related searches) ───────────────────────
    const suggestions = (data.suggestions || []).slice(0, 8);

    // ── Direct answers (calculator, time, etc.) ──────────────
    const answers = (data.answers || [])
      .map(a => (typeof a === 'string' ? a : a.answer || ''))
      .filter(Boolean)
      .slice(0, 3);

    return _json({ results, infobox, suggestions, answers });

  } catch (err) {
    return _json({ error: String(err) }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function _json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'no-cache',
    },
  });
}
