/* ═══════════════════════════════════════════════════════════════
   functions/api/search.js — Atkyn Web tab
   Serper.dev proxy — zero AI calls.
   Returns: JSON { results, relatedSearches, images }
   ═══════════════════════════════════════════════════════════════ */

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = new URL(request.url).searchParams.get('q')?.trim();

  if (!q) {
    return _json({ error: 'Empty query' }, 400);
  }

  try {
    const serperResp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY':    env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, num: 10, gl: 'in', hl: 'en' }),
      signal: AbortSignal.timeout(8000),
    });

    if (!serperResp.ok) return _json({ error: 'Search backend error' }, 502);

    const data = await serperResp.json();

    const results = (data.organic || []).slice(0, 10).map(r => ({
      title:   r.title   || '',
      url:     r.link    || '',
      snippet: r.snippet || '',
      ...(r.imageUrl ? { image: r.imageUrl } : {}),
      ...(r.images?.length ? { images: r.images.slice(0, 4).map(i => i.imageUrl).filter(Boolean) } : {}),
      ...(r.sitelinks?.length ? {
        sitelinks: r.sitelinks.map(s => ({
          title: s.title || '',
          url:   s.link  || '',
        }))
      } : {}),
    }));

    const relatedSearches = (data.relatedSearches || []).slice(0, 8).map(r => r.query || '').filter(Boolean);

    return _json({ results, relatedSearches });

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
