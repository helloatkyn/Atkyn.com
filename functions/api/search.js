/* ═══════════════════════════════════════════════════════════════
   functions/api/search.js — Atkyn Web tab
   Pure SearXNG proxy — zero AI calls.
   Returns: JSON array of { title, url, snippet, image?, sitelinks? }
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

    const results = (data.results || []).slice(0, 10).map(r => ({
      title:   r.title   || '',
      url:     r.url     || '',
      snippet: r.content || '',
      ...(r.img_src ? { image: r.img_src } : {}),
      ...(r.sitelinks?.length ? {
        sitelinks: r.sitelinks.map(s => ({
          title: s.title || '',
          url:   s.url   || '',
        }))
      } : {}),
    }));

    return _json(results);
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
