/* ═══════════════════════════════════════════════════════════════
   functions/api/search.js — Atkyn Web tab
   Pure SearXNG proxy — zero AI calls.
   [PRODUCTION READY: Edge Cached · Robust Snippet Fallback · HTML Sanitized]
   ═══════════════════════════════════════════════════════════════ */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim();

  if (!q) return _json({ error: 'Empty query' }, 400);

  // ── CLOUDFLARE EDGE CACHE (Bing-level speed for repeated queries) ──
  const cacheKey = new Request(`https://search.cache/${encodeURIComponent(q)}`, request);
  const cache = caches.default;

  try {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
  } catch (_) {}

  try {
    const searxResp = await fetch(
      `${env.SEARXNG_URL}/search?q=${encodeURIComponent(q)}&format=json&categories=general&language=en`,
      {
        headers: { 
          'Accept': 'application/json', 
          'User-Agent': 'Mozilla/5.0 (compatible; AtkynBot/1.0)' 
        },
        signal: AbortSignal.timeout(6000), // 6s strict timeout
      }
    );

    if (!searxResp.ok) return _json({ error: 'Search backend error' }, 502);

    const data = await searxResp.json();

    // ── Main results (Robust snippet extraction) ──
    const results = (data.results || []).slice(0, 10).map(r => {
      // Fallback chain for snippet
      let snippet = r.content || r.snippet || r.description || r.summary || '';
      
      // Strip any accidental HTML tags left by SearXNG
      snippet = snippet.replace(/<[^>]+>/g, '').trim();
      
      // Graceful fallback if still empty
      if (!snippet) snippet = 'No description available for this result.';

      return {
        title:   r.title   || 'Untitled',
        url:     r.url     || '#',
        snippet: snippet,
        ...(r.img_src       ? { image: r.img_src }     : {}),
        ...(r.publishedDate ? { date: r.publishedDate } : {}),
      };
    });

    // ── Infobox (Entity panel) ──
    const rawBox = (data.infoboxes || [])[0];
    const infobox = rawBox ? {
      title:   rawBox.infobox || rawBox.title || '',
      content: (rawBox.content || '').replace(/<[^>]+>/g, '').trim(),
      ...(rawBox.img_src ? { image: rawBox.img_src } : {}),
      urls: (rawBox.urls || [])
        .filter(u => u.url && u.title)
        .slice(0, 6)
        .map(u => ({ title: u.title, url: u.url })),
    } : null;

    // ── Related searches & Direct answers ──
    const relatedSearches = (data.suggestions || []).slice(0, 8);
    const answers = (data.answers || [])
      .map(a => (typeof a === 'string' ? a : a.answer || ''))
      .filter(Boolean)
      .slice(0, 3);

    const responseData = { results, infobox, relatedSearches, answers };
    
    // Cache successful response for 5 minutes
    const response = _json(responseData, 200, 300);
    context.waitUntil(cache.put(cacheKey, response.clone()));
    
    return response;

  } catch (err) {
    return _json({ error: 'Search failed. Please try again.' }, 502);
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

function _json(data, status = 200, maxAge = 0) {
  const headers = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  
  if (maxAge > 0) {
    headers['Cache-Control'] = `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`;
  } else {
    headers['Cache-Control'] = 'no-cache';
  }
  
  return new Response(JSON.stringify(data), { status, headers });
}
