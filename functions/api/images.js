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
    // 5 pages × num=100 = 500 results parallel
    const fetches = [1, 2, 3, 4, 5].map(page =>
      fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: {
          'X-API-KEY':    env.SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q, num: 100, page, gl: 'us' }),
      })
      .then(r => r.ok ? r.json() : { images: [] })
      .catch(() => ({ images: [] }))
    );

    const pages = await Promise.all(fetches);

    const seen   = new Set();
    const merged = pages
      .flatMap(d => d.images || [])
      .filter(r => {
        const key = r.imageUrl;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const results = merged.slice(0, 500).map(r => ({
      title:         r.title        || '',
      url:           r.link         || '',
      img_src:       r.imageUrl     || '',
      thumbnail_src: r.thumbnailUrl || r.imageUrl || '',
      width:         r.imageWidth   || 0,
      height:        r.imageHeight  || 0,
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
