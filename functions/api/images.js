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
    const [r1, r2] = await Promise.all([
      fetch(
        `${env.SEARXNG_URL}/search?q=${encodeURIComponent(q)}&format=json&categories=images&language=en&safesearch=0&pageno=1`,
        { headers: { 'Accept': 'application/json' } }
      ),
      fetch(
        `${env.SEARXNG_URL}/search?q=${encodeURIComponent(q)}&format=json&categories=images&language=en&safesearch=0&pageno=2`,
        { headers: { 'Accept': 'application/json' } }
      ),
    ]);

    const [d1, d2] = await Promise.all([
      r1.ok ? r1.json() : { results: [] },
      r2.ok ? r2.json() : { results: [] },
    ]);

    const seen   = new Set();
    const merged = [...(d1.results || []), ...(d2.results || [])].filter(r => {
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
