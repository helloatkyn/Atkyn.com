export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const q   = url.searchParams.get('q')?.trim();

  if (!q) {
    return new Response(JSON.stringify({ error: 'Empty query' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 5 pages parallel — ~35-50 per page = ~175-250 results
    const pages = [1, 2, 3, 4, 5];
    const fetches = pages.map(pageno =>
      fetch(
        `${env.SEARXNG_URL}/search?q=${encodeURIComponent(`"${q}"`)}&format=json&categories=images&engines=google+images,bing+images&language=en&safesearch=0&pageno=${pageno}`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
      ).then(r => r.ok ? r.json() : { results: [] })
       .catch(() => ({ results: [] }))
    );

    const pages_data = await Promise.all(fetches);

    const seen   = new Set();
    const merged = pages_data
      .flatMap(d => d.results || [])
      .filter(r => {
        const key = r.img_src || r.url;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const results = merged.slice(0, 200).map(r => ({
      title:         r.title         || '',
      url:           r.url           || '',
      img_src:       r.img_src       || '',
      thumbnail_src: r.thumbnail_src || r.img_src || '',
      width:         r.img_width     || 0,
      height:        r.img_height    || 0,
    }));

    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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
